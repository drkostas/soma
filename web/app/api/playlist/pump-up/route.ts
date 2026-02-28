import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const sql = getDb();
  return NextResponse.json(
    await sql`SELECT * FROM pump_up_songs ORDER BY added_at DESC`
  );
}

export async function POST(req: NextRequest) {
  const { track_id, name, artist_name, tempo, energy } = await req.json();
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
