import { describe, it, expect } from "vitest";
import { canDictate, dictateLabel, heardNext, heardStart, heardText, MAX_HINTS, mergeTranscript, MIN_SPEECH_MS, SILENCE_MS, speechOptions } from "./dictation";

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

describe("a segmented continuous session", () => {
  const fold = (base: string, events: [string, boolean][]) => {
    let h = heardStart(base);
    for (const [t, final] of events) h = heardNext(h, t, final);
    return heardText(h);
  };

  it("keeps a whole sentence that arrived in two segments", () => {
    // ⛔ THE BUG THIS GUARDS. Android finalises a segment mid-sentence and the next partial covers
    // only the new segment, so merging each event onto the starting text kept the last part alone.
    const said = fold("", [
      ["I ate a few bites of", false],
      ["I ate a few bites of mpiskotogluko", true],
      ["and a few more", false],
      ["and a few more from an ekmek kataifi", true],
    ]);
    expect(said).toBe("I ate a few bites of mpiskotogluko and a few more from an ekmek kataifi");
  });

  it("revises a guess in progress instead of repeating it", () => {
    expect(fold("", [["eight look", false], ["eight loukou", false], ["eight loukoumades", false]]))
      .toBe("eight loukoumades");
  });

  it("keeps what he typed before pressing Speak", () => {
    expect(fold("two eggs", [["and toast", true]])).toBe("two eggs and toast");
  });

  it("settles to the finals when the session ends", () => {
    expect(fold("", [["a banana", true], ["", false]])).toBe("a banana");
  });
});

describe("speechOptions", () => {
  it("does not stop at the first pause, which is what cut him off at ten seconds", () => {
    expect(speechOptions([]).continuous).toBe(true);
    expect(SILENCE_MS).toBeGreaterThanOrEqual(10000);
  });

  it("keeps the recording only when the caller says the phone can", () => {
    expect(speechOptions([], true).recordingOptions.persist).toBe(true);
    // The browser cannot persist and an older Android cannot either, so the default is off.
    expect(speechOptions([]).recordingOptions.persist).toBe(false);
  });

  it("hands his own food words to the recogniser", () => {
    expect(speechOptions(["loukoumades"]).contextualStrings).toContain("loukoumades");
  });
});
