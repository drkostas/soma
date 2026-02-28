import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const sql = getDb();
  const rows = await sql`
    SELECT unnest(genres) AS genre, COUNT(*) AS count
    FROM spotify_track_features
    GROUP BY genre
    ORDER BY count DESC
  `;
  const total = (rows as Array<{ count: string }>).reduce(
    (s, r) => s + parseInt(r.count),
    0
  );
  return NextResponse.json({ genres: rows, total });
}
