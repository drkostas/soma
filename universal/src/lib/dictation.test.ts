import { describe, it, expect } from "vitest";
import { canDictate, dictateLabel, mergeTranscript } from "./dictation";

describe("mergeTranscript", () => {
  it("is the transcript when the box was empty", () => {
    expect(mergeTranscript("", "two eggs and a banana")).toBe("two eggs and a banana");
  });

  it("continues what was typed, with a space", () => {
    expect(mergeTranscript("two eggs", "and a banana")).toBe("two eggs and a banana");
  });

  it("replaces the previous guess rather than piling on, which is the whole point", () => {
    // Recognition revises the same utterance, so each event carries all of it. Rebuilding from
    // the base is what stops "two eggs two eggs and a banana".
    const base = "";
    expect(mergeTranscript(base, "two")).toBe("two");
    expect(mergeTranscript(base, "two eggs")).toBe("two eggs");
    expect(mergeTranscript(base, "two eggs and a banana")).toBe("two eggs and a banana");
  });

  it("leaves the box alone when nothing was heard", () => {
    expect(mergeTranscript("two eggs", "")).toBe("two eggs");
    expect(mergeTranscript("two eggs", "   ")).toBe("two eggs");
  });

  it("does not leave doubled or trailing spaces behind", () => {
    expect(mergeTranscript("  two eggs  ", "  and rice  ")).toBe("two eggs and rice");
  });
});

describe("canDictate", () => {
  it("offers the mic before permission has been asked, since the tap is the asking", () => {
    expect(canDictate(true, null)).toBe(true);
  });
  it("offers it once granted", () => {
    expect(canDictate(true, true)).toBe(true);
  });
  it("hides it when refused, rather than showing a button that cannot work", () => {
    expect(canDictate(true, false)).toBe(false);
  });
  it("hides it where recognition does not exist at all", () => {
    expect(canDictate(false, true)).toBe(false);
    expect(canDictate(false, null)).toBe(false);
  });
});

describe("dictateLabel", () => {
  it("says what the tap will do, not what is happening", () => {
    expect(dictateLabel(false)).toBe("Speak");
    expect(dictateLabel(true)).toBe("Stop");
  });
});
