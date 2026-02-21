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

  const raw = rows[0].raw_json;
  // Normalise exercises: handle null, missing, or nested structures
  const workout = {
    ...raw,
    exercises: Array.isArray(raw.exercises)
      ? raw.exercises.map((ex: any) => ({
          ...ex,
          sets: Array.isArray(ex.sets) ? ex.sets : [],
        }))
      : [],
  };

  // Try to find matching Garmin strength training activity
  const garminRows = await sql`
    SELECT
      ga.activity_id,
      (ga.raw_json->>'averageHR')::float as avg_hr,
      (ga.raw_json->>'maxHR')::float as max_hr,
      (ga.raw_json->>'calories')::float as calories,
      ga.raw_json->>'startTimeGMT' as start_gmt
    FROM garmin_activity_raw ga
    WHERE ga.endpoint_name = 'summary'
      AND ga.raw_json->'activityType'->>'typeKey' = 'strength_training'
      AND ABS(EXTRACT(EPOCH FROM (${workout.start_time}::timestamp - (ga.raw_json->>'startTimeGMT')::timestamp))) <= 900
    ORDER BY ABS(EXTRACT(EPOCH FROM (${workout.start_time}::timestamp - (ga.raw_json->>'startTimeGMT')::timestamp)))
    LIMIT 1
  `;

  let garmin: Record<string, any> | null = null;
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

    // Fetch HR time-series from activity details
    const detailsRows = await sql`
      SELECT raw_json
      FROM garmin_activity_raw
      WHERE activity_id = ${match.activity_id}
        AND endpoint_name = 'details'
      LIMIT 1
    `;

    if (detailsRows.length > 0) {
      const details = detailsRows[0].raw_json;
      const descriptors: any[] = details.metricDescriptors || [];
      const hrIdx = descriptors.find((d: any) => d.key === "directHeartRate")?.metricsIndex;
      const tsIdx = descriptors.find((d: any) => d.key === "directTimestamp")?.metricsIndex;

      if (hrIdx !== undefined && tsIdx !== undefined) {
        const metrics: any[] = details.activityDetailMetrics || [];
        if (metrics.length > 0) {
          const startTs = metrics[0].metrics[tsIdx];
          garmin.hr_timeline = metrics
            .filter((m: any) => m.metrics[hrIdx] > 0)
            .map((m: any) => ({
              elapsed_sec: Math.round((m.metrics[tsIdx] - startTs) / 1000),
              hr: m.metrics[hrIdx],
            }));
        }
      }
    }

    // Fetch exercise sets
    const setsRows = await sql`
      SELECT raw_json
      FROM garmin_activity_raw
      WHERE activity_id = ${match.activity_id}
        AND endpoint_name = 'exercise_sets'
      LIMIT 1
    `;

    if (setsRows.length > 0) {
      const setsData = setsRows[0].raw_json;
      const exerciseSets = setsData?.exerciseSets;
      if (Array.isArray(exerciseSets) && exerciseSets.length > 0) {
        const activityStartMs = new Date(match.start_gmt).getTime();
        garmin.exercise_sets = exerciseSets.map((s: any) => ({
          exercise: s.exercises?.[0]?.category || null,
          start_sec: Math.round((new Date(s.startTime).getTime() - activityStartMs) / 1000),
          duration_sec: Math.round(s.duration),
          reps: s.repetitionCount,
          weight: s.weight,
          set_type: s.setType,
        }));
      }
    }
  }

  return NextResponse.json({ ...workout, garmin });
}
