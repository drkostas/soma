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
    // Single activity: get splits for segment parsing
    const rows = await sql`
      SELECT
        activity_id::text,
        raw_json AS data
      FROM garmin_activity_raw
      WHERE activity_id = ${id}::bigint AND endpoint_name = 'splits'
      LIMIT 1
    `;
    if (!rows[0]) return NextResponse.json(null, { status: 404 });

    // Also fetch the name + start_time from summary
    const meta = await sql`
      SELECT
        raw_json->>'activityName' AS activity_name,
        raw_json->>'startTimeGMT' AS start_time
      FROM garmin_activity_raw
      WHERE activity_id = ${id}::bigint AND endpoint_name = 'summary'
      LIMIT 1
    `;

    const row = rows[0] as { activity_id: string; data: Record<string, unknown> };
    const lapDTOs = (row.data?.lapDTOs ?? []) as unknown[];
    const hasSplits = !!((row.data?.activityDetail as Record<string, unknown>)?.hasSplits);
    const isTreadmill =
      lapDTOs.length > 0 &&
      (lapDTOs[0] as Record<string, unknown>).startLatitude == null;

    const segments = hasSplits
      ? parseStructuredLaps(lapDTOs)
      : parseUnstructuredLaps(lapDTOs);

    return NextResponse.json({
      activity_id: row.activity_id,
      activity_name: meta[0]?.activity_name ?? null,
      start_time: meta[0]?.start_time ?? null,
      segments,
      hasSplits,
      isTreadmill,
    });
  }

  // List running activities from summary endpoint (has metadata)
  const rows = await sql`
    SELECT
      activity_id::text,
      raw_json->>'activityName'          AS activity_name,
      raw_json->>'startTimeGMT'          AS start_time,
      (raw_json->>'distance')::float     AS distance,
      (raw_json->>'duration')::float     AS duration,
      raw_json->'activityType'->>'typeKey' AS sport_type
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' ILIKE '%running%'
      AND (${q} = '' OR raw_json->>'activityName' ILIKE ${"%" + q + "%"})
    ORDER BY raw_json->>'startTimeGMT' DESC
    LIMIT ${limit}
  `;

  return NextResponse.json(rows);
}
