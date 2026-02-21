import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sql = getDb();

  const rows = await sql`
    SELECT raw_json
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
      AND raw_json->>'id' = ${id}
    LIMIT 1
  `;

  if (!rows.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const workout = rows[0].raw_json;

  // Try to find matching Garmin strength training activity
  const garminRows = await sql`
    SELECT
      ga.activity_id,
      (ga.raw_json->>'averageHR')::float as avg_hr,
      (ga.raw_json->>'maxHR')::float as max_hr,
      (ga.raw_json->>'calories')::float as calories
    FROM garmin_activity_raw ga
    WHERE ga.endpoint_name = 'summary'
      AND ga.raw_json->'activityType'->>'typeKey' = 'strength_training'
      AND ABS(EXTRACT(EPOCH FROM (${workout.start_time}::timestamp - (ga.raw_json->>'startTimeGMT')::timestamp))) <= 900
    ORDER BY ABS(EXTRACT(EPOCH FROM (${workout.start_time}::timestamp - (ga.raw_json->>'startTimeGMT')::timestamp)))
    LIMIT 1
  `;

  let garmin = null;
  if (garminRows.length > 0) {
    const match = garminRows[0];
    // Fetch HR zones for the matched activity
    const zoneRows = await sql`
      SELECT raw_json
      FROM garmin_activity_raw
      WHERE endpoint_name = 'hr_zones'
        AND activity_id = ${match.activity_id}
      LIMIT 1
    `;

    let hrZones = null;
    if (zoneRows.length > 0) {
      const zoneData = zoneRows[0].raw_json;
      const zones = Array.isArray(zoneData) ? zoneData
        : zoneData?.hrTimeInZones ? zoneData.hrTimeInZones
        : [];
      // Sort by zone number and calculate high boundaries from next zone's low
      const sorted = [...zones].sort((a: any, b: any) => a.zoneNumber - b.zoneNumber);
      hrZones = sorted.map((z: any, i: number) => ({
        zone: z.zoneNumber,
        seconds: z.secsInZone || 0,
        low: z.zoneLowBoundary || 0,
        high: i < sorted.length - 1 ? (sorted[i + 1].zoneLowBoundary - 1) : 220,
      }));
    }

    garmin = {
      avg_hr: match.avg_hr,
      max_hr: match.max_hr,
      calories: match.calories,
      hr_zones: hrZones,
    };
  }

  return NextResponse.json({ ...workout, garmin });
}
