/**
 * The words the owner uses for amounts.
 *
 * His sentence was "I ate a few bites of a mpiskotogluko and a few more from an ekmek", and the
 * agent answered `{"kind":"bites","value":"a few"}`. `num()` could not read it, `parseProposal`
 * returned null, and the whole meal was discarded over one word. Worse, it was intermittent: the
 * same capture had succeeded earlier when the model happened to send `3`.
 */
import { describe, it, expect } from "vitest";
import { parseProposal, readCount, VAGUE_COUNTS } from "./nutrition-agent";

describe("readCount", () => {
  it("reads a number as itself", () => {
    expect(readCount(3)).toBe(3);
    expect(readCount("3")).toBe(3);
    expect(readCount(0.5)).toBe(0.5);
    expect(readCount(0)).toBe(0);
  });

  it("reads the words he actually writes", () => {
    expect(readCount("a few")).toBe(3);
    expect(readCount("a couple")).toBe(2);
    expect(readCount("a couple of")).toBe(2);
    expect(readCount("half")).toBe(0.5);
    expect(readCount("a handful")).toBe(3);
    expect(readCount("several")).toBe(4);
  });

  it("does not care about case or spacing", () => {
    expect(readCount("  A  Few ")).toBe(3);
    expect(readCount("A COUPLE OF")).toBe(2);
  });

  it("is null for something that names no number at all", () => {
    expect(readCount("loads")).toBeNull();
    expect(readCount(null)).toBeNull();
    expect(readCount({})).toBeNull();
  });

  it("is null for a blank, because Number(\"\") is 0 and a blank means nobody said", () => {
    expect(readCount("")).toBeNull();
    expect(readCount("   ")).toBeNull();
  });

  it("has no entry that is not a number, because these reach arithmetic", () => {
    for (const v of Object.values(VAGUE_COUNTS)) expect(Number.isFinite(v)).toBe(true);
  });
});

/** The real rejected answer, trimmed to the shape that matters. */
const proposal = (quantity: unknown) => ({
  slot: "lunch", tense: "eaten", summary: "Logged lunch: a few bites.",
  items: [{
    query: "mpiskotogluko (Greek biscuit-cream dessert)",
    ingredient_id: "mpiskotogluko_greek_biscuit_cream_dessert",
    quantity, source: "off", confidence: 0.5,
  }],
});

describe("parseProposal and an amount it cannot read", () => {
  it("reads the real answer that used to be thrown away", () => {
    const p = parseProposal(proposal({ kind: "bites", value: "a few" }));
    expect(p).not.toBeNull();
    expect(p!.items[0].quantity).toEqual({ kind: "bites", value: 3 });
  });

  it("keeps the food and calls the amount unknown, rather than discarding the meal", () => {
    // `unknown` already means "soma will fit it", which is the honest reading of an amount
    // nobody could parse.
    const p = parseProposal(proposal({ kind: "bites", value: "loads and loads" }));
    expect(p).not.toBeNull();
    expect(p!.items[0].ingredient_id).toBe("mpiskotogluko_greek_biscuit_cream_dessert");
    expect(p!.items[0].quantity).toEqual({ kind: "unknown" });
  });

  it("still refuses a quantity that is not an object at all", () => {
    expect(parseProposal(proposal("three bites"))).toBeNull();
    expect(parseProposal(proposal(null))).toBeNull();
  });

  it("leaves a negative amount as unknown rather than logging a negative food", () => {
    const p = parseProposal(proposal({ kind: "grams", value: -200 }));
    expect(p!.items[0].quantity).toEqual({ kind: "unknown" });
  });

  it("keeps a portion word working, which goes down a different branch", () => {
    const p = parseProposal(proposal({ kind: "portion", value: "large" }));
    expect(p!.items[0].quantity).toEqual({ kind: "portion", value: "large" });
  });
});
