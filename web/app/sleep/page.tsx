import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { SleepStagesChart } from "@/components/sleep-chart";
import { SleepScoreChart } from "@/components/sleep-score-chart";
import { RHRChart } from "@/components/rhr-chart";
import { getDb } from "@/lib/db";
import {
  Moon,
  HeartPulse,
  BatteryCharging,
  Brain,
  Clock,
  Sparkles,
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
  const [stats, sleepTrend, scores, rhrTrend, lastNight, bodyBattery] =
    await Promise.all([
      getSleepStats(),
      getSleepTrend(),
      getSleepScores(),
      getRHRTrend(),
      getLastNightSleep(),
      getBodyBatteryTrend(),
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
              <div className="space-y-2">
                {bodyBattery.slice(-14).map((bb: any) => {
                  const charged = Number(bb.charged);
                  const drained = Number(bb.drained);
                  const net = charged - drained;
                  return (
                    <div key={bb.date} className="flex items-center gap-2 text-xs">
                      <span className="w-12 text-muted-foreground">
                        {new Date(bb.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                      <div className="flex-1 flex h-4 gap-0.5">
                        <div
                          className="bg-green-500/60 rounded-l-sm"
                          style={{ width: `${charged}%` }}
                        />
                        <div
                          className="bg-red-400/60 rounded-r-sm"
                          style={{ width: `${drained}%` }}
                        />
                      </div>
                      <span className={`w-10 text-right font-medium ${net > 0 ? "text-green-400" : "text-red-400"}`}>
                        {net > 0 ? "+" : ""}{net}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
                No body battery data
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
