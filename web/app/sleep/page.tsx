import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpandableChartCard } from "@/components/expandable-chart-card";
import { StatCard } from "@/components/stat-card";
import { SleepStagesChart } from "@/components/sleep-chart";
import { SleepScoreChart } from "@/components/sleep-score-chart";
import { RHRChart } from "@/components/rhr-chart";
import { HRVChart } from "@/components/hrv-chart";
import { TrainingReadinessChart } from "@/components/training-readiness-chart";
import { BodyBatteryChart } from "@/components/body-battery-chart";
import { StressChart } from "@/components/stress-chart";
import { SleepScheduleChart } from "@/components/sleep-schedule-chart";
import { SpO2Chart } from "@/components/spo2-chart";
import { RespirationChart } from "@/components/respiration-chart";
import { TimeRangeSelector } from "@/components/time-range-selector";
import { rangeToDays } from "@/lib/time-ranges";
import { getDb } from "@/lib/db";
import {
  Moon,
  Sunrise,
  Wind,
  HeartPulse,
  BatteryCharging,
  Brain,
  Clock,
  Sparkles,
  Activity,
  Gauge,
} from "lucide-react";

export const revalidate = 300;

async function getSleepStats(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      COUNT(*) as total_nights,
      AVG((raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::float) / 3600.0 as avg_hours,
      AVG((raw_json->'dailySleepDTO'->'sleepScores'->'overall'->>'value')::float) as avg_score,
      AVG((raw_json->'dailySleepDTO'->>'deepSleepSeconds')::float /
          NULLIF((raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::float, 0) * 100) as avg_deep_pct,
      AVG((raw_json->'dailySleepDTO'->>'remSleepSeconds')::float /
          NULLIF((raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::float, 0) * 100) as avg_rem_pct,
      AVG((raw_json->'dailySleepDTO'->>'avgHeartRate')::float) as avg_sleep_hr,
      AVG((raw_json->'dailySleepDTO'->>'averageSpO2Value')::float) as avg_spo2
    FROM garmin_raw_data
    WHERE endpoint_name = 'sleep_data'
      AND (raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int > 0
      AND date >= ${cutoff}
  `;
  return rows[0] || null;
}

async function getSleepTrend(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->'dailySleepDTO'->>'deepSleepSeconds')::int as deep,
      (raw_json->'dailySleepDTO'->>'lightSleepSeconds')::int as light,
      (raw_json->'dailySleepDTO'->>'remSleepSeconds')::int as rem,
      (raw_json->'dailySleepDTO'->>'awakeSleepSeconds')::int as awake
    FROM garmin_raw_data
    WHERE endpoint_name = 'sleep_data'
      AND (raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int > 0
      AND date >= ${cutoff}
    ORDER BY date ASC
  `;
  return rows;
}

async function getSleepScores(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->'dailySleepDTO'->'sleepScores'->'overall'->>'value')::int as score
    FROM garmin_raw_data
    WHERE endpoint_name = 'sleep_data'
      AND (raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int > 0
      AND raw_json->'dailySleepDTO'->'sleepScores'->'overall'->>'value' IS NOT NULL
      AND date >= ${cutoff}
    ORDER BY date ASC
  `;
  return rows;
}

async function getRHRTrend(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->>'restingHeartRate')::int as rhr
    FROM garmin_raw_data
    WHERE endpoint_name = 'user_summary'
      AND raw_json->>'restingHeartRate' IS NOT NULL
      AND (raw_json->>'restingHeartRate')::int > 0
      AND date >= ${cutoff}
    ORDER BY date ASC
  `;
  return rows;
}

async function getLastNightSleep() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int as total,
      (raw_json->'dailySleepDTO'->>'deepSleepSeconds')::int as deep,
      (raw_json->'dailySleepDTO'->>'lightSleepSeconds')::int as light,
      (raw_json->'dailySleepDTO'->>'remSleepSeconds')::int as rem,
      (raw_json->'dailySleepDTO'->>'awakeSleepSeconds')::int as awake,
      (raw_json->'dailySleepDTO'->'sleepScores'->'overall'->>'value') as score,
      (raw_json->'dailySleepDTO'->'sleepScores'->'overall'->>'qualifierKey') as quality,
      (raw_json->'dailySleepDTO'->>'avgHeartRate') as avg_hr,
      (raw_json->'dailySleepDTO'->>'averageSpO2Value') as spo2,
      (raw_json->'dailySleepDTO'->>'averageRespirationValue') as resp,
      (raw_json->'dailySleepDTO'->>'sleepScoreFeedback') as feedback
    FROM garmin_raw_data
    WHERE endpoint_name = 'sleep_data'
      AND (raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int > 0
    ORDER BY date DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

async function getHRVTrend(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->'hrvSummary'->>'weeklyAvg')::int as weekly_avg,
      (raw_json->'hrvSummary'->>'lastNightAvg')::int as last_night_avg,
      raw_json->'hrvSummary'->>'status' as status
    FROM garmin_raw_data
    WHERE endpoint_name = 'hrv_data'
      AND raw_json->'hrvSummary'->>'weeklyAvg' IS NOT NULL
      AND date >= ${cutoff}
    ORDER BY date ASC
  `;
  return rows;
}

async function getTrainingReadiness(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->0->>'score')::int as score,
      raw_json->0->>'level' as level,
      (raw_json->0->>'sleepScore')::int as sleep_score,
      (raw_json->0->>'hrvFactorPercent')::int as hrv_pct,
      raw_json->0->>'hrvFactorFeedback' as hrv_feedback,
      (raw_json->0->>'stressHistoryFactorPercent')::int as stress_pct,
      (raw_json->0->>'acwrFactorPercent')::int as acwr_pct,
      (raw_json->0->>'recoveryTimeFactorPercent')::int as recovery_pct,
      (raw_json->0->>'sleepHistoryFactorPercent')::int as sleep_history_pct
    FROM garmin_raw_data
    WHERE endpoint_name = 'training_readiness'
      AND raw_json->0->>'score' IS NOT NULL
      AND date >= ${cutoff}
    ORDER BY date ASC
  `;
  return rows;
}

async function getStressTrend(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->>'averageStressLevel')::int as avg_stress,
      (raw_json->>'maxStressLevel')::int as max_stress
    FROM garmin_raw_data
    WHERE endpoint_name = 'user_summary'
      AND raw_json->>'averageStressLevel' IS NOT NULL
      AND (raw_json->>'averageStressLevel')::int > 0
      AND date >= ${cutoff}
    ORDER BY date ASC
  `;
  return rows;
}

async function getBodyBatteryTrend(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->>'bodyBatteryChargedValue')::int as charged,
      (raw_json->>'bodyBatteryDrainedValue')::int as drained
    FROM garmin_raw_data
    WHERE endpoint_name = 'user_summary'
      AND raw_json->>'bodyBatteryChargedValue' IS NOT NULL
      AND (raw_json->>'bodyBatteryChargedValue')::int > 0
      AND date >= ${cutoff}
    ORDER BY date ASC
  `;
  return rows;
}

async function getRespirationTrend(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->>'avgWakingRespirationValue')::float as awake_resp,
      (raw_json->>'avgSleepRespirationValue')::float as sleep_resp,
      (raw_json->>'lowestRespirationValue')::float as low_resp,
      (raw_json->>'highestRespirationValue')::float as high_resp
    FROM garmin_raw_data
    WHERE endpoint_name = 'respiration_data'
      AND raw_json->>'avgWakingRespirationValue' IS NOT NULL
      AND date >= ${cutoff}
    ORDER BY date ASC
  `;
  return rows;
}

async function getSpO2Trend(cutoff: string) {
  const sql = getDb();
  // Combine sleep_data (historical) with spo2_data (recent, richer)
  // spo2_data wins on overlapping dates via COALESCE
  const rows = await sql`
    SELECT
      COALESCE(s.date, p.date)::text as date,
      COALESCE(
        (p.raw_json->>'averageSpO2')::float,
        (s.raw_json->'dailySleepDTO'->>'averageSpO2Value')::float
      ) as avg_spo2,
      COALESCE(
        (p.raw_json->>'lowestSpO2')::int,
        (s.raw_json->'dailySleepDTO'->>'lowestSpO2Value')::int
      ) as low_spo2,
      (p.raw_json->>'avgSleepSpO2')::float as sleep_spo2
    FROM garmin_raw_data s
    FULL OUTER JOIN garmin_raw_data p
      ON s.date = p.date AND p.endpoint_name = 'spo2_data' AND p.raw_json->>'averageSpO2' IS NOT NULL
    WHERE s.endpoint_name = 'sleep_data'
      AND (s.raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int > 0
      AND s.date >= ${cutoff}
      AND (
        s.raw_json->'dailySleepDTO'->>'averageSpO2Value' IS NOT NULL
        OR p.raw_json->>'averageSpO2' IS NOT NULL
      )
    ORDER BY 1 ASC
  `;
  return rows;
}

async function getSleepSchedule(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->'dailySleepDTO'->>'sleepStartTimestampLocal')::bigint as start_ts,
      (raw_json->'dailySleepDTO'->>'sleepEndTimestampLocal')::bigint as end_ts
    FROM garmin_raw_data
    WHERE endpoint_name = 'sleep_data'
      AND (raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int > 0
      AND raw_json->'dailySleepDTO'->>'sleepStartTimestampLocal' IS NOT NULL
      AND date >= ${cutoff}
    ORDER BY date ASC
  `;
  return rows.map((r: any) => {
    const startMs = Number(r.start_ts);
    const endMs = Number(r.end_ts);
    const startDate = new Date(startMs);
    const endDate = new Date(endMs);
    return {
      date: r.date,
      // Use UTC methods since Garmin stores local time encoded as UTC timestamps
      bedtimeHour: startDate.getUTCHours() + startDate.getUTCMinutes() / 60,
      wakeHour: endDate.getUTCHours() + endDate.getUTCMinutes() / 60,
    };
  });
}

async function getWeekdayWeekendSleep(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      CASE
        WHEN EXTRACT(DOW FROM date) IN (0, 6) THEN 'weekend'
        ELSE 'weekday'
      END as day_type,
      AVG((raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::float) / 3600.0 as avg_hours,
      AVG((raw_json->'dailySleepDTO'->'sleepScores'->'overall'->>'value')::float) as avg_score,
      AVG((raw_json->'dailySleepDTO'->>'deepSleepSeconds')::float /
          NULLIF((raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::float, 0) * 100) as avg_deep_pct,
      COUNT(*) as nights
    FROM garmin_raw_data
    WHERE endpoint_name = 'sleep_data'
      AND (raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int > 0
      AND date >= ${cutoff}
    GROUP BY day_type
  `;
  const result: Record<string, any> = {};
  for (const r of rows) result[r.day_type] = r;
  return result;
}

async function getSleepRegularity(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::float / 3600.0 as hours,
      (raw_json->'dailySleepDTO'->>'sleepStartTimestampLocal')::bigint as start_ts,
      (raw_json->'dailySleepDTO'->>'sleepEndTimestampLocal')::bigint as end_ts
    FROM garmin_raw_data
    WHERE endpoint_name = 'sleep_data'
      AND (raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int > 0
      AND raw_json->'dailySleepDTO'->>'sleepStartTimestampLocal' IS NOT NULL
      AND date >= ${cutoff}
    ORDER BY date DESC
    LIMIT 30
  `;
  if (rows.length < 3) return null;

  // Calculate bedtime/wake time variability
  const bedtimes: number[] = [];
  const waketimes: number[] = [];
  const durations: number[] = [];

  for (const r of rows) {
    const startDate = new Date(Number(r.start_ts));
    // Use UTC methods since Garmin stores local time encoded as UTC timestamps
    let bedHour = startDate.getUTCHours() + startDate.getUTCMinutes() / 60;
    if (bedHour < 12) bedHour += 24; // past midnight = next day
    bedtimes.push(bedHour);

    const endDate = new Date(Number(r.end_ts));
    waketimes.push(endDate.getUTCHours() + endDate.getUTCMinutes() / 60);
    durations.push(Number(r.hours));
  }

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const stddev = (arr: number[]) => {
    const mean = avg(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
  };

  return {
    avg_bedtime: avg(bedtimes),
    avg_waketime: avg(waketimes),
    avg_duration: avg(durations),
    bedtime_stddev: stddev(bedtimes),
    waketime_stddev: stddev(waketimes),
    duration_stddev: stddev(durations),
    nights: rows.length,
  };
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function qualityBadge(quality: string | null) {
  if (!quality) return null;
  const colors: Record<string, string> = {
    EXCELLENT: "bg-green-500/20 text-green-400",
    GOOD: "bg-green-500/20 text-green-400",
    FAIR: "bg-yellow-500/20 text-yellow-400",
    POOR: "bg-red-500/20 text-red-400",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[quality] || "bg-muted text-muted-foreground"}`}>
      {quality.charAt(0) + quality.slice(1).toLowerCase()}
    </span>
  );
}

export default async function SleepPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const params = await searchParams;
  const rangeDays = rangeToDays(params.range);
  const cutoff = new Date(Date.now() - rangeDays * 86400000).toISOString().split("T")[0];

  const [stats, sleepTrend, scores, rhrTrend, lastNight, bodyBattery, hrvTrend, trainingReadiness, stressTrend, sleepSchedule, respiration, spo2Trend, weekdayWeekend, sleepRegularity] =
    await Promise.all([
      getSleepStats(cutoff),
      getSleepTrend(cutoff),
      getSleepScores(cutoff),
      getRHRTrend(cutoff),
      getLastNightSleep(),
      getBodyBatteryTrend(cutoff),
      getHRVTrend(cutoff),
      getTrainingReadiness(cutoff),
      getStressTrend(cutoff),
      getSleepSchedule(cutoff),
      getRespirationTrend(cutoff),
      getSpO2Trend(cutoff),
      getWeekdayWeekendSleep(cutoff),
      getSleepRegularity(cutoff),
    ]);

  return (
    <div className="container mx-auto px-6 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sleep & Recovery</h1>
          <p className="text-muted-foreground mt-1">
            {stats?.total_nights
              ? `${Number(stats.total_nights)} nights tracked`
              : "No sleep data yet."}
          </p>
        </div>
        <TimeRangeSelector />
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Avg Sleep"
          value={stats?.avg_hours ? `${Number(stats.avg_hours).toFixed(1)}h` : "—"}
          icon={<Moon className="h-4 w-4 text-indigo-400" />}
        />
        <StatCard
          title="Avg Score"
          value={stats?.avg_score ? `${Math.round(Number(stats.avg_score))}` : "—"}
          subtitle="out of 100"
          icon={<Sparkles className="h-4 w-4 text-yellow-400" />}
        />
        <StatCard
          title="Avg Deep Sleep"
          value={stats?.avg_deep_pct ? `${Math.round(Number(stats.avg_deep_pct))}%` : "—"}
          subtitle={stats?.avg_rem_pct ? `REM: ${Math.round(Number(stats.avg_rem_pct))}%` : undefined}
          icon={<Brain className="h-4 w-4 text-purple-400" />}
        />
        <StatCard
          title="Avg Sleep HR"
          value={stats?.avg_sleep_hr ? `${Math.round(Number(stats.avg_sleep_hr))} bpm` : "—"}
          subtitle={stats?.avg_spo2 ? `SpO2: ${Math.round(Number(stats.avg_spo2))}%` : undefined}
          icon={<HeartPulse className="h-4 w-4 text-red-400" />}
        />
      </div>

      {/* Last Night Detail */}
      {lastNight && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Moon className="h-4 w-4" />
              Last Night
              {qualityBadge(lastNight.quality)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Total</div>
                <div className="text-lg font-bold">{formatDuration(lastNight.total)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Score</div>
                <div className="text-lg font-bold">{lastNight.score ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Deep</div>
                <div className="text-lg font-bold text-indigo-400">{formatDuration(lastNight.deep)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">REM</div>
                <div className="text-lg font-bold text-purple-400">{formatDuration(lastNight.rem)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Heart Rate</div>
                <div className="text-lg font-bold">{lastNight.avg_hr ? `${Math.round(Number(lastNight.avg_hr))} bpm` : "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">SpO2</div>
                <div className="text-lg font-bold">{lastNight.spo2 ? `${Math.round(Number(lastNight.spo2))}%` : "—"}</div>
              </div>
            </div>
            {/* Sleep stage bars */}
            {lastNight.total > 0 && (
              <div className="mt-4 flex h-3 rounded-full overflow-hidden">
                <div className="bg-indigo-500" style={{ width: `${(lastNight.deep / lastNight.total) * 100}%` }} />
                <div className="bg-indigo-300" style={{ width: `${(lastNight.light / lastNight.total) * 100}%` }} />
                <div className="bg-purple-400" style={{ width: `${(lastNight.rem / lastNight.total) * 100}%` }} />
                <div className="bg-red-400" style={{ width: `${(lastNight.awake / lastNight.total) * 100}%` }} />
              </div>
            )}
            <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500" /> Deep</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-300" /> Light</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400" /> REM</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Awake</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts Row 1: Sleep Stages + Score */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <ExpandableChartCard title="Sleep Stages">
          <SleepStagesChart data={sleepTrend as any} />
        </ExpandableChartCard>

        <ExpandableChartCard title="Sleep Score Trend">
          <SleepScoreChart data={scores as any} />
        </ExpandableChartCard>
      </div>

      {/* Sleep Schedule */}
      {(sleepSchedule as any[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Sunrise className="h-4 w-4 text-yellow-400" />
              Sleep Schedule
              {(() => {
                const recent = (sleepSchedule as any[]).slice(-7);
                // Normalize bedtime: hours before 18 are "next day" (add 24)
                const avgBedNorm = recent.reduce((s: number, d: any) => {
                  const h = d.bedtimeHour;
                  return s + (h < 18 ? h + 24 : h);
                }, 0) / recent.length;
                const avgBed = avgBedNorm >= 24 ? avgBedNorm - 24 : avgBedNorm;
                const avgWake = recent.reduce((s: number, d: any) => s + d.wakeHour, 0) / recent.length;
                const fmtH = (h: number) => {
                  const hr = Math.floor(h);
                  const min = Math.round((h - hr) * 60);
                  const p = hr >= 12 ? "PM" : "AM";
                  const h12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
                  return `${h12}:${min.toString().padStart(2, "0")} ${p}`;
                };
                return (
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    Avg: {fmtH(avgBed)} → {fmtH(avgWake)}
                  </span>
                );
              })()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SleepScheduleChart data={sleepSchedule as any[]} />
            <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-3 h-1 rounded" style={{ background: "hsl(250, 60%, 55%)", display: "inline-block" }} /> Bedtime
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-1 rounded" style={{ background: "hsl(40, 80%, 55%)", display: "inline-block" }} /> Wake Time
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sleep Regularity */}
      {sleepRegularity && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald-400" />
              Sleep Regularity
              <span className="ml-auto text-xs font-normal">Last {sleepRegularity.nights} nights</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const fmtH = (h: number) => {
                const hr = Math.floor(h % 24);
                const min = Math.round((h % 1) * 60);
                const p = hr >= 12 ? "PM" : "AM";
                const h12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
                return `${h12}:${min.toString().padStart(2, "0")} ${p}`;
              };
              // Regularity score: lower stddev = higher score (max 100)
              const bedScore = Math.max(0, Math.round(100 - sleepRegularity.bedtime_stddev * 30));
              const wakeScore = Math.max(0, Math.round(100 - sleepRegularity.waketime_stddev * 30));
              const overallScore = Math.round((bedScore + wakeScore) / 2);
              const scoreColor = overallScore >= 80 ? "text-green-400" : overallScore >= 60 ? "text-yellow-400" : "text-red-400";
              const scoreLabel = overallScore >= 80 ? "Consistent" : overallScore >= 60 ? "Moderate" : "Irregular";

              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground mb-1">Regularity Score</div>
                    <div className={`text-3xl font-bold ${scoreColor}`}>{overallScore}</div>
                    <div className={`text-xs ${scoreColor}`}>{scoreLabel}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground mb-1">Avg Bedtime</div>
                    <div className="text-lg font-bold">{fmtH(sleepRegularity.avg_bedtime)}</div>
                    <div className="text-xs text-muted-foreground">
                      ±{(sleepRegularity.bedtime_stddev * 60).toFixed(0)} min
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground mb-1">Avg Wake Time</div>
                    <div className="text-lg font-bold">{fmtH(sleepRegularity.avg_waketime)}</div>
                    <div className="text-xs text-muted-foreground">
                      ±{(sleepRegularity.waketime_stddev * 60).toFixed(0)} min
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground mb-1">Avg Duration</div>
                    <div className="text-lg font-bold">{sleepRegularity.avg_duration.toFixed(1)}h</div>
                    <div className="text-xs text-muted-foreground">
                      ±{(sleepRegularity.duration_stddev * 60).toFixed(0)} min
                    </div>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Weekday vs Weekend Sleep */}
      {weekdayWeekend.weekday && weekdayWeekend.weekend && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Moon className="h-4 w-4 text-indigo-400" />
              Weekday vs Weekend Sleep
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Avg Duration", weekday: `${Number(weekdayWeekend.weekday.avg_hours).toFixed(1)}h`, weekend: `${Number(weekdayWeekend.weekend.avg_hours).toFixed(1)}h`, diff: Number(weekdayWeekend.weekend.avg_hours) - Number(weekdayWeekend.weekday.avg_hours) },
                { label: "Avg Score", weekday: Math.round(Number(weekdayWeekend.weekday.avg_score)), weekend: Math.round(Number(weekdayWeekend.weekend.avg_score)), diff: Number(weekdayWeekend.weekend.avg_score) - Number(weekdayWeekend.weekday.avg_score) },
                { label: "Deep Sleep %", weekday: `${Number(weekdayWeekend.weekday.avg_deep_pct).toFixed(0)}%`, weekend: `${Number(weekdayWeekend.weekend.avg_deep_pct).toFixed(0)}%`, diff: Number(weekdayWeekend.weekend.avg_deep_pct) - Number(weekdayWeekend.weekday.avg_deep_pct) },
              ].map((metric) => (
                <div key={metric.label} className="text-center">
                  <div className="text-xs text-muted-foreground mb-2">{metric.label}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-lg font-bold">{metric.weekday}</div>
                      <div className="text-[10px] text-muted-foreground">Weekday</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold">{metric.weekend}</div>
                      <div className="text-[10px] text-muted-foreground">Weekend</div>
                    </div>
                  </div>
                  <div className={`text-xs mt-1 ${metric.diff > 0 ? "text-green-400" : metric.diff < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                    {metric.diff > 0 ? "+" : ""}{typeof metric.diff === "number" ? metric.diff.toFixed(1) : metric.diff} on weekends
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts Row 2: RHR + Body Battery */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <ExpandableChartCard title="Resting Heart Rate" icon={<HeartPulse className="h-4 w-4 text-red-400" />}>
          <RHRChart data={rhrTrend as any} />
        </ExpandableChartCard>

        <ExpandableChartCard title="Body Battery" icon={<BatteryCharging className="h-4 w-4 text-green-400" />}>
          {bodyBattery.length > 0 ? (
            <BodyBatteryChart
              data={(bodyBattery as any[]).map((bb: any) => ({
                date: bb.date,
                charged: Number(bb.charged),
                drained: Number(bb.drained),
              }))}
            />
          ) : (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
              No body battery data
            </div>
          )}
        </ExpandableChartCard>
      </div>

      {/* Stress Trend */}
      {stressTrend.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Brain className="h-4 w-4 text-yellow-400" />
              Stress Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-4">
              {(() => {
                const latest = stressTrend[stressTrend.length - 1] as any;
                const recentAvg = stressTrend.slice(-7).reduce((s: number, d: any) => s + Number(d.avg_stress), 0) / Math.min(stressTrend.length, 7);
                return (
                  <>
                    <div>
                      <div className="text-xs text-muted-foreground">Today&apos;s Avg</div>
                      <div className="text-2xl font-bold">{latest?.avg_stress ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">7-Day Avg</div>
                      <div className="text-2xl font-bold">{Math.round(recentAvg)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Today&apos;s Peak</div>
                      <div className="text-2xl font-bold">{latest?.max_stress ?? "—"}</div>
                    </div>
                  </>
                );
              })()}
            </div>
            <StressChart
              data={(stressTrend as any[]).map((s: any) => ({
                date: s.date,
                avg_stress: Number(s.avg_stress),
                max_stress: Number(s.max_stress),
              }))}
            />
            <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-3 h-1 rounded bg-yellow-400" style={{ display: "inline-block" }} /> Average
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 rounded bg-red-400/50" style={{ display: "inline-block", borderTop: "1px dashed" }} /> Peak
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Respiration */}
      {(respiration as any[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Wind className="h-4 w-4 text-sky-400" />
              Respiration Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const data = (respiration as any[]);
              const latest = data[data.length - 1];
              const recent7 = data.slice(-7);
              const avgSleep = recent7.reduce((s: number, d: any) => s + Number(d.sleep_resp || 0), 0) / recent7.length;
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <div className="text-xs text-muted-foreground">Awake</div>
                    <div className="text-2xl font-bold">{latest?.awake_resp ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">breaths/min</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Sleep</div>
                    <div className="text-2xl font-bold">{latest?.sleep_resp ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">breaths/min</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Range</div>
                    <div className="text-2xl font-bold">{latest?.low_resp}–{latest?.high_resp}</div>
                    <div className="text-xs text-muted-foreground">breaths/min</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">7-Day Sleep Avg</div>
                    <div className="text-2xl font-bold">{avgSleep.toFixed(1)}</div>
                    <div className="text-xs text-muted-foreground">breaths/min</div>
                  </div>
                </div>
              );
            })()}
            <RespirationChart data={respiration as any[]} />
            <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-sky-400 inline-block" /> Sleep</span>
              <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-slate-400 inline-block" style={{ borderTop: "2px dashed" }} /> Awake</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* SpO2 Trend */}
      {(spo2Trend as any[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-400" />
              Blood Oxygen (SpO2)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const data = (spo2Trend as any[]).filter((d: any) => d.avg_spo2 > 0);
              if (data.length === 0) return <p className="text-sm text-muted-foreground">No SpO2 data</p>;
              const latest = data[data.length - 1];
              const recent7 = data.slice(-7);
              const avg7 = recent7.reduce((s: number, d: any) => s + Number(d.avg_spo2), 0) / recent7.length;
              const allAvg = data.reduce((s: number, d: any) => s + Number(d.avg_spo2), 0) / data.length;
              const lowVals = data.filter((d: any) => d.low_spo2 && Number(d.low_spo2) > 0).map((d: any) => Number(d.low_spo2));
              const minSpo2 = lowVals.length > 0 ? Math.min(...lowVals) : null;
              return (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div>
                      <div className="text-xs text-muted-foreground">Last Night</div>
                      <div className="text-2xl font-bold">{Number(latest.avg_spo2).toFixed(0)}%</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">7-Day Avg</div>
                      <div className="text-2xl font-bold">{avg7.toFixed(0)}%</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Overall Avg</div>
                      <div className="text-2xl font-bold">{allAvg.toFixed(0)}%</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Lowest Recorded</div>
                      <div className="text-2xl font-bold">{minSpo2 && minSpo2 < 100 ? `${minSpo2}%` : "—"}</div>
                    </div>
                  </div>
                  <SpO2Chart data={data} />
                  <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-blue-400 inline-block" /> Average</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-purple-400 inline-block" style={{ borderTop: "2px dashed" }} /> Sleep</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-red-400 inline-block" /> Lowest</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-green-400 inline-block" style={{ borderTop: "2px dashed" }} /> 95% normal</span>
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* HRV Trend */}
      {hrvTrend.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-400" />
              Heart Rate Variability (HRV)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <div className="text-xs text-muted-foreground">Latest Weekly Avg</div>
                <div className="text-2xl font-bold">
                  {Number(hrvTrend[hrvTrend.length - 1]?.weekly_avg) || "—"}
                  <span className="text-sm font-normal text-muted-foreground ml-1">ms</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Last Night</div>
                <div className="text-2xl font-bold">
                  {Number(hrvTrend[hrvTrend.length - 1]?.last_night_avg) || "—"}
                  <span className="text-sm font-normal text-muted-foreground ml-1">ms</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Status</div>
                <div className="text-2xl font-bold capitalize">
                  {(() => {
                    const s = hrvTrend[hrvTrend.length - 1]?.status as string;
                    if (!s) return "—";
                    const colors: Record<string, string> = {
                      BALANCED: "text-green-400",
                      LOW: "text-red-400",
                      UNBALANCED: "text-yellow-400",
                    };
                    return <span className={colors[s] || ""}>{s.toLowerCase()}</span>;
                  })()}
                </div>
              </div>
            </div>
            <HRVChart
              data={(hrvTrend as any[]).map((h: any) => ({
                date: h.date,
                weekly_avg: Number(h.weekly_avg),
                last_night_avg: Number(h.last_night_avg),
                status: h.status,
              }))}
            />
            <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400/60" /> Last Night</span>
              <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-emerald-400/80" style={{ display: "inline-block" }} /> Weekly Avg</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Training Readiness */}
      {trainingReadiness.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Gauge className="h-4 w-4 text-amber-400" />
              Training Readiness
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              {(() => {
                const latest = trainingReadiness[trainingReadiness.length - 1] as any;
                if (!latest) return null;
                const levelColors: Record<string, string> = {
                  PRIME: "text-green-400",
                  HIGH: "text-green-400",
                  MODERATE: "text-yellow-400",
                  LOW: "text-red-400",
                };
                return (
                  <>
                    <div>
                      <div className="text-xs text-muted-foreground">Score</div>
                      <div className="text-2xl font-bold">{latest.score}</div>
                      <div className={`text-xs capitalize ${levelColors[latest.level] || ""}`}>
                        {latest.level?.toLowerCase()}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">HRV Factor</div>
                      <div className="text-2xl font-bold">{latest.hrv_pct}%</div>
                      <div className="text-xs text-muted-foreground capitalize">{latest.hrv_feedback?.toLowerCase()}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Stress Factor</div>
                      <div className="text-2xl font-bold">{latest.stress_pct}%</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Training Load</div>
                      <div className="text-2xl font-bold">{latest.acwr_pct}%</div>
                    </div>
                  </>
                );
              })()}
            </div>
            {/* Component Breakdown Bars */}
            {(() => {
              const latest = trainingReadiness[trainingReadiness.length - 1] as any;
              if (!latest) return null;
              const factors = [
                { label: "HRV", value: latest.hrv_pct, color: "bg-green-500" },
                { label: "Stress", value: latest.stress_pct, color: "bg-yellow-500" },
                { label: "Training Load", value: latest.acwr_pct, color: "bg-blue-500" },
                { label: "Recovery", value: latest.recovery_pct, color: "bg-purple-500" },
                { label: "Sleep History", value: latest.sleep_history_pct, color: "bg-indigo-500" },
                { label: "Sleep Score", value: latest.sleep_score, color: "bg-cyan-500" },
              ].filter((f) => f.value != null);

              return (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 mb-4">
                  {factors.map((f) => (
                    <div key={f.label} className="flex items-center gap-2">
                      <div className="text-[10px] text-muted-foreground w-20 text-right shrink-0">{f.label}</div>
                      <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full ${f.color} rounded-full transition-all ${f.value >= 70 ? "opacity-100" : f.value >= 40 ? "opacity-70" : "opacity-50"}`}
                          style={{ width: `${Math.min(f.value, 100)}%` }}
                        />
                      </div>
                      <span className={`text-xs font-medium w-8 ${f.value >= 70 ? "text-green-400" : f.value >= 40 ? "text-yellow-400" : "text-red-400"}`}>
                        {f.value}%
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}
            <TrainingReadinessChart
              data={(trainingReadiness as any[]).map((tr: any) => ({
                date: tr.date,
                score: Number(tr.score),
                level: tr.level || "",
              }))}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
