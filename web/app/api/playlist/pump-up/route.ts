import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const sql = getDb();
  return NextResponse.json(
    await sql`
      SELECT p.track_id, p.name, p.artist_name, p.tempo, p.energy, p.added_at,
             COALESCE(f.duration_ms, 0) AS duration_ms
      FROM pump_up_songs p
      LEFT JOIN spotify_track_features f ON f.track_id = p.track_id
      ORDER BY p.added_at DESC
    `
  );
}

export async function POST(req: NextRequest) {
  const { track_id, name, artist_name, tempo, energy } = await req.json();
  if (!track_id || typeof track_id !== "string") {
    return NextResponse.json({ error: "track_id required" }, { status: 400 });
  }
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const sql = getDb();
  const [countRow] = await sql`SELECT COUNT(*) AS n FROM pump_up_songs`;
  if (parseInt((countRow as { n: string }).n) >= 10) {
    return NextResponse.json({ error: "Max 10 pump-up songs" }, { status: 400 });
  }
  await sql`
    INSERT INTO pump_up_songs (track_id, name, artist_name, tempo, energy)
    VALUES (${track_id}, ${name}, ${artist_name}, ${tempo ?? null}, ${energy ?? null})
    ON CONFLICT (track_id) DO NOTHING
  `;
  return NextResponse.json({ ok: true });
}
