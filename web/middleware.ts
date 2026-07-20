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

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isDev && isApi && req.method === "OPTIONS") {
    return withDevCors(new NextResponse(null, { status: 204 }), true);
  }

  // Personal API token: native apps + widgets reach /api/* without a session.
  if (isApi && hasApiToken(req)) return withTokenCors(NextResponse.next());

  // Demo mode: no auth required
  if (process.env.DEMO_MODE?.trim() === "true") return withDevCors(NextResponse.next(), isApi);

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
