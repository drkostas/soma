import { describe, it, expect } from "vitest";
import { isUploadCandidate, filterUploadCandidates } from "./hevy-upload";

describe("upload dedup — isUploadCandidate (the never-duplicate guard)", () => {
  const sent = new Set<string>(["already-sent"]);

  it("only 'enriched' status is eligible", () => {
    expect(isUploadCandidate("enriched", "w1", sent)).toBe(true);
    expect(isUploadCandidate("uploaded", "w1", sent)).toBe(false); // matched to existing → excluded
    expect(isUploadCandidate("pending", "w1", sent)).toBe(false);
  });

  it("anything already in the sent ledger is excluded even if 'enriched'", () => {
    expect(isUploadCandidate("enriched", "already-sent", sent)).toBe(false);
  });
});

describe("filterUploadCandidates — combined dedup", () => {
  it("keeps only fresh enriched, unsent workouts", () => {
    const rows = [
      { hevy_id: "fresh", status: "enriched" },       // upload
      { hevy_id: "onGarmin", status: "uploaded" },    // already matched → skip
      { hevy_id: "sent", status: "enriched" },        // in ledger → skip
      { hevy_id: "fresh2", status: "enriched" },      // upload
    ];
    expect(filterUploadCandidates(rows, new Set(["sent"]))).toEqual(["fresh", "fresh2"]);
  });

  it("empty when everything is matched or sent", () => {
    const rows = [
      { hevy_id: "a", status: "uploaded" },
      { hevy_id: "b", status: "enriched" },
    ];
    expect(filterUploadCandidates(rows, new Set(["b"]))).toEqual([]);
  });

  it("empty input → empty output", () => {
    expect(filterUploadCandidates([], new Set())).toEqual([]);
  });
});
