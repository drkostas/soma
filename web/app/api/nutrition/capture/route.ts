/**
 * Take the owner's sentence and get out of the way.
 *
 * ⛔ THIS ROUTE MUST NEVER CALL A MODEL. It is the only step holding something that cannot be
 * recomputed, so it does one insert and returns. The work happens in the worker, started without
 * being awaited: a described plate takes the agent 28 to 50 seconds, and nobody waits for that
 * standing in a kitchen. That wait is what the old flow charged and what stopped the logging.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { todayAthlete } from "@/lib/athlete-tz";
import { createCapture, getCapture, slotForHour, type CaptureMode } from "@/lib/meal-capture";
import { drainCaptures } from "@/lib/meal-worker";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const sql = getDb();
  const body = (await req.json()) as {
    text?: string; image?: string | null; audio?: string | null; heard?: string | null;
    mode?: string; date?: string; slot?: string;
  };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text && !body.image && !body.audio) {
    return NextResponse.json({ error: "text, image or audio is required" }, { status: 400 });
  }

  const date = body.date || todayAthlete();
  const slot = body.slot || slotForHour(new Date().getHours());
  const mode: CaptureMode = body.mode === "calibrate" ? "calibrate" : "log";

  const id = await createCapture(sql, {
    date, slot, mode, text, image: body.image ?? null,
    audio: body.audio ?? null, heard: body.heard ?? null,
  });

  // Deliberately not awaited. The owner is already gone.
  void drainCaptures(sql).catch(() => { /* the sweep retries */ });

  return NextResponse.json({ id, status: "captured" });
}

export async function GET(req: NextRequest) {
  const sql = getDb();
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const cap = await getCapture(sql, id);
  if (!cap) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(cap);
}

/** A follow-up: append to the thread and run it again with the whole conversation. */
export async function PATCH(req: NextRequest) {
  const sql = getDb();
  const body = (await req.json()) as {
    id?: number; text?: string; image?: string | null; audio?: string | null; heard?: string | null;
  };
  const id = Number(body.id);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!id || (!text && !body.image && !body.audio)) {
    return NextResponse.json({ error: "id and text (or image or audio) are required" }, { status: 400 });
  }
  const cap = await getCapture(sql, id);
  if (!cap) return NextResponse.json({ error: "not found" }, { status: 404 });

  const msg = JSON.stringify([{
    role: "user", text, image: body.image ?? null, at: new Date().toISOString(),
    audio: body.audio ?? null, heard: body.heard ?? null,
  }]);
  await sql`
    UPDATE meal_capture
    SET messages = messages || ${msg}::jsonb,
        status = 'captured', attempts = 0, error = NULL, updated_at = now()
    WHERE id = ${id}`;

  void drainCaptures(sql).catch(() => { /* the sweep retries */ });
  return NextResponse.json({ id, status: "captured" });
}
