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
  return `${b} ${t}`;
}

/**
 * The running text of a recognition session: what has been settled, and the guess in progress.
 *
 * ⛔ A CONTINUOUS SESSION ON ANDROID IS SEGMENTED, and this is why a plain merge is not enough. When
 * a segment reaches a final result, the next partial starts a NEW segment whose transcript covers
 * only that segment, not the whole utterance. Merging every event onto the text from before
 * recording therefore replaced the first half of a long sentence with the second half. It only
 * appears once the sentence is long enough to be segmented, which is exactly the sentence this
 * feature exists for.
 */
export interface Heard { committed: string; live: string }

/** Start from whatever was already in the box. */
export function heardStart(base: string): Heard {
  return { committed: base, live: "" };
}

/** Fold one recognition event in. A final result is settled; a partial one replaces the guess. */
export function heardNext(h: Heard, transcript: string, isFinal: boolean): Heard {
  if (isFinal) return { committed: mergeTranscript(h.committed, transcript), live: "" };
  return { committed: h.committed, live: transcript };
}

/** What belongs in the box right now. */
export function heardText(h: Heard): string {
  return mergeTranscript(h.committed, h.live);
}

/** Whether the mic should be offered at all. Hidden rather than shown broken. */
export function canDictate(available: boolean, permitted: boolean | null): boolean {
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
 *
 * ⭐ `keepAudio` KEEPS THE RECORDING, and that is the point of the spoken path. The phone's
 * recogniser is a small on-device model that has never heard of a loukoumas, and whatever it mangles
 * becomes the only record of the meal. Persisting the recording means a real model on the Mac reads
 * it afterwards and the audio survives, so a wrong reading can be compared against what was actually
 * said. The file lands in the cache directory and `audioend` carries its uri.
 *
 * ⚠️ Persisting needs Android 13 or newer, so the caller passes `supportsRecording()` rather than
 * `true`, and the browser cannot do it at all.
 *
 * ⚠️ NO CLAUDE MODEL TAKES AUDIO AS INPUT. Not through the API, and not in the Claude app, which
 * transcribes on the device exactly as this does. So the voice itself cannot reach the agent, and a
 * much better transcript is the honest best. Do not add an audio content block expecting it to work.
 */
export function speechOptions(words: readonly string[], keepAudio = false) {
  return {
    lang: "en-US",
    interimResults: true,
    continuous: true,
    addsPunctuation: false,
    requiresOnDeviceRecognition: false,
    contextualStrings: words.slice(0, MAX_HINTS),
    recordingOptions: { persist: keepAudio },
    androidIntentOptions: {
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
