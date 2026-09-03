import { auth } from "@/auth";
import { NextResponse } from "next/server";

const isDev = process.env.NODE_ENV !== "production";

/** Dev-only CORS so the universal Expo app can consume this API cross-origin. */
function withDevCors(res: NextResponse, isApi: boolean): NextResponse {
  if (isDev && isApi) {
    res.headers.set("Access-Control-Allow-Origin", "*");
    res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  return res;
}

/** Permissive CORS applied when a request authenticates via the personal API
    token (the native apps + iOS widgets), so a web client could use it too. */
function withTokenCors(res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res;
}

/** Does the request carry the valid personal API token? Lets native clients
    (Expo apps, widgets) reach /api/* without a browser session. Scoped to
    /api/* only — the web UI stays session-gated. */
function hasApiToken(req: { headers: Headers }): boolean {
  const token = process.env.SOMA_API_TOKEN?.trim();
  if (!token) return false;
  return req.headers.get("authorization") === `Bearer ${token}`;
}

/** Does the request carry the shared chat-tunnel token? The Vercel proxy sets it on every
    forwarded /api/chat* request (chat-transport.ts). Scoped to /api/chat* only; the chat routes
    validate it again (requireToken). Without this, the tunnel only worked while DEMO_MODE let
    anonymous requests through — the demo gate was doing the boundary's job (soma#671). */
function hasChatToken(req: { headers: Headers }): boolean {
  const token = process.env.SOMA_CHAT_TOKEN?.trim();
  if (!token) return false;
  return req.headers.get("x-soma-chat-token") === token;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isDev && isApi && req.method === "OPTIONS") {
    return withDevCors(new NextResponse(null, { status: 204 }), true);
  }

  // Personal API token: native apps + widgets reach /api/* without a session.
  if (isApi && hasApiToken(req)) return withTokenCors(NextResponse.next());

  // Chat tunnel: the shared chat token reaches /api/chat* without a session or demo mode.
  if (isApi && pathname.startsWith("/api/chat") && hasChatToken(req)) return NextResponse.next();

  // Demo mode: READ-ONLY. Reads and page views need no auth, but every /api/*
  // handler runs auth-less here, so an anonymous visitor could otherwise POST/
  // DELETE straight into the shared DB (log/close-day/delete-rule/…). Block all
  // mutating methods on /api/* at this single choke point.
  if (process.env.DEMO_MODE?.trim() === "true") {
    const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
    if (isApi && isMutation) {
      return withDevCors(
        NextResponse.json({ error: "This is a read-only demo." }, { status: 403 }),
        true,
      );
    }
    return withDevCors(NextResponse.next(), isApi);
  }

  // Always allow auth routes, login page, and image API (used by sync pipeline)
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/cron/") ||
    pathname === "/login" ||
    pathname === "/api/sync/refresh-tokens" ||
    pathname.match(/^\/api\/(workout|activity)\/[^/]+\/image$/)
  ) {
    return NextResponse.next();
  }

  // Require session for everything else
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|soma-icon.png|sw\\.js|manifest\\.webmanifest).*)"],
};
