/**
 * Turning speech into the text already in the box.
 *
 * ⚠️ THIS IS A DELIBERATE SECOND COPY of `web/lib/dictation.ts`, like `capture-status.ts` beside
 * it, because the two packages cannot import from each other. The copies are held identical by
 * `capture-status.drift.test.ts`, which compares both files as text. Change them together.
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
