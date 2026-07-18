import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => mockSql }));

import { POST } from "./route";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/nutrition/close-day", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => mockSql.mockReset());

describe("POST /api/nutrition/close-day", () => {
  it("400s when date is missing", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("returns already_closed when the day is already closed", async () => {
    mockSql.mockResolvedValueOnce([{ status: "closed" }]); // the status pre-check
    const body = await (await POST(req({ date: "2026-07-16" }))).json();
    expect(body.status).toBe("already_closed");
  });
});
