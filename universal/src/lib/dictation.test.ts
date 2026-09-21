import { describe, it, expect } from "vitest";
import { canDictate, dictateLabel, MAX_HINTS, mergeTranscript, MIN_SPEECH_MS, SILENCE_MS, speechOptions } from "./dictation";

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

describe("speechOptions", () => {
  /**
   * It stopped at ten seconds, every time, because `continuous: false` lets Android end the
   * utterance on its own silence timer. Ten seconds is not long enough to describe a plate,
   * especially while remembering what was on it.
   */
  it("does not let Android decide when he has finished", () => {
    expect(speechOptions([]).continuous).toBe(true);
  });

  it("gives a pause mid-sentence room, because a pause is thinking", () => {
    const o = speechOptions([]);
    expect(o.androidIntentOptions.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS).toBe(SILENCE_MS);
    expect(SILENCE_MS).toBeGreaterThanOrEqual(10000);
    expect(o.androidIntentOptions.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS).toBe(MIN_SPEECH_MS);
  });

  it("tells the recogniser his own words, which are the ones it destroys", () => {
    const o = speechOptions(["loukoumades", "mpiskotogluko"]);
    expect(o.contextualStrings).toEqual(["loukoumades", "mpiskotogluko"]);
  });

  it("caps the hints, because past a point they stop helping", () => {
    const many = Array.from({ length: 400 }, (_, i) => `word${i}`);
    expect(speechOptions(many).contextualStrings).toHaveLength(MAX_HINTS);
  });

  it("still asks for interim results, which is what makes it feel live", () => {
    expect(speechOptions([]).interimResults).toBe(true);
  });

  it("does not add punctuation, because the agent expects dictated text", () => {
    expect(speechOptions([]).addsPunctuation).toBe(false);
  });
});
