import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { garminWeightBody, pushWeightsToGarmin, PUSHABLE_SOURCES } from "./weight-push";

describe("garminWeightBody", () => {
  it("sends kilograms, because grams are soma's unit and not Garmin's", () => {
    expect(garminWeightBody({ id: 1, date: "2026-09-24", weight_grams: 73400, measured_at: null }))
      .toEqual({ dateTimestamp: "2026-09-24T08:00:00.000", unitKey: "kg", value: 73.4 });
  });

  it("uses the moment he stood on the scale when it is known", () => {
    const b = garminWeightBody({ id: 1, date: "2026-09-24", weight_grams: 73400, measured_at: "2026-09-24T05:12:00.000Z" });
    expect(b.dateTimestamp).toBe("2026-09-24T05:12:00.000");
    expect(b.dateTimestamp).not.toContain("Z");
  });
});

describe("pushWeightsToGarmin", () => {
  const rows = [
    { id: 1, date: "2026-09-24", weight_grams: 73400, measured_at: null },
    { id: 2, date: "2026-09-23", weight_grams: 73800, measured_at: null },
  ];

  function fakeSql(owed: typeof rows) {
    const marked: number[] = [];
    const sql = (async (strings: TemplateStringsArray, ...vals: unknown[]) => {
      const q = strings.join("?");
      if (q.includes("SELECT id")) return owed;
      if (q.includes("UPDATE weight_log")) { marked.push(Number(vals[0])); return []; }
      return [];
    }) as never;
    return { sql, marked };
  }

  it("pushes each and marks it", async () => {
    const { sql, marked } = fakeSql(rows);
    const sent: unknown[] = [];
    const r = await pushWeightsToGarmin(sql, { post: async <T>(_p: string, b: unknown) => { sent.push(b); return {} as T; } });
    expect(r).toEqual({ pushed: 2, failed: 0, errors: [] });
    expect(marked).toEqual([1, 2]);
    expect(sent).toHaveLength(2);
  });

  it("⛔ marks one at a time, so a failure halfway does not re-send what landed", async () => {
    const { sql, marked } = fakeSql(rows);
    let n = 0;
    const r = await pushWeightsToGarmin(sql, {
      post: async <T>() => { if (++n === 2) throw new Error("Garmin said 500"); return {} as T; },
    });
    expect(r.pushed).toBe(1);
    expect(r.failed).toBe(1);
    // Only the one that succeeded is marked; the other stays owed and is retried next run.
    expect(marked).toEqual([1]);
    expect(r.errors[0]).toContain("2026-09-23 73.8kg");
  });

  it("names which weigh-in failed, rather than counting them", async () => {
    const { sql } = fakeSql([rows[0]]);
    const r = await pushWeightsToGarmin(sql, { post: async <T>(): Promise<T> => { throw new Error("401 unauthorised"); } });
    expect(r.errors[0]).toContain("2026-09-24");
    expect(r.errors[0]).toContain("401");
  });

  it("⛔ pushes ONLY what soma originates, because every other source is Garmin's own", () => {
    // I had MANUAL in this list, which reads as "typed into soma" and means "typed into Garmin".
    // A check run then duplicated 29 of his March-to-May weigh-ins back into his account.
    expect([...PUSHABLE_SOURCES]).toEqual(["HEALTH_CONNECT"]);
    for (const garminOwned of ["MANUAL", "manual", "USER_SETTING", "INDEX_SCALE", "MFP"]) {
      expect(PUSHABLE_SOURCES as readonly string[]).not.toContain(garminOwned);
    }
  });
});

/**
 * ⛔ THE BUG THIS PINS IS "IT EXISTS BUT NOTHING CALLS IT", WHICH ALREADY HAPPENED TO THIS FILE.
 *
 * `pushWeightsToGarmin` shipped with its tests and no caller, so weigh-ins landed in soma and stopped
 * there while every unit test stayed green. The same defect was found six times during the
 * hevy2garmin parity audit. A unit test cannot catch it, because the pipeline is a script with
 * side effects at import and nothing can load it, so this reads the source instead.
 */
describe("the hourly pipeline actually calls it", () => {
  const pipeline = readFileSync(
    new URL("../scripts/sync-pipeline.mts", import.meta.url),
    "utf8",
  );

  it("imports the pusher", () => {
    expect(pipeline).toContain('from "../lib/weight-push"');
  });

  it("calls it inside the block that holds an authenticated Garmin client", () => {
    expect(pipeline).toMatch(/pushWeightsToGarmin\(sql, garminClient!\)/);
    // The call has to be inside `if (garminClient) {`, or it runs with a null client.
    const guard = pipeline.indexOf("if (garminClient) {");
    const call = pipeline.indexOf("pushWeightsToGarmin(sql, garminClient!)");
    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(guard);
  });

  it("runs as a named step, so a failure is recorded rather than thrown away", () => {
    expect(pipeline).toContain('await step("weight-push"');
  });
});
