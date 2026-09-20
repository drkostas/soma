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

interface Row {
  id: number; date: string; meal_slot: string | null; mode: CaptureMode; status: CaptureStatus;
  messages: CaptureMessage[] | null; proposal: { items?: unknown[]; question?: string } | null;
  meal_log_id: number | null; error: string | null; attempts: number;
  created_at: string | Date; updated_at: string | Date;
}

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export async function GET(req: NextRequest) {
  const sql = getDb();
  const date = req.nextUrl.searchParams.get("date");
  // The day is the unit the nutrition screen works in, so the strip follows the day it is showing.
  const rows = (date
    ? await sql`SELECT * FROM meal_capture WHERE date = ${date}::date ORDER BY id DESC LIMIT 20`
    : await sql`SELECT * FROM meal_capture WHERE date = CURRENT_DATE ORDER BY id DESC LIMIT 20`) as Row[];

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
