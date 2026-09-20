/**
 * The meal_capture row: the owner's words, the thread they grew into, and where it has got to.
 *
 * The capture is the only part of this feature whose reliability really matters, because it is the
 * one holding something that cannot be recomputed. Everything downstream can be retried.
 */
import type { QueryFn } from "./db";

export type CaptureStatus = "captured" | "running" | "ready" | "logged" | "failed";
export type CaptureMode = "log" | "calibrate";
export type CaptureEvent = "start" | "resolved_log" | "resolved_calibrate" | "error" | "follow_up";

export interface CaptureMessage {
  role: "user" | "agent";
  text: string;
  image: string | null;
  at: string;
}

export const MAX_ATTEMPTS = 2;

/**
 * The meal slot for a time of day, using the same boundaries the widgets already use, so every
 * surface agrees on where a sentence lands without passing a slot around.
 *
 * ⛔ THIS LIVES HERE RATHER THAN IN THE ROUTE ON PURPOSE. A Next 16 route file may export only
 * the HTTP handlers and a fixed set of config keys; any other export fails the generated route
 * type check. `tsc --noEmit` cannot see that, because the types it checks against are written
 * during `next build`, so the only way to catch it before CI is to run the build.
 */
export function slotForHour(h: number): string {
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 21) return "dinner";
  return "pre_sleep";
}

/** Append without mutating, so a caller can keep the previous thread to compare against. */
export function appendMessage(thread: CaptureMessage[], msg: CaptureMessage): CaptureMessage[] {
  return [...thread, msg];
}

/** The state machine, kept pure so every transition can be read in one place. */
export function nextStatus(current: CaptureStatus, event: CaptureEvent, attempts = 0): CaptureStatus {
  // A follow-up reopens anything, including a meal already logged: the owner is correcting it.
  if (event === "follow_up") return "captured";
  switch (event) {
    case "start": return "running";
    case "resolved_log": return "logged";
    case "resolved_calibrate": return "ready";
    case "error": return attempts >= MAX_ATTEMPTS ? "failed" : "captured";
    default: return current;
  }
}

export interface CaptureRow {
  id: number; date: string; meal_slot: string | null; mode: CaptureMode;
  status: CaptureStatus; messages: CaptureMessage[];
  proposal: unknown | null; resolved: unknown | null;
  meal_log_id: number | null; error: string | null; attempts: number;
}

export async function createCapture(
  sql: QueryFn,
  o: { date: string; slot: string | null; mode: CaptureMode; text: string; image: string | null },
): Promise<number> {
  const msg: CaptureMessage = { role: "user", text: o.text, image: o.image, at: new Date().toISOString() };
  const rows = (await sql`
    INSERT INTO meal_capture (date, meal_slot, mode, status, messages)
    VALUES (${o.date}, ${o.slot}, ${o.mode}, 'captured', ${JSON.stringify([msg])}::jsonb)
    RETURNING id`) as Array<{ id: number }>;
  return Number(rows[0].id);
}

export async function getCapture(sql: QueryFn, id: number): Promise<CaptureRow | null> {
  const rows = (await sql`
    SELECT id, date::text AS date, meal_slot, mode, status, messages, proposal, resolved,
           meal_log_id, error, attempts
    FROM meal_capture WHERE id = ${id}`) as Array<Record<string, unknown>>;
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: Number(r.id), date: String(r.date), meal_slot: (r.meal_slot as string) ?? null,
    mode: r.mode as CaptureMode, status: r.status as CaptureStatus,
    messages: (typeof r.messages === "string" ? JSON.parse(r.messages) : r.messages ?? []) as CaptureMessage[],
    proposal: r.proposal ?? null, resolved: r.resolved ?? null,
    meal_log_id: r.meal_log_id == null ? null : Number(r.meal_log_id),
    error: (r.error as string) ?? null, attempts: Number(r.attempts),
  };
}

/** Take the next waiting capture. SKIP LOCKED so two drains never fight over the same row. */
export async function claimNextCapture(sql: QueryFn): Promise<CaptureRow | null> {
  const rows = (await sql`
    UPDATE meal_capture SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM meal_capture WHERE status = 'captured'
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id`) as Array<{ id: number }>;
  return rows.length ? getCapture(sql, Number(rows[0].id)) : null;
}

export async function finishCapture(
  sql: QueryFn,
  o: { id: number; status: CaptureStatus; proposal?: unknown; resolved?: unknown;
       mealLogId?: number | null; error?: string | null; message?: CaptureMessage },
): Promise<void> {
  const proposalJson = o.proposal == null ? null : JSON.stringify(o.proposal);
  const resolvedJson = o.resolved == null ? null : JSON.stringify(o.resolved);
  const messageJson = o.message == null ? null : JSON.stringify([o.message]);
  await sql`
    UPDATE meal_capture SET
      status      = ${o.status},
      proposal    = COALESCE(${proposalJson}::jsonb, proposal),
      resolved    = COALESCE(${resolvedJson}::jsonb, resolved),
      meal_log_id = COALESCE(${o.mealLogId ?? null}, meal_log_id),
      error       = ${o.error ?? null},
      messages    = COALESCE(messages || ${messageJson}::jsonb, messages),
      updated_at  = now()
    WHERE id = ${o.id}`;
}
