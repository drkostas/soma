import { describe, it, expect, beforeEach } from "vitest";
import { healGarminTokenRow, resetGarminTokenHealForTests, GARMIN_TOKEN_PLATFORM } from "./garmin-token-heal";
import type { QueryFn } from "./db";

function recorder(result: unknown[] | Error) {
  const queries: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join("?").replace(/\s+/g, " ").trim(), values });
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve(result);
  }) as unknown as QueryFn;
  return { sql, queries };
}

describe("healGarminTokenRow (#723, port of hevy2garmin#459)", () => {
  beforeEach(() => resetGarminTokenHealForTests());

  it("issues the flat→nested UPDATE, guarded so an already-nested row is untouched", async () => {
    const { sql, queries } = recorder([]);
    const n = await healGarminTokenRow(sql);
    expect(n).toBe(0);
    expect(queries).toHaveLength(1);
    const q = queries[0].text;
    expect(q).toContain("UPDATE platform_credentials SET credentials = jsonb_build_object('garmin_tokens', credentials)");
    expect(q).toContain("WHERE platform = ?");
    expect(q).toContain("credentials ? 'di_token'");
    expect(q).toContain("NOT (credentials ? 'garmin_tokens')");
    expect(q).toContain("RETURNING platform");
    expect(queries[0].values).toEqual([GARMIN_TOKEN_PLATFORM]);
    expect(GARMIN_TOKEN_PLATFORM).toBe("garmin_tokens");
  });

  it("reports how many rows it nested", async () => {
    const { sql } = recorder([{ platform: "garmin_tokens" }]);
    expect(await healGarminTokenRow(sql)).toBe(1);
  });

  it("runs once per process per platform: the second call does not touch the DB", async () => {
    const { sql, queries } = recorder([]);
    await healGarminTokenRow(sql);
    await healGarminTokenRow(sql);
    expect(queries).toHaveLength(1);
    await healGarminTokenRow(sql, "garmin_scratch");
    expect(queries).toHaveLength(2);
    expect(queries[1].values).toEqual(["garmin_scratch"]);
  });

  it("never throws: a failing query returns null and leaves the next attempt free to retry", async () => {
    const { sql, queries } = recorder(new Error("relation platform_credentials does not exist"));
    await expect(healGarminTokenRow(sql)).resolves.toBeNull();
    await healGarminTokenRow(sql);
    expect(queries).toHaveLength(2);
  });
});
