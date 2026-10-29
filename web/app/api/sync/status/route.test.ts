import { describe, it, expect, vi, afterEach } from "vitest";

// Every read the route makes returns no rows, which is enough to reach the "never synced" answer.
vi.mock("@/lib/db", () => ({ getDb: () => () => Promise.resolve([]) }));

import { GET } from "./route";

const saved = process.env.DEMO_MODE;
afterEach(() => {
  if (saved === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = saved;
});

describe("GET /api/sync/status, CDN caching on the demo (#1229)", () => {
  it("lets Vercel's CDN keep the demo's answer for an hour", async () => {
    process.env.DEMO_MODE = "true";
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Vercel-CDN-Cache-Control")).toBe("max-age=3600");
    expect((await res.json()).status).toBe("never");
  });

  it("is not cached outside the demo, where a sync can change it at any time", async () => {
    delete process.env.DEMO_MODE;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Vercel-CDN-Cache-Control")).toBeNull();
  });
});
