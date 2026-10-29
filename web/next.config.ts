import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

/**
 * The public demo's data moves forward once a week, but every page view (crawlers included) ran
 * its queries, and the demo's database is billed for every minute it is awake after a request
 * (#1233). On a demo build the CDN serves pages for six hours instead, then refreshes them in the
 * background. `/api` is left alone, because the cron jobs in vercel.json must reach the function.
 * Only Vercel's CDN reads `Vercel-CDN-Cache-Control`; outside the demo nothing changes.
 */
const DEMO_PAGE_CDN = "max-age=21600, stale-while-revalidate=86400";

const nextConfig: NextConfig = {
  turbopack: {},
  transpilePackages: ["soma-style"],
  async headers() {
    if (process.env.DEMO_MODE?.trim() !== "true") return [];
    return [
      {
        source: "/:path((?!api/|_next/).*)",
        headers: [{ key: "Vercel-CDN-Cache-Control", value: DEMO_PAGE_CDN }],
      },
    ];
  },
};

export default withSerwist(nextConfig);
