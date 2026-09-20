/**
 * Where a sentence has got to, in words.
 *
 * ⚠️ THIS IS A DELIBERATE SECOND COPY OF `web/lib/capture-status.ts`, for the same reason
 * `slotForHour` is copied in `meal-capture.ts`: the app cannot import from the web package. The
 * two are kept honest by `capture-status.drift.test.ts`, which imports both and compares their
 * answers over a table of cases, so a change to one of them fails the suite rather than quietly
 * making the app say something different from the website.
 *
 * Change this file and the web one together.
 */
import type { CaptureMessage, CaptureMode, CaptureStatus } from "./meal-capture";

/** What a status strip renders. Deliberately not the proposal, which the strip never shows. */
export interface CaptureCard {
  id: number;
  slot: string | null;
  mode: CaptureMode;
  status: CaptureStatus;
  /** The first thing the owner said, so two captures in the same slot are tellable apart. */
  said: string;
  /** The agent's one-line account of what it made of it, once it has one. */
  summary: string | null;
  /** Set only when the agent could identify nothing and asked instead. */
  question: string | null;
  mealLogId: number | null;
  /** The last failure, which is present on a capture that is waiting to be tried again. */
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

/** A capture nothing more will happen to on its own. */
export function isSettled(c: Pick<CaptureCard, "status" | "question">): boolean {
  if (c.status === "captured" || c.status === "running") return false;
  // A question is terminal for the machine and open for the owner, so the strip stops polling
  // but keeps showing it.
  return true;
}

/** True while anything on screen is still moving, which is the only reason to poll. */
// `T[]` rather than `Array<T>`: the app package forbids `Array<T>`, and this file is copied
// there byte for byte, so it has to satisfy the stricter of the two lint configs.
export function anyInFlight(cards: Pick<CaptureCard, "status" | "question">[]): boolean {
  return cards.some((c) => !isSettled(c));
}

/**
 * The headline. It must never overstate: `captured` means nothing has read it yet, and on the
 * phone that genuinely takes up to a minute, because the agent runs on the Mac.
 */
export function captureHeadline(c: Pick<CaptureCard, "status" | "question" | "mode" | "attempts">): string {
  switch (c.status) {
    case "captured":
      return c.attempts > 0 ? "Waiting to be read again" : "Waiting to be read";
    case "running":
      return "Reading it now";
    case "ready":
      if (c.question) return "It asked you something";
      return c.mode === "calibrate" ? "Ready for you to check" : "Ready";
    case "logged":
      return "Logged";
    case "failed":
      return "Could not read it";
  }
}

/** The second line, or nothing when there is nothing honest to put there. */
export function captureDetail(c: Pick<CaptureCard, "status" | "question" | "summary" | "error">): string | null {
  if (c.question) return c.question;
  if (c.status === "failed") return c.error;
  if (c.status === "captured" && c.error) return `Last try: ${c.error}`;
  return c.summary;
}

/** How long ago, short enough to sit at the end of a line. */
export function shortAgo(iso: string, now = Date.now()): string {
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** The first thing the owner said, which is what tells two captures in one slot apart. */
export function saidOf(messages: CaptureMessage[] | null | undefined): string {
  const first = (messages ?? []).find((m) => m.role === "user");
  if (!first) return "";
  const text = (first.text ?? "").trim();
  if (text) return text;
  return first.image ? "a photo" : "";
}

/**
 * A question, and only a question. The agent may come back empty-handed with a sentence asking
 * for the one thing it could not work out, and that case is `items` empty plus `question` set.
 * A proposal that resolved food is not asking, whatever else it carries.
 */
export function questionOf(proposal: unknown): string | null {
  if (!proposal || typeof proposal !== "object") return null;
  const p = proposal as { items?: unknown; question?: unknown };
  if (Array.isArray(p.items) && p.items.length) return null;
  return typeof p.question === "string" && p.question.trim() ? p.question.trim() : null;
}

/** The agent's last word, which is its summary once it has resolved something. */
export function summaryOf(messages: CaptureMessage[] | null | undefined): string | null {
  const agent = (messages ?? []).filter((m) => m.role === "agent");
  const last = agent[agent.length - 1];
  return last?.text?.trim() ? last.text.trim() : null;
}

/** How many finished captures are worth keeping on screen once they are finished. */
export const SETTLED_SHOWN = 2;

/**
 * What the strip renders. Everything still moving, because that is the question being answered,
 * plus the last couple of finished ones for reassurance. A busy day otherwise pushes the rest of
 * the screen down with rows nobody is waiting on.
 *
 * A question counts as settled for the poller but is kept here regardless: it is addressed to the
 * owner, so it stays until it is answered.
 */
export function stripCards<T extends Pick<CaptureCard, "status" | "question">>(cards: T[]): T[] {
  const out: T[] = [];
  let settled = 0;
  for (const c of cards) {
    if (!isSettled(c) || c.question) { out.push(c); continue; }
    if (settled < SETTLED_SHOWN) { out.push(c); settled++; }
  }
  return out;
}
