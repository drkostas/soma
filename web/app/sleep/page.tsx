import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { SleepStagesChart } from "@/components/sleep-chart";
import { SleepScoreChart } from "@/components/sleep-score-chart";
import { RHRChart } from "@/components/rhr-chart";
import { HRVChart } from "@/components/hrv-chart";
import { TrainingReadinessChart } from "@/components/training-readiness-chart";
import { BodyBatteryChart } from "@/components/body-battery-chart";
import { StressChart } from "@/components/stress-chart";
import { SleepScheduleChart } from "@/components/sleep-schedule-chart";
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

async function getSleepStats() {
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
  `;
  return rows[0] || null;
}

async function getSleepTrend() {
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
    ORDER BY date ASC
  `;
  return rows;
}

async function getSleepScores() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->'dailySleepDTO'->'sleepScores'->'overall'->>'value')::int as score
    FROM garmin_raw_data
    WHERE endpoint_name = 'sleep_data'
      AND (raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int > 0
      AND raw_json->'dailySleepDTO'->'sleepScores'->'overall'->>'value' IS NOT NULL
    ORDER BY date ASC
  `;
  return rows;
}

async function getRHRTrend() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->>'restingHeartRate')::int as rhr
    FROM garmin_raw_data
    WHERE endpoint_name = 'user_summary'
      AND raw_json->>'restingHeartRate' IS NOT NULL
      AND (raw_json->>'restingHeartRate')::int > 0
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

async function getHRVTrend() {
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
    ORDER BY date ASC
  `;
  return rows;
}

async function getTrainingReadiness() {
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
      (raw_json->0->>'acwrFactorPercent')::int as acwr_pct
    FROM garmin_raw_data
    WHERE endpoint_name = 'training_readiness'
      AND raw_json->0->>'score' IS NOT NULL
    ORDER BY date ASC
  `;
  return rows;
}

async function getStressTrend() {
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
    ORDER BY date ASC
  `;
  return rows;
}

async function getBodyBatteryTrend() {
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
    ORDER BY date ASC
  `;
  return rows;
}

async function getRespirationTrend() {
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
    ORDER BY date ASC
  `;
  return rows;
}

async function getSleepSchedule() {
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
    ORDER BY date ASC
  `;
  return rows.map((r: any) => {
    const startMs = Number(r.start_ts);
    const endMs = Number(r.end_ts);
    const startDate = new Date(startMs);
    const endDate = new Date(endMs);
    return {
      date: r.date,
      bedtimeHour: startDate.getHours() + startDate.getMinutes() / 60,
      wakeHour: endDate.getHours() + endDate.getMinutes() / 60,
    };
  });
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

export default async function SleepPage() {
  const [stats, sleepTrend, scores, rhrTrend, lastNight, bodyBattery, hrvTrend, trainingReadiness, stressTrend, sleepSchedule, respiration] =
    await Promise.all([
      getSleepStats(),
      getSleepTrend(),
      getSleepScores(),
      getRHRTrend(),
      getLastNightSleep(),
      getBodyBatteryTrend(),
      getHRVTrend(),
      getTrainingReadiness(),
      getStressTrend(),
      getSleepSchedule(),
      getRespirationTrend(),
    ]);

  return (
    <div className="container mx-auto px-6 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Sleep & Recovery</h1>
        <p className="text-muted-foreground mt-1">
          {stats?.total_nights
            ? `${Number(stats.total_nights)} nights tracked`
            : "No sleep data yet."}
        </p>
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
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sleep Stages
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SleepStagesChart data={sleepTrend as any} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sleep Score Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SleepScoreChart data={scores as any} />
          </CardContent>
        </Card>
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
                const avgBed = recent.reduce((s: number, d: any) => s + d.bedtimeHour, 0) / recent.length;
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

      {/* Charts Row 2: RHR + Body Battery */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-red-400" />
              Resting Heart Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RHRChart data={rhrTrend as any} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <BatteryCharging className="h-4 w-4 text-green-400" />
              Body Battery
            </CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
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
            {/* Mini trend bars for sleep respiration */}
            <div className="flex items-end gap-[3px] h-16">
              {(respiration as any[]).slice(-30).map((d: any, i: number) => {
                const val = Number(d.sleep_resp || 0);
                const norm = Math.max(((val - 8) / 10) * 100, 5);
                return (
                  <div
                    key={i}
                    className="flex-1 bg-sky-400/60 rounded-t-sm"
                    style={{ height: `${Math.min(norm, 100)}%` }}
                    title={`${d.date}: ${val} breaths/min`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              {(() => {
                const data = (respiration as any[]).slice(-30);
                return (
                  <>
                    <span>{data.length > 0 ? new Date(data[0].date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</span>
                    <span>Sleep Respiration Trend</span>
                    <span>{data.length > 0 ? new Date(data[data.length - 1].date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</span>
                  </>
                );
              })()}
            </div>
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
