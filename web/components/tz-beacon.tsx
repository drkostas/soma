"use client";

/**
 * Tells the server which timezone this device is in, by writing it into a cookie.
 *
 * The server cannot work it out: its own clock is the host's and the database's is New York's. So
 * the one place that knows is here, and a cookie is how it reaches a server render. Mounted once in
 * the root layout, so every page benefits without importing anything.
 *
 * ⚠️ THE FIRST RENDER OF A NEW SESSION CANNOT HAVE IT. The cookie is written after that render has
 * already been sent, so the fallback applies once and every render after it is his own zone. The
 * alternative is blocking the first paint on it, which is not worth being right one page sooner.
 */
import { useEffect } from "react";
import { TZ_COOKIE, TZ_COOKIE_MAX_AGE } from "@/lib/tz-cookie";

export function TzBeacon() {
  useEffect(() => {
    let tz = "";
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      return;
    }
    if (!tz) return;
    // Rewrite it every mount rather than only when absent: he may have flown, and the cost is a
    // string assignment.
    document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=${TZ_COOKIE_MAX_AGE}; samesite=lax`;
  }, []);
  return null;
}
