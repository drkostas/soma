import { describe, it, expect } from "vitest";
import { buildVocabulary, cleanWord, MAX_WORDS, SEED_WORDS, usefulWord } from "./capture-vocabulary";

describe("cleanWord", () => {
  it("drops the parenthetical, which is the weaker half of a catalogue name", () => {
    expect(cleanWord("loukoumades (Greek honey donuts)")).toBe("loukoumades");
    expect(cleanWord("mpifteki (Greek chicken meatball patty)")).toBe("mpifteki");
  });
  it("collapses the whitespace a stripped parenthetical leaves behind", () => {
    expect(cleanWord("ekmek  (a)  kataifi")).toBe("ekmek kataifi");
  });
  it("leaves an ordinary name alone", () => {
    expect(cleanWord("Chicken Breast (raw)")).toBe("Chicken Breast");
    expect(cleanWord("feta")).toBe("feta");
  });
});

describe("usefulWord", () => {
  it("keeps a real food name", () => {
    expect(usefulWord("loukoumades")).toBe(true);
    expect(usefulWord("ekmek kataifi")).toBe(true);
  });
  it("rejects an id, which helps nobody say anything", () => {
    expect(usefulWord("mpiskotogluko_greek_biscuit_cream_dessert")).toBe(false);
    expect(usefulWord("eggs_whole")).toBe(false);
  });
  it("rejects something too short or too long to be spoken as a hint", () => {
    expect(usefulWord("ab")).toBe(false);
    expect(usefulWord("x".repeat(60))).toBe(false);
  });
  it("rejects something with no letters at all", () => {
    expect(usefulWord("500")).toBe(false);
    expect(usefulWord("   ")).toBe(false);
  });
});

describe("buildVocabulary", () => {
  it("puts the seeds first, because they are the words that get destroyed", () => {
    const v = buildVocabulary(["Chicken Breast (raw)"]);
    expect(v[0]).toBe("loukoumades");
    expect(v).toContain("Chicken Breast");
  });

  it("does not repeat a word the catalogue also holds", () => {
    const v = buildVocabulary(["loukoumades (Greek honey donuts)", "LOUKOUMADES"]);
    expect(v.filter((w) => w.toLowerCase() === "loukoumades")).toHaveLength(1);
  });

  it("keeps the order it was given, which is most-logged first", () => {
    const v = buildVocabulary(["rice", "chicken"], []);
    expect(v).toEqual(["rice", "chicken"]);
  });

  it("stops at the cap, because both consumers degrade with a long list", () => {
    const many = Array.from({ length: 500 }, (_, i) => `food number ${i}`);
    expect(buildVocabulary(many).length).toBe(MAX_WORDS);
  });

  it("drops the ids rather than spending the cap on them", () => {
    const v = buildVocabulary(["eggs_whole", "sheep_milk_yogurt", "real name"], []);
    expect(v).toEqual(["real name"]);
  });

  it("has seeds that would all survive its own filter", () => {
    for (const s of SEED_WORDS) expect(usefulWord(cleanWord(s)), s).toBe(true);
  });
});
