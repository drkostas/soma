import { describe, it, expect } from "vitest";
import { loadRunStatus } from "./run-status-query";

/**
 * The card must not claim there were no runs when it simply has no load data
 * (#1004). Found on the demo, where `training_load` does not exist at all and
 * the card said "no run recorded" beside "25 runs tracked · 222 km total".
 */

/** A tagged-template sql that answers the two queries this module makes. */
function sqlWith({ runRows = [] as unknown[], anyRows = [] as unknown[], throwOn = "" }) {
  return ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (throwOn && text.includes(throwOn)) return Promise.reject(new Error('relation "training_load" does not exist'));
    if (text.includes("LIMIT 1")) return Promise.resolve(anyRows);
    return Promise.resolve(runRows);
  }) as never;
}

const TODAY = "2026-09-22";

describe("no load data", () => {
  it("says unknown when the table does not exist", async () => {
    const s = await loadRunStatus(sqlWith({ throwOn: "training_load" }), TODAY);
    expect(s.kind).toBe("unknown");
  });

  it("says unknown when the table exists but nothing has ever written it", async () => {
    const s = await loadRunStatus(sqlWith({ runRows: [], anyRows: [] }), TODAY);
    expect(s.kind).toBe("unknown");
  });
});

describe("real data", () => {
  it("still says there were no runs when the table is populated and running is absent", async () => {
    // The claim is true here and it is the useful one, so it must survive.
    const s = await loadRunStatus(sqlWith({ runRows: [], anyRows: [{ present: 1 }] }), TODAY);
    expect(s.kind).toBe("none");
    expect(s.label).toBe("No runs in 4 weeks");
  });

  it("reads a trend when there are runs", async () => {
    const runRows = Array.from({ length: 12 }, (_, i) => ({
      date: `2026-09-${String(10 + (i % 12)).padStart(2, "0")}`,
      load: 40,
    }));
    const s = await loadRunStatus(sqlWith({ runRows }), TODAY);
    expect(s.kind).not.toBe("unknown");
    expect(s.runs28).toBeGreaterThan(0);
  });
});
