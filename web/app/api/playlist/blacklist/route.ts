import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const sql = getDb();
  return NextResponse.json(
    await sql`SELECT * FROM user_blacklist ORDER BY blacklisted_at DESC`
  );
}

export async function POST(req: NextRequest) {
  const { track_id } = await req.json();
  const sql = getDb();

  // Increment or create exclude count
  const rows = await sql`
    INSERT INTO track_exclude_counts (track_id, exclude_count)
    VALUES (${track_id}, 1)
    ON CONFLICT (track_id) DO UPDATE SET
      exclude_count = track_exclude_counts.exclude_count + 1,
      last_excluded_at = NOW()
    RETURNING exclude_count
  `;

  const count = (rows[0] as { exclude_count: number }).exclude_count;
  return NextResponse.json({ count });
}
