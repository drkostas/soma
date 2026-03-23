import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  // Demo mode: no auth required
  if (process.env.DEMO_MODE?.trim() === "true") return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Always allow auth routes, login page, and image API (used by sync pipeline)
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/webhooks/") ||
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
