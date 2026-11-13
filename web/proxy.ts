import { auth } from "@/auth";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { tailnetIdentityOk } from "@/lib/chat-transport";
import { devSessionAllowed } from "@/lib/dev-session";
import { countVisit } from "@/lib/visit-counter";

const isDev = process.env.NODE_ENV !== "production";

// In the demo these read-only API answers are fixed, so Vercel's CDN can hold them
// and a page view need not re-invoke a function. Cron, chat, auth and webhooks are
// left out: they must run or must stay fresh.
const DEMO_API_UNCACHED = ["/api/cron", "/api/chat", "/api/auth", "/api/webhooks"];
const DEMO_API_CDN_SECONDS = 3600;

/** Dev-only CORS so the universal Expo app can consume this API cross-origin. */
function withDevCors(res: NextResponse, isApi: boolean): NextResponse {
  if (isDev && isApi) {
    res.headers.set("Access-Control-Allow-Origin", "*");
    res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Soma-TZ");
  }
  return res;
}

/** Permissive CORS applied when a request authenticates via the personal API
    token (the native apps + iOS widgets), so a web client could use it too. */
function withTokenCors(res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Soma-TZ");
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

const authProxy = auth((req) => {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // The chat routes answer their own preflight with an origin allowlist (#670): the
  // browser calls the Mac over the tailnet from https://soma.gkos.dev.
  if (isApi && pathname.startsWith("/api/chat") && req.method === "OPTIONS") return NextResponse.next();

  // Optional error reports from any visitor's browser. The route forwards them only when a
  // collector is configured and always answers 204, so it is open like the page itself.
  if (pathname === "/api/client-error") return NextResponse.next();

  if (isDev && isApi && req.method === "OPTIONS") {
    return withDevCors(new NextResponse(null, { status: 204 }), true);
  }

  // Personal API token: native apps + widgets reach /api/* without a session.
  if (isApi && hasApiToken(req)) return withTokenCors(NextResponse.next());

  // Chat: the shared chat token (the old Vercel proxy) or the tailnet identity that
  // tailscale serve injects (#670) reaches /api/chat* without a session or demo mode.
  if (isApi && pathname.startsWith("/api/chat") && (hasChatToken(req) || tailnetIdentityOk(req))) return NextResponse.next();

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
    const res = withDevCors(NextResponse.next(), isApi);
    if (isApi && req.method === "GET" && !DEMO_API_UNCACHED.some((p) => pathname.startsWith(p))) {
      res.headers.set("Vercel-CDN-Cache-Control", `max-age=${DEMO_API_CDN_SECONDS}`);
    }
    return res;
  }

  // Always allow auth routes, login page, and the share-card + description APIs, which the sync
  // pipeline and the Strava bridge read without a session. The description route joined them in
  // soma#983: the re-finalize runs on a GitHub runner with no cookie, and a redirect to /login
  // would have it silently push the stored (empty) text instead.
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/cron/") ||
    pathname === "/login" ||
    pathname === "/api/sync/refresh-tokens" ||
    pathname.match(/^\/api\/(workout|activity)\/[^/]+\/(image|description)$/)
  ) {
    return NextResponse.next();
  }

  // Require session for everything else. The local verification server may stand in for one
  // (soma#854): SOMA_DEV_SESSION=1, loopback host, non-production build, all three.
  if (!req.auth && !devSessionAllowed(req)) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  // Optional visit counter: does nothing unless COLLECTOR_URL and COLLECTOR_TOKEN are set.
  countVisit(req, event);
  // The public demo serves static, public pages, so next-auth has nothing to do on
  // them. Returning here keeps the proxy off the cached-page path it would otherwise
  // run before the cache. /api still goes through authProxy (it guards mutations and
  // sets the demo read cache header).
  if (process.env.DEMO_MODE?.trim() === "true" && !req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }
  // next-auth types its wrapper as a route handler; as the proxy it takes the fetch event and passes it on.
  return authProxy(req, event as unknown as Parameters<typeof authProxy>[1]);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|soma-icon.png|sw\\.js|manifest\\.webmanifest).*)"],
};
