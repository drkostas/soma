import { describe, it, expect } from "vitest";
import { promptFor, parseTranscription, textForAgent, MAX_PROMPT_CHARS } from "./transcribe";

describe("promptFor", () => {
  it("names his foods, because that is the whole reason the prompt exists", () => {
    const p = promptFor(["loukoumades", "mpiskotogluko", "ekmek kataifi"]);
    expect(p).toContain("loukoumades");
    expect(p).toContain("mpiskotogluko");
  });

  it("is empty with nothing to say, rather than a sentence with a dangling colon", () => {
    expect(promptFor([])).toBe("");
    expect(promptFor(["a", "of"])).toBe("");
  });

  it("⛔ stays inside whisper's prompt window, which truncates from the FRONT", () => {
    // 120 Greek food names came to roughly 320 tokens and lost "loukoumades" off the start.
    const many = Array.from({ length: 200 }, (_, i) => `galaktoboureko${i}`);
    const p = promptFor(many);
    expect(p).toContain("galaktoboureko0");
    expect(p.length).toBeLessThan(MAX_PROMPT_CHARS + 60);
  });

  it("keeps the words that matter, which are the ones at the front", () => {
    const real = ["loukoumades", "mpiskotogluko", "ekmek kataifi", ...Array.from({ length: 120 }, (_, i) => `filler${i}`)];
    const p = promptFor(real);
    expect(p).toContain("loukoumades");
    expect(p).toContain("mpiskotogluko");
    expect(p).toContain("ekmek kataifi");
  });
});

describe("parseTranscription", () => {
  it("reads the script's line", () => {
    const t = parseTranscription('{"text":"I ate eight loukoumades","model":"small","seconds":2.1}\n');
    expect(t?.text).toBe("I ate eight loukoumades");
    expect(t?.source).toBe("whisper-small");
    expect(t?.seconds).toBe(2.1);
  });

  it("ignores anything printed before the json, because warnings go to stdout too", () => {
    const t = parseTranscription('loading model\n{"text":"a banana","model":"small"}\n');
    expect(t?.text).toBe("a banana");
  });

  it("is null on an empty reading, so silence is not logged as a meal", () => {
    expect(parseTranscription('{"text":"","model":"small"}')).toBeNull();
    expect(parseTranscription("")).toBeNull();
    expect(parseTranscription("Traceback (most recent call last):")).toBeNull();
  });
});

describe("textForAgent", () => {
  it("uses the better reading when he never touched the box", () => {
    const m = { text: "I ate biscuit glucose", heard: "I ate biscuit glucose" };
    expect(textForAgent(m, "I ate mpiskotogluko")).toBe("I ate mpiskotogluko");
  });

  it("⛔ keeps HIS correction, which is the bug this function exists to prevent", () => {
    const m = { text: "I ate two mpifteki", heard: "I ate two beef teky" };
    expect(textForAgent(m, "I ate two beefsteak")).toBe("I ate two mpifteki");
  });

  it("uses the reading when the phone heard nothing at all", () => {
    expect(textForAgent({ text: "", heard: null }, "eight loukoumades")).toBe("eight loukoumades");
  });

  it("keeps the phone's words when there is no reading, so a dead python loses nothing", () => {
    const m = { text: "I ate an omelette", heard: "I ate an omelette" };
    expect(textForAgent(m, null)).toBe("I ate an omelette");
    expect(textForAgent(m, "   ")).toBe("I ate an omelette");
  });

  it("ignores trailing space, which the recogniser adds and the box keeps", () => {
    const m = { text: "yogurt and a banana ", heard: "yogurt and a banana" };
    expect(textForAgent(m, "yogurt and a banana")).toBe("yogurt and a banana");
  });
});
