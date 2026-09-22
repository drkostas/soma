/**
 * Where today's sentences have got to.
 *
 * Only what a status strip renders. The proposal and the resolved grams are deliberately left
 * out: the strip is there to say whether something is being read, not to re-litigate the meal.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { questionOf, saidOf, summaryOf, type CaptureCard } from "@/lib/capture-status";
import type { CaptureMessage, CaptureMode, CaptureStatus } from "@/lib/meal-capture";
import { dateInAthleteTz, readTz } from "@/lib/athlete-tz";

interface Row {
  id: number; date: string; meal_slot: string | null; mode: CaptureMode; status: CaptureStatus;
  messages: CaptureMessage[] | null; proposal: { items?: unknown[]; question?: string } | null;
  meal_log_id: number | null; error: string | null; attempts: number;
  created_at: string | Date; updated_at: string | Date;
}

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export async function GET(req: NextRequest) {
  const sql = getDb();
  // The day is the unit the nutrition screen works in, so the strip follows the day it is showing.
  //
  // ⛔ NOT `CURRENT_DATE`. Postgres evaluates that in the SESSION's zone, which here is New York,
  // so between midnight and seven in the morning his time the strip listed the previous day's
  // captures and his own sentence from ten minutes earlier was missing from it. The day is computed
  // from the device's zone, or the fallback, and never by the database.
  const asked = req.nextUrl.searchParams.get("date");
  const tz = readTz(req.nextUrl.searchParams.get("tz"));
  const date = asked || dateInAthleteTz(new Date(), tz);
  const rows = (await sql`
    SELECT * FROM meal_capture WHERE date = ${date}::date ORDER BY id DESC LIMIT 20`) as Row[];

  const cards: CaptureCard[] = rows.map((r) => {
    const question = questionOf(r.proposal);
    return {
      id: Number(r.id),
      slot: r.meal_slot,
      mode: r.mode,
      status: r.status,
      said: saidOf(r.messages),
      // A question is never also the summary, or the strip would say the same sentence twice.
      summary: question ? null : summaryOf(r.messages),
      question,
      mealLogId: r.meal_log_id === null ? null : Number(r.meal_log_id),
      error: r.error,
      attempts: Number(r.attempts ?? 0),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    };
  });
  return NextResponse.json({ captures: cards });
}
