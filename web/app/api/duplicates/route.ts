import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET() {
  const sql = getDb();

  try {
    const rows = await sql`
      WITH activities AS (
        SELECT
          activity_id,
          raw_json->>'activityName' as name,
          raw_json->'activityType'->>'typeKey' as type_key,
          (raw_json->>'startTimeGMT')::timestamp as start_time,
          (raw_json->>'startTimeGMT')::timestamp
            + (GREATEST((raw_json->>'duration')::float, 60) || ' seconds')::interval as end_time,
          round((raw_json->>'duration')::numeric) as duration_sec,
          round((raw_json->>'distance')::numeric) as distance_m,
          round((raw_json->>'calories')::numeric)::int as calories,
          (raw_json->>'averageHR')::float as avg_hr,
          (raw_json->>'maxHR')::float as max_hr,
          raw_json->>'startTimeGMT' as start_time_raw
        FROM garmin_activity_raw
        WHERE endpoint_name = 'summary'
      )
      SELECT
        a1.activity_id as id_a, a2.activity_id as id_b,
        a1.name as name_a, a2.name as name_b,
        a1.type_key as type_a, a2.type_key as type_b,
        a1.start_time_raw as start_a, a2.start_time_raw as start_b,
        a1.duration_sec as dur_a, a2.duration_sec as dur_b,
        a1.distance_m as dist_a, a2.distance_m as dist_b,
        a1.calories as cal_a, a2.calories as cal_b,
        a1.avg_hr as hr_a, a2.avg_hr as hr_b,
        a1.max_hr as max_hr_a, a2.max_hr as max_hr_b
      FROM activities a1
      JOIN activities a2 ON a1.activity_id < a2.activity_id
      WHERE a1.start_time < a2.end_time AND a2.start_time < a1.end_time
      ORDER BY a1.start_time DESC
    `;

    // Count detail endpoints per activity to determine which has richer data
    const allIds = new Set<number>();
    rows.forEach((r: any) => {
      allIds.add(Number(r.id_a));
      allIds.add(Number(r.id_b));
    });

    let detailCounts: Record<number, number> = {};
    if (allIds.size > 0) {
      const idArray = Array.from(allIds);
      const counts = await sql`
        SELECT activity_id, COUNT(*) as cnt
        FROM garmin_activity_raw
        WHERE activity_id = ANY(${idArray})
          AND endpoint_name != 'summary'
        GROUP BY activity_id
      `;
      counts.forEach((c: any) => {
        detailCounts[Number(c.activity_id)] = Number(c.cnt);
      });
    }

    const pairs = rows.map((r: any) => ({
      a: {
        id: Number(r.id_a),
        name: r.name_a,
        type: r.type_a,
        startTime: r.start_a,
        duration: Number(r.dur_a),
        distance: Number(r.dist_a),
        calories: Number(r.cal_a),
        avgHr: r.hr_a ? Number(r.hr_a) : null,
        maxHr: r.max_hr_a ? Number(r.max_hr_a) : null,
        detailEndpoints: detailCounts[Number(r.id_a)] || 0,
      },
      b: {
        id: Number(r.id_b),
        name: r.name_b,
        type: r.type_b,
        startTime: r.start_b,
        duration: Number(r.dur_b),
        distance: Number(r.dist_b),
        calories: Number(r.cal_b),
        avgHr: r.hr_b ? Number(r.hr_b) : null,
        maxHr: r.max_hr_b ? Number(r.max_hr_b) : null,
        detailEndpoints: detailCounts[Number(r.id_b)] || 0,
      },
    }));

    return NextResponse.json({ pairs, count: pairs.length });
  } catch (error) {
    console.error("Duplicates detection error:", error);
    return NextResponse.json(
      { pairs: [], count: 0, error: "Detection failed" },
      { status: 500 }
    );
  }
}
