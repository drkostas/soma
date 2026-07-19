import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";
export const revalidate = 300;

/* All-time running summary for the universal (React Native) app. Mirrors the data
   the web /running server component renders (stats, training status, HR zone
   distribution, personal records, shoe mileage, recent runs), returned as one JSON
   payload the RN screen consumes over fetch. All-time — the RN screen has no range
   selector — so the cutoff is an early epoch date. */

const ALL_TIME = "2000-01-01";

export async function GET() {
  const sql = getDb();

  try {
    const [statsRows, trainingRows, hrRows, recentRows, shoeRows, paceRows, vo2Rows, mileageRows, ...records] =
      await Promise.all([
      // Aggregate stats
      sql`
        SELECT
          COUNT(*) as total_runs,
          SUM((raw_json->>'distance')::float) / 1000.0 as total_km,
          AVG((raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0)) / 60.0 as avg_pace,
          AVG((raw_json->>'averageHR')::float) as avg_hr,
          MAX((raw_json->>'vO2MaxValue')::float) as peak_vo2max,
          MAX((raw_json->>'distance')::float) / 1000.0 as longest_run
        FROM garmin_activity_raw
        WHERE endpoint_name = 'summary'
          AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      `,
      // Training status (nested under a dynamic device-id key)
      sql`
        WITH status_data AS (
          SELECT
            date::text as date,
            raw_json->'mostRecentTrainingStatus'->'latestTrainingStatusData' as status_map,
            raw_json->'mostRecentVO2Max'->'generic' as vo2max_data
          FROM garmin_raw_data
          WHERE endpoint_name = 'training_status'
            AND raw_json->'mostRecentTrainingStatus' IS NOT NULL
          ORDER BY date DESC
          LIMIT 1
        )
        SELECT
          (SELECT v->>'trainingStatus' FROM jsonb_each(sd.status_map) AS t(k, v) LIMIT 1) as status_code,
          (SELECT v->>'sport' FROM jsonb_each(sd.status_map) AS t(k, v) LIMIT 1) as sport,
          (SELECT v->>'trainingStatusFeedbackPhrase' FROM jsonb_each(sd.status_map) AS t(k, v) LIMIT 1) as feedback,
          (SELECT v->'acuteTrainingLoadDTO'->>'dailyTrainingLoadAcute' FROM jsonb_each(sd.status_map) AS t(k, v) LIMIT 1) as acute_load,
          (SELECT v->'acuteTrainingLoadDTO'->>'dailyTrainingLoadChronic' FROM jsonb_each(sd.status_map) AS t(k, v) LIMIT 1) as chronic_load,
          (SELECT v->'acuteTrainingLoadDTO'->>'dailyAcuteChronicWorkloadRatio' FROM jsonb_each(sd.status_map) AS t(k, v) LIMIT 1) as acwr,
          (SELECT v->'acuteTrainingLoadDTO'->>'acwrStatus' FROM jsonb_each(sd.status_map) AS t(k, v) LIMIT 1) as acwr_status,
          sd.vo2max_data->>'vo2MaxPreciseValue' as vo2max
        FROM status_data sd
      `,
      // HR zone distribution
      sql`
        SELECT
          CASE
            WHEN (raw_json->>'averageHR')::float < 120 THEN 'Zone 1 (Recovery)'
            WHEN (raw_json->>'averageHR')::float < 140 THEN 'Zone 2 (Easy)'
            WHEN (raw_json->>'averageHR')::float < 155 THEN 'Zone 3 (Aerobic)'
            WHEN (raw_json->>'averageHR')::float < 170 THEN 'Zone 4 (Threshold)'
            ELSE 'Zone 5 (Max)'
          END as zone,
          COUNT(*) as count,
          ROUND(AVG((raw_json->>'duration')::float / 60)::numeric) as avg_duration,
          ROUND(AVG((raw_json->>'distance')::float / 1000)::numeric, 1) as avg_km,
          CASE
            WHEN (raw_json->>'averageHR')::float < 120 THEN 1
            WHEN (raw_json->>'averageHR')::float < 140 THEN 2
            WHEN (raw_json->>'averageHR')::float < 155 THEN 3
            WHEN (raw_json->>'averageHR')::float < 170 THEN 4
            ELSE 5
          END as sort_order
        FROM garmin_activity_raw
        WHERE endpoint_name = 'summary'
          AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
          AND raw_json->>'averageHR' IS NOT NULL
          AND (raw_json->>'distance')::float > 1000
        GROUP BY zone, sort_order
        ORDER BY sort_order ASC
      `,
      // Recent runs (with weather join)
      sql`
        SELECT
          s.activity_id::text as activity_id,
          (s.raw_json->>'startTimeLocal')::text as date,
          (s.raw_json->>'activityName')::text as name,
          (s.raw_json->>'distance')::float / 1000.0 as distance,
          (s.raw_json->>'duration')::float / 60.0 as duration_min,
          (s.raw_json->>'duration')::float / NULLIF((s.raw_json->>'distance')::float / 1000.0, 0) / 60.0 as pace,
          (s.raw_json->>'averageHR')::float as avg_hr,
          (s.raw_json->>'calories')::float as calories,
          (s.raw_json->>'elevationGain')::float as elev_gain
        FROM garmin_activity_raw s
        WHERE s.endpoint_name = 'summary'
          AND s.raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        ORDER BY (s.raw_json->>'startTimeLocal')::text DESC
        LIMIT 20
      `,
      // Shoe mileage
      sql`
        WITH running_gear AS (
          SELECT
            s.activity_id,
            (s.raw_json->>'distance')::float / 1000.0 as distance_km,
            g.raw_json->0->>'gearPk' as gear_pk,
            g.raw_json->0->>'displayName' as display_name,
            g.raw_json->0->>'customMakeModel' as custom_name,
            g.raw_json->0->>'gearStatusName' as status,
            (g.raw_json->0->>'maximumMeters')::float / 1000.0 as max_km
          FROM garmin_activity_raw s
          JOIN garmin_activity_raw g ON g.activity_id = s.activity_id AND g.endpoint_name = 'gear'
          WHERE s.endpoint_name = 'summary'
            AND s.raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
            AND g.raw_json->0->>'gearTypeName' = 'Shoes'
        )
        SELECT
          gear_pk,
          COALESCE(custom_name, display_name) as shoe_name,
          status,
          max_km,
          COUNT(*) as runs,
          SUM(distance_km) as total_km
        FROM running_gear
        WHERE gear_pk IS NOT NULL
        GROUP BY gear_pk, shoe_name, status, max_km
        ORDER BY total_km DESC
      `,
      // Trend series for tier-1 sparklines (recent → chronological), value-only.
      sql`
        SELECT (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0 as v
        FROM garmin_activity_raw
        WHERE endpoint_name = 'summary'
          AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
          AND (raw_json->>'distance')::float > 1000
        ORDER BY (raw_json->>'startTimeLocal')::text DESC LIMIT 40
      `,
      sql`
        SELECT v FROM (
          SELECT DISTINCT ON (LEFT((raw_json->>'startTimeLocal')::text, 10))
            LEFT((raw_json->>'startTimeLocal')::text, 10) as d,
            (raw_json->>'vO2MaxValue')::float as v
          FROM garmin_activity_raw
          WHERE endpoint_name = 'summary'
            AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
            AND raw_json->>'vO2MaxValue' IS NOT NULL
          ORDER BY LEFT((raw_json->>'startTimeLocal')::text, 10) DESC
          LIMIT 40
        ) t ORDER BY d ASC
      `,
      sql`
        SELECT v FROM (
          SELECT TO_CHAR((raw_json->>'startTimeLocal')::timestamp, 'YYYY-MM') as m,
            SUM((raw_json->>'distance')::float) / 1000.0 as v
          FROM garmin_activity_raw
          WHERE endpoint_name = 'summary'
            AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
          GROUP BY m ORDER BY m DESC LIMIT 12
        ) t ORDER BY m ASC
      `,
      // Personal records — six independent one-row queries
      sql`
        SELECT (raw_json->>'startTimeLocal')::text as date, (raw_json->>'activityName')::text as name,
          (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0 as pace,
          (raw_json->>'distance')::float / 1000.0 as distance,
          ((raw_json->>'duration')::float / (raw_json->>'distance')::float) * 5000.0 as est_5k_seconds
        FROM garmin_activity_raw
        WHERE endpoint_name = 'summary' AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
          AND (raw_json->>'distance')::float >= 4800
        ORDER BY (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float, 0) ASC LIMIT 1
      `,
      sql`
        SELECT (raw_json->>'startTimeLocal')::text as date, (raw_json->>'activityName')::text as name,
          (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0 as pace,
          (raw_json->>'distance')::float / 1000.0 as distance,
          ((raw_json->>'duration')::float / (raw_json->>'distance')::float) * 10000.0 as est_10k_seconds
        FROM garmin_activity_raw
        WHERE endpoint_name = 'summary' AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
          AND (raw_json->>'distance')::float >= 9500
        ORDER BY (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float, 0) ASC LIMIT 1
      `,
      sql`
        SELECT (raw_json->>'startTimeLocal')::text as date, (raw_json->>'activityName')::text as name,
          (raw_json->>'distance')::float / 1000.0 as distance, (raw_json->>'duration')::float / 60.0 as duration_min
        FROM garmin_activity_raw
        WHERE endpoint_name = 'summary' AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        ORDER BY (raw_json->>'distance')::float DESC LIMIT 1
      `,
      sql`
        SELECT (raw_json->>'startTimeLocal')::text as date, (raw_json->>'activityName')::text as name,
          (raw_json->>'averageHR')::float as avg_hr, (raw_json->>'maxHR')::float as max_hr
        FROM garmin_activity_raw
        WHERE endpoint_name = 'summary' AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
          AND raw_json->>'maxHR' IS NOT NULL
        ORDER BY (raw_json->>'maxHR')::float DESC LIMIT 1
      `,
      sql`
        SELECT (raw_json->>'startTimeLocal')::text as date, (raw_json->>'activityName')::text as name,
          (raw_json->>'calories')::float as calories, (raw_json->>'distance')::float / 1000.0 as distance
        FROM garmin_activity_raw
        WHERE endpoint_name = 'summary' AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
          AND raw_json->>'calories' IS NOT NULL
        ORDER BY (raw_json->>'calories')::float DESC LIMIT 1
      `,
      sql`
        SELECT (raw_json->>'startTimeLocal')::text as date, (raw_json->>'activityName')::text as name,
          (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0 as pace,
          (raw_json->>'distance')::float / 1000.0 as distance
        FROM garmin_activity_raw
        WHERE endpoint_name = 'summary' AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
          AND (raw_json->>'distance')::float > 3000
        ORDER BY (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float, 0) ASC LIMIT 1
      `,
    ]);

    const [fastest5k, fastest10k, longest, maxHR, maxCal, fastestPace] = records;

    return NextResponse.json({
      stats: statsRows[0] || null,
      trainingStatus: trainingRows[0] || null,
      hrDistribution: hrRows,
      records: {
        fastest5k: fastest5k[0] || null,
        fastest10k: fastest10k[0] || null,
        longest: longest[0] || null,
        maxHR: maxHR[0] || null,
        maxCal: maxCal[0] || null,
        fastestPace: fastestPace[0] || null,
      },
      shoeMileage: shoeRows,
      recentRuns: recentRows,
      trends: {
        // pace query is recent-first; reverse to chronological for the sparkline
        pace: paceRows.map((r) => Number(r.v)).reverse(),
        vo2max: vo2Rows.map((r) => Number(r.v)),
        mileage: mileageRows.map((r) => Number(r.v)),
      },
    });
  } catch (err) {
    console.error("running/stats error:", err);
    return NextResponse.json({ error: "Failed to load running stats" }, { status: 500 });
  }
}
