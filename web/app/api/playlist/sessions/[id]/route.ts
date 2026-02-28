import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sql = getDb();
  const rows = await sql`SELECT * FROM playlist_sessions WHERE id = ${id}`;
  return rows[0] ? NextResponse.json(rows[0]) : NextResponse.json(null, { status: 404 });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sql = getDb();
  await sql`DELETE FROM playlist_sessions WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const sql = getDb();
  const [row] = await sql`
    UPDATE playlist_sessions SET
      song_assignments = CASE WHEN ${body.song_assignments !== undefined} THEN ${body.song_assignments ? JSON.stringify(body.song_assignments) : "{}"}::jsonb ELSE song_assignments END,
      excluded_track_ids = CASE WHEN ${body.excluded_track_ids !== undefined} THEN ${body.excluded_track_ids ?? []} ELSE excluded_track_ids END,
      genre_selection = CASE WHEN ${body.genre_selection !== undefined} THEN ${body.genre_selection ?? []} ELSE genre_selection END,
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return NextResponse.json(row ?? null);
}
