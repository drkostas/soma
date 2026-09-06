/**
 * Vercel ↔ local-Mac transport for the chat route.
 *
 * Two deployment modes:
 *
 *   local mode  (default)
 *     The server has Claude Code CLI available. `/api/chat*` routes spawn
 *     it directly, read the on-disk JSONL, save uploads to /tmp, etc.
 *     This is the dev-server case + the Mac that hosts the tunnel.
 *
 *   proxy mode  (Vercel deployment)
 *     SOMA_CHAT_TUNNEL_URL is set. Every `/api/chat*` request is forwarded
 *     to that URL (a cloudflared tunnel pointed at the user's Mac). The
 *     deployed Vercel function is a thin pass-through; the actual
 *     `claude -p` always runs on the Mac.
 *
 * A shared-secret token guards the tunnel boundary: the Mac requires
 * `X-Soma-Chat-Token` on every request that isn't same-origin, and the
 * Vercel proxy attaches it on every outbound call. Without the token a
 * leaked tunnel hostname is still safe because the Mac will 401.
 */
import { NextRequest, NextResponse } from "next/server";

export type ChatMode = "local" | "proxy" | "gone";

/**
 * local  — this process can spawn `claude` (the Mac, or a dev server).
 * proxy  — the old Vercel path: forward to SOMA_CHAT_TUNNEL_URL.
 * gone   — Vercel with no tunnel URL: the chat moved to the Mac over the
 *          tailnet (#670); answer 410 instead of trying to spawn claude here.
 */
export function chatMode(): ChatMode {
  if (process.env.SOMA_CHAT_TUNNEL_URL) return "proxy";
  if (process.env.VERCEL) return "gone";
  return "local";
}

/** 410 for the Vercel routes once the tunnel is gone: the browser must call the Mac directly. */
export function chatGone(): NextResponse {
  return NextResponse.json(
    { error: "The chat runs on the Mac over the tailnet now; open soma from a tailnet device (NEXT_PUBLIC_SOMA_CHAT_BASE)." },
    { status: 410 },
  );
}

/**
 * Tailnet identity (#670). tailscale serve injects Tailscale-User-Login on
 * every proxied request and strips any client-supplied copy (probed
 * 2026-09-07: a spoofed header never reached the origin). The Mac listens on
 * loopback only, so a request carrying the configured login came through
 * serve from that tailnet user. No shared secret leaves the Mac.
 */
export function tailnetIdentityOk(req: NextRequest): boolean {
  const expected = process.env.SOMA_CHAT_TAILNET_LOGIN;
  if (!expected) return false;
  const got = req.headers.get("tailscale-user-login");
  return !!got && got.toLowerCase() === expected.toLowerCase();
}

/** The browser origin allowed to call the Mac's chat routes cross-origin (https://soma.gkos.dev). */
export function allowedChatOrigin(req: NextRequest): string | null {
  const allowed = (process.env.SOMA_CHAT_ALLOWED_ORIGIN ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  const origin = req.headers.get("origin");
  if (!origin || !allowed.includes(origin)) return null;
  return origin;
}

const CORS_METHODS = "GET, POST, PUT, OPTIONS";
const CORS_HEADERS = "content-type, x-soma-chat-token";

/** Add CORS headers for the allowed origin; a no-op for same-origin calls. */
export function withCors<T extends Response>(req: NextRequest, res: T): T {
  const origin = allowedChatOrigin(req);
  if (!origin) return res;
  try {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Methods", CORS_METHODS);
    res.headers.set("Access-Control-Allow-Headers", CORS_HEADERS);
    return res;
  } catch {
    // immutable headers (a fetch() Response): rebuild with the same body
    const copy = new Response(res.body, { status: res.status, statusText: res.statusText, headers: new Headers(res.headers) });
    copy.headers.set("Access-Control-Allow-Origin", origin);
    copy.headers.set("Vary", "Origin");
    copy.headers.set("Access-Control-Allow-Methods", CORS_METHODS);
    copy.headers.set("Access-Control-Allow-Headers", CORS_HEADERS);
    return copy as unknown as T;
  }
}

/** OPTIONS preflight for the chat routes: 204 for the allowed origin, 403 otherwise. */
export function chatPreflight(req: NextRequest): NextResponse {
  const origin = allowedChatOrigin(req);
  if (!origin) return new NextResponse(null, { status: 403 });
  const res = new NextResponse(null, { status: 204 });
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", CORS_METHODS);
  res.headers.set("Access-Control-Allow-Headers", CORS_HEADERS);
  res.headers.set("Access-Control-Max-Age", "600");
  return res;
}

/**
 * Gate a route on the shared secret. Returns a 401 NextResponse if the
 * request is missing/invalid; null if it's allowed.
 *
 * Rules:
 *   - If SOMA_CHAT_TOKEN is unset, no check (single-user local-only).
 *   - If the request looks same-origin (origin/host = localhost or
 *     127.0.0.1), no check — the user's own browser hitting localhost:3456
 *     doesn't need the secret.
 *   - Otherwise, X-Soma-Chat-Token header must match SOMA_CHAT_TOKEN.
 */
export function requireToken(req: NextRequest): NextResponse | null {
  const expected = process.env.SOMA_CHAT_TOKEN;
  if (!expected) return null;
  const origin = req.headers.get("origin") || "";
  const host = req.headers.get("host") || "";
  if (
    /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(origin) ||
    /^(localhost|127\.0\.0\.1)(:|$)/i.test(host)
  ) {
    return null;
  }
  if (tailnetIdentityOk(req)) return null;
  const got = req.headers.get("x-soma-chat-token");
  if (got !== expected) {
    return NextResponse.json(
      { error: "missing or invalid x-soma-chat-token" },
      { status: 401 }
    );
  }
  return null;
}

// Hop-by-hop headers we shouldn't forward across the proxy boundary.
const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "accept-encoding",
  "cookie",
  // The browser sends a localhost origin; the upstream Mac doesn't care
  // about it and it could confuse same-origin checks.
  "origin",
  "referer",
]);

function buildOutboundHeaders(req: NextRequest): Headers {
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!STRIP_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  const token = process.env.SOMA_CHAT_TOKEN;
  if (token) headers.set("x-soma-chat-token", token);
  return headers;
}

/**
 * Forward `req` to `${SOMA_CHAT_TUNNEL_URL}${subpath}` and stream the
 * upstream response back to the client unchanged.
 *
 * Used for SSE streaming (POST /api/chat), JSON (GET/PUT /api/chat/session,
 * GET /api/chat/history), and multipart (POST /api/chat/upload). The
 * stream body passes through verbatim so SSE events arrive at the browser
 * with their original timing.
 */
export async function proxyToLocal(
  req: NextRequest,
  subpath: string
): Promise<Response> {
  const base = process.env.SOMA_CHAT_TUNNEL_URL;
  if (!base) {
    return NextResponse.json(
      { error: "SOMA_CHAT_TUNNEL_URL not configured" },
      { status: 503 }
    );
  }
  const url = new URL(subpath, base).toString();

  const method = req.method;
  const headers = buildOutboundHeaders(req);
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    signal: req.signal,
  };
  if (method !== "GET" && method !== "HEAD") {
    // Stream the body straight through — works for SSE, JSON, multipart.
    init.body = req.body;
    init.duplex = "half"; // required by undici when sending a stream body
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "Local soma chat daemon unreachable. Is your Mac awake with `npm run dev` running and cloudflared connected?",
        detail: String(err),
      },
      { status: 502 }
    );
  }

  // Pass body + headers through. Strip a few that confuse Vercel's edge.
  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === "content-encoding" || k === "transfer-encoding") return;
    outHeaders.set(key, value);
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}
