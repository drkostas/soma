import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const sql = getDb();
  const rows = await sql`SELECT * FROM playlist_preferences ORDER BY segment_type`;
  return NextResponse.json(rows);
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const sql = getDb();
  await sql`
    INSERT INTO playlist_preferences
      (segment_type, sync_mode, bpm_min, bpm_max, bpm_tolerance, valence_min, valence_max)
    VALUES (
      ${body.segment_type},
      ${body.sync_mode ?? "auto"},
      ${body.bpm_min ?? null},
      ${body.bpm_max ?? null},
      ${body.bpm_tolerance ?? 8},
      ${body.valence_min ?? null},
      ${body.valence_max ?? null}
    )
    ON CONFLICT (segment_type) DO UPDATE SET
      sync_mode = EXCLUDED.sync_mode,
      bpm_min = EXCLUDED.bpm_min,
      bpm_max = EXCLUDED.bpm_max,
      bpm_tolerance = EXCLUDED.bpm_tolerance,
      valence_min = EXCLUDED.valence_min,
      valence_max = EXCLUDED.valence_max,
      updated_at = NOW()
  `;
  return NextResponse.json({ ok: true });
}
