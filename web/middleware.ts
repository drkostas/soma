import { auth } from "@/auth";
import { NextResponse } from "next/server";

const isDev = process.env.NODE_ENV !== "production";

/** Dev-only CORS so the universal Expo app can consume this API cross-origin. */
function withDevCors(res: NextResponse, isApi: boolean): NextResponse {
  if (isDev && isApi) {
    res.headers.set("Access-Control-Allow-Origin", "*");
    res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  return res;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isDev && isApi && req.method === "OPTIONS") {
    return withDevCors(new NextResponse(null, { status: 204 }), true);
  }

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
