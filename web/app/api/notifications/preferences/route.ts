import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const sql = getDb();
  const rows = await sql`SELECT * FROM notification_preferences WHERE id = 1`;
  return NextResponse.json(rows[0] || {
    enabled: true,
    on_sync_workout: true,
    on_sync_run: true,
    on_sync_error: true,
    on_milestone: true,
    on_playlist_ready: false,
  });
}

export async function PUT(req: NextRequest) {
  const sql = getDb();
  const body = await req.json();
  const { enabled, on_sync_workout, on_sync_run, on_sync_error, on_milestone, on_playlist_ready } = body;

  await sql`
    UPDATE notification_preferences
    SET enabled = ${enabled ?? true},
        on_sync_workout = ${on_sync_workout ?? true},
        on_sync_run = ${on_sync_run ?? true},
        on_sync_error = ${on_sync_error ?? true},
        on_milestone = ${on_milestone ?? true},
        on_playlist_ready = ${on_playlist_ready ?? false},
        updated_at = NOW()
    WHERE id = 1
  `;

  return NextResponse.json({ ok: true });
}
