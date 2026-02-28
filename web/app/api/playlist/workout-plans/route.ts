import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const sql = getDb();
  return NextResponse.json(
    await sql`SELECT * FROM workout_plans ORDER BY created_at DESC`
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const segments = body.segments ?? [];
  const totalDuration = (segments as Array<{ duration_s?: number }>).reduce(
    (s, seg) => s + (seg.duration_s ?? 0),
    0
  );
  const sql = getDb();
  const [row] = await sql`
    INSERT INTO workout_plans
      (name, description, sport_type, segments, total_duration_s, source, garmin_activity_id)
    VALUES (
      ${body.name},
      ${body.description ?? null},
      ${body.sport_type ?? "running"},
      ${JSON.stringify(segments)}::jsonb,
      ${totalDuration},
      ${body.source ?? "manual"},
      ${body.garmin_activity_id ?? null}
    )
    RETURNING *
  `;
  return NextResponse.json(row);
}
