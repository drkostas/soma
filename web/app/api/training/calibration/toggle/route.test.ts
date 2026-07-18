import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/db", () => ({ getDb: () => mockSql }));

import { POST } from "./route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/training/calibration/toggle", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => mockSql.mockClear());

describe("POST /api/training/calibration/toggle", () => {
  it("400s when forceEqual is not a boolean (no DB write)", async () => {
    const res = await POST(req({ forceEqual: "yes" }));
    expect(res.status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("updates calibration_state and echoes forceEqual", async () => {
    const res = await POST(req({ forceEqual: true }));
    expect(await res.json()).toEqual({ ok: true, forceEqual: true });
    expect(mockSql).toHaveBeenCalledOnce();
  });
});
