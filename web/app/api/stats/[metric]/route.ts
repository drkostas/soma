import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

const VALID_METRICS = [
  "steps",
  "calories",
  "rhr",
  "vo2max",
  "sleep",
  "stress",
  "body_battery",
  "activities",
  "recovery",
] as const;

type Metric = (typeof VALID_METRICS)[number];

const RANGE_DAYS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

interface DataPoint {
  date: string;
  value: number | null;
  value2?: number | null;
}

interface MetricResponse {
  current: DataPoint[];
  previous: DataPoint[];
  summary: {
    current_avg: number | null;
    current_min: number | null;
    current_max: number | null;
    previous_avg: number | null;
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ metric: string }> }
) {
  const { metric } = await params;

  if (!VALID_METRICS.includes(metric as Metric)) {
    return NextResponse.json(
      { error: `Invalid metric: ${metric}` },
      { status: 400 }
    );
  }

  const range = request.nextUrl.searchParams.get("range") || "30d";
  const days = RANGE_DAYS[range];
  if (!days) {
    return NextResponse.json(
      { error: `Invalid range: ${range}. Use 7d, 30d, 90d, or 1y` },
      { status: 400 }
    );
  }

  const sql = getDb();

  try {
    const data = await fetchMetricData(sql, metric as Metric, days);
    return NextResponse.json(data);
  } catch (err) {
    console.error(`Error fetching stat ${metric}:`, err);
    return NextResponse.json(
      { error: "Failed to fetch data" },
      { status: 500 }
    );
  }
}

function buildResponse(current: DataPoint[], previous: DataPoint[]): MetricResponse {
  const currentValues = current
    .map((d) => d.value)
    .filter((v): v is number => v != null && !isNaN(v));
  const previousValues = previous
    .map((d) => d.value)
    .filter((v): v is number => v != null && !isNaN(v));

  return {
    current,
    previous,
    summary: {
      current_avg:
        currentValues.length > 0
          ? Math.round((currentValues.reduce((s, v) => s + v, 0) / currentValues.length) * 100) / 100
          : null,
      current_min: currentValues.length > 0 ? Math.min(...currentValues) : null,
      current_max: currentValues.length > 0 ? Math.max(...currentValues) : null,
      previous_avg:
        previousValues.length > 0
          ? Math.round((previousValues.reduce((s, v) => s + v, 0) / previousValues.length) * 100) / 100
          : null,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlFn = ReturnType<typeof getDb>;

async function fetchMetricData(sql: SqlFn, metric: Metric, days: number): Promise<MetricResponse> {
  switch (metric) {
    case "steps":
      return fetchSteps(sql, days);
    case "calories":
      return fetchCalories(sql, days);
    case "rhr":
      return fetchRHR(sql, days);
    case "sleep":
      return fetchSleep(sql, days);
    case "stress":
      return fetchStress(sql, days);
    case "body_battery":
      return fetchBodyBattery(sql, days);
    case "vo2max":
      return fetchVo2max(sql, days);
    case "activities":
      return fetchActivities(sql, days);
    case "recovery":
      return fetchRecovery(sql, days);
  }
}

async function fetchSteps(sql: SqlFn, days: number): Promise<MetricResponse> {
  const current = await sql`
    SELECT date::text as date, total_steps as value
    FROM daily_health_summary
    WHERE date >= CURRENT_DATE - make_interval(days => ${days})
      AND total_steps > 0
    ORDER BY date ASC
  `;
  const previous = await sql`
    SELECT date::text as date, total_steps as value
    FROM daily_health_summary
    WHERE date >= CURRENT_DATE - make_interval(days => ${days * 2})
      AND date < CURRENT_DATE - make_interval(days => ${days})
      AND total_steps > 0
    ORDER BY date ASC
  `;
  return buildResponse(
    current.map((r) => ({ date: r.date, value: Number(r.value) })),
    previous.map((r) => ({ date: r.date, value: Number(r.value) }))
  );
}

async function fetchCalories(sql: SqlFn, days: number): Promise<MetricResponse> {
  const current = await sql`
    SELECT date::text as date, active_kilocalories as value, bmr_kilocalories as value2
    FROM daily_health_summary
    WHERE date >= CURRENT_DATE - make_interval(days => ${days})
      AND active_kilocalories > 0
    ORDER BY date ASC
  `;
  const previous = await sql`
    SELECT date::text as date, active_kilocalories as value, bmr_kilocalories as value2
    FROM daily_health_summary
    WHERE date >= CURRENT_DATE - make_interval(days => ${days * 2})
      AND date < CURRENT_DATE - make_interval(days => ${days})
      AND active_kilocalories > 0
    ORDER BY date ASC
  `;
  return buildResponse(
    current.map((r) => ({ date: r.date, value: Number(r.value), value2: Number(r.value2) })),
    previous.map((r) => ({ date: r.date, value: Number(r.value), value2: Number(r.value2) }))
  );
}

async function fetchRHR(sql: SqlFn, days: number): Promise<MetricResponse> {
  const current = await sql`
    SELECT date::text as date, resting_heart_rate as value
    FROM daily_health_summary
    WHERE date >= CURRENT_DATE - make_interval(days => ${days})
      AND resting_heart_rate > 0
    ORDER BY date ASC
  `;
  const previous = await sql`
    SELECT date::text as date, resting_heart_rate as value
    FROM daily_health_summary
    WHERE date >= CURRENT_DATE - make_interval(days => ${days * 2})
      AND date < CURRENT_DATE - make_interval(days => ${days})
      AND resting_heart_rate > 0
    ORDER BY date ASC
  `;
  return buildResponse(
    current.map((r) => ({ date: r.date, value: Number(r.value) })),
    previous.map((r) => ({ date: r.date, value: Number(r.value) }))
  );
}

async function fetchSleep(sql: SqlFn, days: number): Promise<MetricResponse> {
  const current = await sql`
    SELECT date::text as date, sleep_time_seconds / 3600.0 as value
    FROM daily_health_summary
    WHERE date >= CURRENT_DATE - make_interval(days => ${days})
      AND sleep_time_seconds > 0
    ORDER BY date ASC
  `;
  const previous = await sql`
    SELECT date::text as date, sleep_time_seconds / 3600.0 as value
    FROM daily_health_summary
    WHERE date >= CURRENT_DATE - make_interval(days => ${days * 2})
      AND date < CURRENT_DATE - make_interval(days => ${days})
      AND sleep_time_seconds > 0
    ORDER BY date ASC
  `;
  return buildResponse(
    current.map((r) => ({ date: r.date, value: Number(Number(r.value).toFixed(2)) })),
    previous.map((r) => ({ date: r.date, value: Number(Number(r.value).toFixed(2)) }))
  );
}

async function fetchStress(sql: SqlFn, days: number): Promise<MetricResponse> {
  const current = await sql`
    SELECT date::text as date, avg_stress_level as value, max_stress_level as value2
    FROM daily_health_summary
    WHERE date >= CURRENT_DATE - make_interval(days => ${days})
      AND avg_stress_level > 0
    ORDER BY date ASC
  `;
  const previous = await sql`
    SELECT date::text as date, avg_stress_level as value, max_stress_level as value2
    FROM daily_health_summary
    WHERE date >= CURRENT_DATE - make_interval(days => ${days * 2})
      AND date < CURRENT_DATE - make_interval(days => ${days})
      AND avg_stress_level > 0
    ORDER BY date ASC
  `;
  return buildResponse(
    current.map((r) => ({ date: r.date, value: Number(r.value), value2: Number(r.value2) })),
    previous.map((r) => ({ date: r.date, value: Number(r.value), value2: Number(r.value2) }))
  );
}

async function fetchBodyBattery(sql: SqlFn, days: number): Promise<MetricResponse> {
  const current = await sql`
    SELECT date::text as date, body_battery_charged as value, body_battery_drained as value2
    FROM daily_health_summary
    WHERE date >= CURRENT_DATE - make_interval(days => ${days})
      AND body_battery_charged > 0
    ORDER BY date ASC
  `;
  const previous = await sql`
    SELECT date::text as date, body_battery_charged as value, body_battery_drained as value2
    FROM daily_health_summary
    WHERE date >= CURRENT_DATE - make_interval(days => ${days * 2})
      AND date < CURRENT_DATE - make_interval(days => ${days})
      AND body_battery_charged > 0
    ORDER BY date ASC
  `;
  return buildResponse(
    current.map((r) => ({ date: r.date, value: Number(r.value), value2: Number(r.value2) })),
    previous.map((r) => ({ date: r.date, value: Number(r.value), value2: Number(r.value2) }))
  );
}

async function fetchVo2max(sql: SqlFn, days: number): Promise<MetricResponse> {
  const current = await sql`
    SELECT
      LEFT((raw_json->>'startTimeLocal')::text, 10) as date,
      (raw_json->>'vO2MaxValue')::float as value
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND raw_json->>'vO2MaxValue' IS NOT NULL
      AND (raw_json->>'startTimeLocal')::date >= CURRENT_DATE - make_interval(days => ${days})
    ORDER BY date ASC
  `;
  const previous = await sql`
    SELECT
      LEFT((raw_json->>'startTimeLocal')::text, 10) as date,
      (raw_json->>'vO2MaxValue')::float as value
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND raw_json->>'vO2MaxValue' IS NOT NULL
      AND (raw_json->>'startTimeLocal')::date >= CURRENT_DATE - make_interval(days => ${days * 2})
      AND (raw_json->>'startTimeLocal')::date < CURRENT_DATE - make_interval(days => ${days})
    ORDER BY date ASC
  `;
  return buildResponse(
    current.map((r) => ({ date: r.date, value: Number(r.value) })),
    previous.map((r) => ({ date: r.date, value: Number(r.value) }))
  );
}

async function fetchActivities(sql: SqlFn, days: number): Promise<MetricResponse> {
  const current = await sql`
    SELECT
      LEFT((raw_json->>'startTimeLocal')::text, 10) as date,
      COUNT(*)::int as value
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND (raw_json->>'startTimeLocal')::date >= CURRENT_DATE - make_interval(days => ${days})
    GROUP BY date
    ORDER BY date ASC
  `;
  const previous = await sql`
    SELECT
      LEFT((raw_json->>'startTimeLocal')::text, 10) as date,
      COUNT(*)::int as value
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND (raw_json->>'startTimeLocal')::date >= CURRENT_DATE - make_interval(days => ${days * 2})
      AND (raw_json->>'startTimeLocal')::date < CURRENT_DATE - make_interval(days => ${days})
    GROUP BY date
    ORDER BY date ASC
  `;
  return buildResponse(
    current.map((r) => ({ date: r.date, value: Number(r.value) })),
    previous.map((r) => ({ date: r.date, value: Number(r.value) }))
  );
}

async function fetchRecovery(sql: SqlFn, days: number): Promise<MetricResponse> {
  const current = await sql`
    SELECT date::text as date, body_battery_max as value, hrv_weekly_avg as value2
    FROM daily_health_summary
    WHERE date >= CURRENT_DATE - make_interval(days => ${days})
      AND body_battery_max > 0
    ORDER BY date ASC
  `;
  const previous = await sql`
    SELECT date::text as date, body_battery_max as value, hrv_weekly_avg as value2
    FROM daily_health_summary
    WHERE date >= CURRENT_DATE - make_interval(days => ${days * 2})
      AND date < CURRENT_DATE - make_interval(days => ${days})
      AND body_battery_max > 0
    ORDER BY date ASC
  `;
  return buildResponse(
    current.map((r) => ({ date: r.date, value: Number(r.value), value2: r.value2 ? Number(r.value2) : null })),
    previous.map((r) => ({ date: r.date, value: Number(r.value), value2: r.value2 ? Number(r.value2) : null }))
  );
}
