import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseStructuredLaps, parseUnstructuredLaps } from "@/lib/garmin-lap-parser";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id");
  const limit = Math.min(parseInt(sp.get("limit") ?? "50"), 200);
  const q = sp.get("q") ?? "";

  const sql = getDb();

  if (id) {
    // Single activity with parsed segments
    const rows = await sql`
      SELECT activity_id, activity_name, start_time, distance, duration, data
      FROM garmin_activity_raw
      WHERE activity_id = ${id} AND endpoint_name = 'splits'
      LIMIT 1
    `;
    if (!rows[0]) return NextResponse.json(null, { status: 404 });

    const row = rows[0] as {
      activity_id: string;
      activity_name: string;
      start_time: string;
      data: Record<string, unknown>;
    };
    const lapDTOs = (row.data?.lapDTOs ?? []) as unknown[];
    const hasSplits = !!((row.data?.activityDetail as Record<string, unknown>)?.hasSplits);
    const isTreadmill =
      lapDTOs.length > 0 &&
      (lapDTOs[0] as Record<string, unknown>).startLatitude == null;

    const segments = hasSplits
      ? parseStructuredLaps(lapDTOs)
      : parseUnstructuredLaps(lapDTOs);

    return NextResponse.json({ ...row, segments, hasSplits, isTreadmill });
  }

  // List running activities (most recent first)
  const rows = await sql`
    SELECT DISTINCT ON (activity_id)
      activity_id, activity_name, start_time, distance, duration, sport_type
    FROM garmin_activity_raw
    WHERE endpoint_name = 'splits'
      AND sport_type ILIKE '%running%'
      AND (${q} = '' OR activity_name ILIKE ${"%" + q + "%"})
    ORDER BY activity_id DESC, start_time DESC
    LIMIT ${limit}
  `;

  return NextResponse.json(rows);
}
