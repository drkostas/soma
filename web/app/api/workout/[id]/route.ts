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

  // Look up enrichment data (primary) or fall back to fuzzy timestamp match
  const enrichmentRows = await sql`
    SELECT hevy_id, garmin_activity_id, avg_hr, max_hr, calories, hr_samples, duration_s, min_hr
    FROM workout_enrichment
    WHERE hevy_id = ${id}
    LIMIT 1
  `;

  let garminActivityId: number | null = null;
  let enrichedHr: { avg_hr: number | null; max_hr: number | null; calories: number | null } | null = null;
  let enrichmentHrSamples: number[] | null = null;
  let enrichmentDuration: number | null = null;
  let enrichmentMinHr: number | null = null;

  if (enrichmentRows.length > 0) {
    const e = enrichmentRows[0];
    garminActivityId = e.garmin_activity_id;
    enrichedHr = { avg_hr: e.avg_hr, max_hr: e.max_hr, calories: e.calories };
    enrichmentMinHr = e.min_hr;
    enrichmentDuration = e.duration_s;
    if (e.hr_samples) {
      enrichmentHrSamples = Array.isArray(e.hr_samples) ? e.hr_samples : [];
    }
  } else {
    // Fallback: fuzzy timestamp match
    const garminRows = await sql`
      SELECT
        ga.activity_id,
        (ga.raw_json->>'averageHR')::float as avg_hr,
        (ga.raw_json->>'maxHR')::float as max_hr,
        (ga.raw_json->>'calories')::float as calories
      FROM garmin_activity_raw ga
      WHERE ga.endpoint_name = 'summary'
        AND ga.raw_json->'activityType'->>'typeKey' = 'strength_training'
        AND ABS(EXTRACT(EPOCH FROM (${workout.start_time}::timestamp - (ga.raw_json->>'startTimeGMT')::timestamp))) <= 21600
      ORDER BY ABS(EXTRACT(EPOCH FROM (${workout.start_time}::timestamp - (ga.raw_json->>'startTimeGMT')::timestamp)))
      LIMIT 1
    `;
    if (garminRows.length > 0) {
      const m = garminRows[0];
      garminActivityId = m.activity_id;
      enrichedHr = { avg_hr: m.avg_hr, max_hr: m.max_hr, calories: m.calories };
    }
  }

  let garmin: Record<string, any> | null = null;
  if (garminActivityId && enrichedHr) {
    // Fetch HR zones for the matched activity
    const zoneRows = await sql`
      SELECT raw_json
      FROM garmin_activity_raw
      WHERE endpoint_name = 'hr_zones'
        AND activity_id = ${garminActivityId}
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
      avg_hr: enrichedHr.avg_hr,
      max_hr: enrichedHr.max_hr,
      min_hr: enrichmentMinHr,
      calories: enrichedHr.calories,
      hr_zones: hrZones,
    };

    // Build HR timeline from enrichment hr_samples (our DB, not Garmin API)
    if (enrichmentHrSamples && enrichmentHrSamples.length > 0 && enrichmentDuration) {
      const interval = enrichmentDuration / enrichmentHrSamples.length;
      garmin.hr_timeline = enrichmentHrSamples.map((hr: number, i: number) => ({
        elapsed_sec: Math.round(i * interval),
        hr,
      }));
    }

    // Always synthesize exercise overlay from Hevy data for consistent naming & 1:1 set mapping
    if (garmin.hr_timeline?.length > 0 && workout.exercises.length > 0) {
      const totalDuration = garmin.hr_timeline[garmin.hr_timeline.length - 1].elapsed_sec;
      const allSets: Array<{ exercise: string; reps: number; weight: number; type: string }> = [];
      for (const ex of workout.exercises) {
        for (const s of ex.sets) {
          allSets.push({
            exercise: ex.title || "Unknown",
            reps: s.reps || 0,
            weight: s.weight_kg || 0,
            type: s.type === "warmup" ? "warmup" : "normal",
          });
        }
      }
      if (allSets.length > 0) {
        // Estimate ~40s per working set, ~25s rest between sets, ~60s rest between exercises
        const EST_SET_SEC = 40;
        const EST_REST_SEC = 25;
        const EST_EX_REST_SEC = 60;
        const rawTotal = allSets.length * EST_SET_SEC +
          (allSets.length - 1) * EST_REST_SEC +
          (workout.exercises.length - 1) * (EST_EX_REST_SEC - EST_REST_SEC);
        const scale = rawTotal > 0 ? totalDuration / rawTotal : 1;

        const synthSets: any[] = [];
        let cursor = 0;
        let prevExercise = "";
        for (const s of allSets) {
          // Advance cursor for rest gaps (no REST entries needed)
          if (prevExercise && s.exercise !== prevExercise) {
            cursor += EST_EX_REST_SEC * scale;
          } else if (prevExercise) {
            cursor += EST_REST_SEC * scale;
          }
          const setDur = EST_SET_SEC * scale;
          synthSets.push({
            exercise: s.exercise,
            start_sec: Math.round(cursor),
            duration_sec: Math.round(setDur),
            reps: s.reps,
            weight: s.weight,
            set_type: s.type === "warmup" ? "WARMUP" : "ACTIVE",
          });
          cursor += setDur;
          prevExercise = s.exercise;
        }
        garmin.exercise_sets = synthSets;

        // Compute per-set avg HR and embed in each Hevy exercise set
        const timeline = garmin.hr_timeline as Array<{elapsed_sec: number; hr: number}>;
        let setIdx = 0;
        for (const ex of workout.exercises) {
          for (const s of ex.sets) {
            if (setIdx < synthSets.length) {
              const synth = synthSets[setIdx];
              const hrInRange = timeline.filter(
                (p) => p.elapsed_sec >= synth.start_sec && p.elapsed_sec <= synth.start_sec + synth.duration_sec
              );
              if (hrInRange.length > 0) {
                s.avg_hr = Math.round(
                  hrInRange.reduce((sum, p) => sum + p.hr, 0) / hrInRange.length
                );
              }
            }
            setIdx++;
          }
        }
      }
    }
  } else if (enrichedHr) {
    // Enrichment data exists but no Garmin activity link — show HR/calories + timeline
    garmin = {
      avg_hr: enrichedHr.avg_hr,
      max_hr: enrichedHr.max_hr,
      min_hr: enrichmentMinHr,
      calories: enrichedHr.calories,
      hr_zones: null,
    };
    if (enrichmentHrSamples && enrichmentHrSamples.length > 0 && enrichmentDuration) {
      const interval = enrichmentDuration / enrichmentHrSamples.length;
      garmin.hr_timeline = enrichmentHrSamples.map((hr: number, i: number) => ({
        elapsed_sec: Math.round(i * interval),
        hr,
      }));

      // Synthesize exercise overlay + per-set HR (same as primary path)
      if (workout.exercises.length > 0) {
        const totalDuration = garmin.hr_timeline[garmin.hr_timeline.length - 1].elapsed_sec;
        const allSets: Array<{ exercise: string; reps: number; weight: number; type: string }> = [];
        for (const ex of workout.exercises) {
          for (const s of ex.sets) {
            allSets.push({
              exercise: ex.title || "Unknown",
              reps: s.reps || 0,
              weight: s.weight_kg || 0,
              type: s.type === "warmup" ? "warmup" : "normal",
            });
          }
        }
        if (allSets.length > 0) {
          const EST_SET_SEC = 40;
          const EST_REST_SEC = 25;
          const EST_EX_REST_SEC = 60;
          const rawTotal = allSets.length * EST_SET_SEC +
            (allSets.length - 1) * EST_REST_SEC +
            (workout.exercises.length - 1) * (EST_EX_REST_SEC - EST_REST_SEC);
          const scale = rawTotal > 0 ? totalDuration / rawTotal : 1;

          const synthSets: any[] = [];
          let cursor = 0;
          let prevExercise = "";
          for (const s of allSets) {
            if (prevExercise && s.exercise !== prevExercise) {
              cursor += EST_EX_REST_SEC * scale;
            } else if (prevExercise) {
              cursor += EST_REST_SEC * scale;
            }
            const setDur = EST_SET_SEC * scale;
            synthSets.push({
              exercise: s.exercise,
              start_sec: Math.round(cursor),
              duration_sec: Math.round(setDur),
              reps: s.reps,
              weight: s.weight,
              set_type: s.type === "warmup" ? "WARMUP" : "ACTIVE",
            });
            cursor += setDur;
            prevExercise = s.exercise;
          }
          garmin.exercise_sets = synthSets;

          const timeline = garmin.hr_timeline;
          let setIdx = 0;
          for (const ex of workout.exercises) {
            for (const s of ex.sets) {
              if (setIdx < synthSets.length) {
                const synth = synthSets[setIdx];
                const hrInRange = timeline.filter(
                  (p: any) => p.elapsed_sec >= synth.start_sec && p.elapsed_sec <= synth.start_sec + synth.duration_sec
                );
                if (hrInRange.length > 0) {
                  s.avg_hr = Math.round(
                    hrInRange.reduce((sum: number, p: any) => sum + p.hr, 0) / hrInRange.length
                  );
                }
              }
              setIdx++;
            }
          }
        }
      }
    }
  }

  return NextResponse.json({ ...workout, garmin });
}
