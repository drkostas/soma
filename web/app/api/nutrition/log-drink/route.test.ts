import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/db", () => ({ getDb: () => mockSql }));

import { GET, POST } from "./route";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/nutrition/log-drink", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => mockSql.mockClear());

describe("/api/nutrition/log-drink", () => {
  it("GET returns the drink catalog", async () => {
    const body = await (await GET()).json();
    expect(body.drinks).toBeDefined();
    expect(body.drinks.beer_light).toMatchObject({ name: expect.any(String) });
  });

  it("POST 400s when date or drink_type is missing", async () => {
    const res = await POST(req({ date: "2026-07-16" }));
    expect(res.status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("POST 400s on an unknown drink_type", async () => {
    const res = await POST(req({ date: "2026-07-16", drink_type: "not_a_drink" }));
    expect(res.status).toBe(400);
  });
});
