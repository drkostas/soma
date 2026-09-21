/**
 * Turning speech into the text already in the box.
 *
 * ⚠️ THIS IS A DELIBERATE SECOND COPY of `universal/src/lib/dictation.ts`, like
 * `capture-status.ts` beside it, because the two packages cannot import from each other. The
 * copies are held identical by the app's `capture-status.drift.test.ts`, which compares both
 * files as text. Change them together.
 *
 * Recognition gives a running transcript that is revised as you speak, so each event carries the
 * whole utterance rather than the next word. Appending every event would repeat everything. The
 * rule is therefore to keep what was in the box when recording started and rebuild from that each
 * time, which makes a revision replace the previous guess instead of piling on top of it.
 */

/** What was in the box before recording, plus the latest transcript. */
export function mergeTranscript(base: string, transcript: string): string {
  const t = transcript.trim();
  const b = base.trim();
  if (!t) return b;
  if (!b) return t;
  // A space, not a newline: the agent's instructions expect dictated text in one breath, and a
  // second dictation is a continuation of the same sentence rather than a new line.
  return `${b} ${t}`;
}

/** Whether the mic should be offered at all. Hidden rather than shown broken. */
export function canDictate(available: boolean, permitted: boolean | null): boolean {
  // null means not asked yet, which is offerable: the tap is what asks.
  return available && permitted !== false;
}

/** The label for the control, so the two surfaces word it the same way. */
export function dictateLabel(recording: boolean): string {
  return recording ? "Stop" : "Speak";
}

/**
 * How to ask for recognition.
 *
 * ⛔ `continuous: false` IS WHY IT STOPPED AT TEN SECONDS. Android ends the utterance on its own
 * silence timer, and ten seconds is not long enough to describe a plate, especially while
 * remembering what was on it. The silence timeouts are set explicitly for the same reason: a pause
 * mid-sentence is thinking, not finishing.
 *
 * `contextualStrings` is his own food vocabulary. The words this destroys are Greek food names,
 * and they are sitting in his log.
 */
export function speechOptions(words: readonly string[]) {
  return {
    lang: "en-US",
    interimResults: true,
    // He decides when he has finished, by pressing Stop.
    continuous: true,
    addsPunctuation: false,
    requiresOnDeviceRecognition: false,
    contextualStrings: words.slice(0, MAX_HINTS),
    androidIntentOptions: {
      // A pause while thinking must not end the recording.
      EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: SILENCE_MS,
      EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: SILENCE_MS,
      EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: MIN_SPEECH_MS,
    },
  } as const;
}

/** Long enough to think mid-sentence without being cut off. */
export const SILENCE_MS = 10000;
/** A recording is never shorter than this, so a slow start is not taken for silence. */
export const MIN_SPEECH_MS = 2000;
/** Android caps how many hints it will take; past this they stop helping. */
export const MAX_HINTS = 100;
