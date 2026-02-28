import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { track_id, name, artist_name } = await req.json();
  if (!track_id || typeof track_id !== "string") {
    return NextResponse.json({ error: "track_id required" }, { status: 400 });
  }
  const sql = getDb();

  await sql`
    INSERT INTO user_blacklist (track_id, name, artist_name)
    VALUES (${track_id}, ${name ?? null}, ${artist_name ?? null})
    ON CONFLICT (track_id) DO NOTHING
  `;

  return NextResponse.json({ ok: true });
}
