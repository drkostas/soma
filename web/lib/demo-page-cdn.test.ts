import { describe, it, expect, afterEach } from "vitest";
import config from "../next.config";

const DEMO_PAGE_CDN = "max-age=21600, stale-while-revalidate=86400";

const saved = process.env.DEMO_MODE;
afterEach(() => {
  if (saved === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = saved;
});

type Rule = { source: string; headers: { key: string; value: string }[] };
const rules = async (): Promise<Rule[]> =>
  ((await (config as { headers?: () => Promise<Rule[]> }).headers?.()) ?? []) as Rule[];

describe("CDN caching of the demo's pages (#1233)", () => {
  it("lets Vercel's CDN keep the demo's pages for six hours", async () => {
    process.env.DEMO_MODE = "true";
    const [rule] = await rules();
    expect(rule.headers).toEqual([{ key: "Vercel-CDN-Cache-Control", value: DEMO_PAGE_CDN }]);
  });

  it("leaves /api and Next's own files alone, so the cron jobs still reach the function", async () => {
    process.env.DEMO_MODE = "true";
    const [rule] = await rules();
    // The source is a path pattern; its regular expression part must refuse api/ and _next/.
    const re = new RegExp("^/" + rule.source.replace("/:path(", "(") + "$");
    expect(re.test("/nutrition")).toBe(true);
    expect(re.test("/")).toBe(true);
    expect(re.test("/api/cron/hevy-sync")).toBe(false);
    expect(re.test("/api/sync/status")).toBe(false);
    expect(re.test("/_next/static/chunks/a.js")).toBe(false);
  });

  it("adds nothing outside the demo", async () => {
    delete process.env.DEMO_MODE;
    expect(await rules()).toEqual([]);
  });
});
