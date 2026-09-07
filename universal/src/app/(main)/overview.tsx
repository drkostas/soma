import { useEffect, useState } from "react";
import { TimeRangeSelector } from "../../components/time-range-selector";
import { useRangePref, rangeToDays, rangeLabel } from "../../lib/time-range";
import { InfoHint, STAT_INFO, TREND_7D, TREND_7D_LOWER } from "../../components/info-hint";
import { OverviewTrendCharts } from "../../components/overview-trend-charts";
import { WorkoutDetailModal } from "../../components/workout-detail-modal";
import { ScrollView, View, RefreshControl, Pressable } from "react-native";
import { Text, Card, Badge, Sparkline } from "soma-style";
import { LineChart, ChartLegend, ExpandableChart, chartDateLabel } from "../../components/line-chart";
import { StatDetailModal, type StatDetail } from "../../components/stat-detail-modal";
import { TrendArrow } from "../../components/trend-arrow";
import { ThisWeekCard, type WeeklyTraining } from "../../components/this-week-card";
import { ActivityHeatmap, RecentActivityFeed, ActivityBreakdown, LastGymSession, GymFrequency } from "../../components/activity-content";
import { ActivityDetailModal } from "../../components/activity-detail-modal";
import {
  useToday,
  useTraining,
  useSomaPlan,
  useRecoverySummary,
  useActivitiesDeep,
  useWorkoutsSummary,
  useWorkoutInsights,
  fetchJson,
  usePullRefresh,
  todayLocal,
  type ActivityRow,
} from "../../lib/api";
import { readinessScore } from "../../lib/readiness";
import { freshness, staleShort, todayKey } from "../../lib/freshness";

interface OverviewTrends {
  steps: number[];
  calories: number[];
  rhr: number[];
  stress: number[];
  bodyBattery: number[];
  intensity: number[];
}

/** 14-day trend series for the Home KPI sparklines. */
function useOverviewTrends() {
  const [trends, setTrends] = useState<OverviewTrends | null>(null);
  useEffect(() => {
    let alive = true;
    fetchJson<OverviewTrends>("/api/overview/trends")
      .then((d) => alive && setTrends(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return trends;
}

interface WeightRow { date: string; weight_kg: number | null; bmi: number | null; body_fat_pct: number | null }
/** Last 30 days of weigh-ins (ascending) for the weight glance + sparkline. */
function useWeightTrend(days: number) {
  const [rows, setRows] = useState<WeightRow[]>([]);
  useEffect(() => {
    let alive = true;
    fetchJson<WeightRow[]>(`/api/health/weight?days=${days}`)
      .then((d) => alive && setRows(Array.isArray(d) ? d : []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [days]);
  return rows;
}

interface StatPoint { date: string; value: number | null }
interface StatSeries { current: StatPoint[]; summary: { current_avg: number | null } }
/** Last 7 days of sleep score for the sleep glance. */
function useSleepGlance() {
  const [s, setS] = useState<StatSeries | null>(null);
  useEffect(() => {
    let alive = true;
    fetchJson<StatSeries>("/api/stats/sleep?range=7d")
      .then((d) => alive && setS(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return s;
}

interface FitnessComponent { key: string; label: string; unit: string; value: number | null; target: number | null; priority: number | null }
interface WeeklyIntensity { goal: number; total: number; moderate: number; vigorous: number }
interface FitnessResp { fitness_age: number | null; chrono_age: number | null; achievable_age: number | null; total_activities: number; components?: FitnessComponent[]; intensity?: WeeklyIntensity | null }
const fmtComp = (v: number) => (v % 1 === 0 ? String(v) : v.toFixed(1));
/** Garmin Fitness Age + lifetime activity count, from /api/overview/fitness. */
function useOverviewFitness() {
  const [f, setF] = useState<FitnessResp | null>(null);
  useEffect(() => {
    let alive = true;
    fetchJson<FitnessResp>("/api/overview/fitness")
      .then((d) => alive && setF(d))
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return f;
}

interface Vo2maxResp { stats: { vo2max: number | null; total_runs?: number | string | null; total_km?: number | string | null } | null; trends: { vo2max: number[] } }
/** Current VO2max + its trend, from /api/running/stats. */
function useVo2max(range: string) {
  const [v, setV] = useState<{ current: number | null; trend: number[]; runs: number; km: number }>({ current: null, trend: [], runs: 0, km: 0 });
  useEffect(() => {
    let alive = true;
    fetchJson<Vo2maxResp>(`/api/running/stats?range=${range}`)
      .then((d) => alive && setV({ current: d.stats?.vo2max ?? (d.trends?.vo2max?.at(-1) ?? null), trend: d.trends?.vo2max ?? [], runs: Number(d.stats?.total_runs ?? 0) || 0, km: Number(d.stats?.total_km ?? 0) || 0 }))
      .catch(() => {});
    return () => { alive = false; };
  }, [range]);
  return v;
}

/** This-week vs last-week training totals + streak for the This Week card. */
/** Today's body battery (charged / drained) from the stats series — web's Recovery Status shows
 *  "Body Battery · <date> +45 −44 drained" next to the readiness score (soma#783). */
type BbPoint = { date: string; value: number | null; value2?: number | null };
/** An ISO timestamp as the LOCAL calendar day (web's "since 2026-08-21", not the UTC 21:00 of the day before). */
function localDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function useBodyBattery() {
  const [bb, setBb] = useState<BbPoint | null>(null);
  useEffect(() => {
    let alive = true;
    fetchJson<{ current: BbPoint[] }>("/api/stats/body_battery?range=7d")
      .then((d) => { const pts = (d.current ?? []).filter((p) => p.value != null); if (alive) setBb(pts.length ? pts[pts.length - 1] : null); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return bb;
}

function useWeeklyTraining() {
  const [w, setW] = useState<WeeklyTraining | null>(null);
  useEffect(() => {
    let alive = true;
    fetchJson<WeeklyTraining>("/api/overview/weekly-training")
      .then((d) => alive && setW(d))
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return w;
}

const TL_TONE: Record<string, "success" | "warm" | "danger" | "teal"> = {
  green: "success",
  amber: "warm",
  yellow: "warm",
  red: "danger",
};
const TL_COLOR: Record<string, string> = {
  green: "#6ad4a0",
  amber: "#e0a458",
  yellow: "#e0a458",
  red: "#e06060",
  unknown: "#9aa3ad",
};

function formDescriptor(tsb: number): string {
  if (tsb >= 15) return "Fresh — well recovered, ready for a hard session.";
  if (tsb >= 5) return "Balanced — moderate freshness.";
  if (tsb >= -10) return "Productive — building fitness under load.";
  return "Fatigued — prioritise recovery.";
}

export default function OverviewScreen() {
  const { data, error, refetch } = useToday();
  const { data: training, refetch: refetchTraining } = useTraining(todayLocal());
  const { data: plan, refetch: refetchPlan } = useSomaPlan(todayLocal());
  const [range, setRange] = useRangePref();
  const weight = useWeightTrend(rangeToDays(range));
  const sleep = useSleepGlance();
  const trends = useOverviewTrends();
  const weekly = useWeeklyTraining();
  const vo2 = useVo2max(range);
  const recovery = useRecoverySummary("30d");
  const { data: activitiesDeep } = useActivitiesDeep(range);
  const { data: wkSum } = useWorkoutsSummary(range);
  const { data: wkIns } = useWorkoutInsights(range);
  const bb = useBodyBattery();
  const fitness = useOverviewFitness();
  const { refreshing, onRefresh } = usePullRefresh(() => {
    refetch();
    refetchTraining();
    refetchPlan();
  });

  const [statDetail, setStatDetail] = useState<StatDetail | null>(null);
  const [selActivity, setSelActivity] = useState<ActivityRow | null>(null);
  const [selWorkout, setSelWorkout] = useState<{ id: string; title: string } | null>(null);
  const readiness = training?.readiness;
  const tsb = training?.pmc?.tsb ?? null;

  const km = data?.total_distance_meters ? (data.total_distance_meters / 1000).toFixed(1) : "—";

  // Weight glance: latest value + 30-day delta + spark
  const wSeries = weight.map((r) => Number(r.weight_kg)).filter((v) => isFinite(v));
  const wLatest = wSeries.length ? wSeries[wSeries.length - 1] : null;
  const wDelta = wSeries.length >= 2 ? wLatest! - wSeries[0] : null;
  const bfLatest = weight.length ? weight[weight.length - 1].body_fat_pct : null;
  // Body-composition chart: weight (left axis) + body-fat % (right axis) over the 90-day trend.
  const wLabels = weight.map((r) => chartDateLabel(r.date));
  const wVals = weight.map((r) => { const v = Number(r.weight_kg); return isFinite(v) ? v : null; });
  const bfVals = weight.map((r) => (r.body_fat_pct != null && isFinite(Number(r.body_fat_pct)) ? Number(r.body_fat_pct) : null));
  const hasBf = bfVals.filter((v) => v != null).length >= 2;
  const bodyCompSeries = [
    { values: wVals, color: "#b17850", width: 2.2, label: "Weight" },
    ...(hasBf ? [{ values: bfVals, color: "#77c8d1", width: 1.6, dashed: true, axis: "right" as const, label: "Body fat" }] : []),
  ];
  const wAvg = wSeries.length ? wSeries.reduce((a, b) => a + b, 0) / wSeries.length : null;
  const bodyCompChart = { series: bodyCompSeries, labels: wLabels, yFormat: (v: number) => v.toFixed(1), yFormatRight: (v: number) => `${v.toFixed(0)}%`, refLine: wAvg != null ? { y: wAvg, color: "#b17850", label: `avg ${wAvg.toFixed(1)} kg` } : undefined };

  // Sleep glance: latest night's score + 7-day series
  const sleepSeries = (sleep?.current ?? []).map((p) => Number(p.value)).filter((v) => isFinite(v));
  const sleepLatest = sleepSeries.length ? sleepSeries[sleepSeries.length - 1] : null;
  const sleepAvg = sleep?.summary?.current_avg ?? null;

  const hrvLatest = recovery.data?.hrv?.latest ?? null;
  const garminReadiness = recovery.data?.readiness?.latest?.score ?? null;
  const hrvSpark = (recovery.data?.hrv?.trend ?? []).map((p) => Number(p.weekly_avg)).filter((v) => isFinite(v));
  // An HRV reading older than two days is not today's metric (#731).
  const hrvFresh = freshness(hrvLatest?.date ?? null, todayKey());

  // Web's "Total Activities" card counts every Garmin activity plus Hevy workouts in the
  // range, with a running-km subtitle (soma#758). The activity feed here excludes runs and
  // gym, so add the runs from the running stats and the workouts from the summary.
  const rangeOther = activitiesDeep?.all?.length ?? 0;
  const rangeGym = Number(wkSum?.stats?.total_workouts ?? 0) || 0;
  const rangeTotal = rangeOther + vo2.runs + rangeGym;
  const rangeRunKm = vo2.km;
  const stats: { label: string; value: string; sub: string; cls: string; spark?: number[]; color: string; unit?: string; metric?: string; inverted?: boolean; info?: string; trend?: string }[] = [
    { label: "Steps", info: STAT_INFO.steps, trend: TREND_7D, value: data?.total_steps != null ? data.total_steps.toLocaleString() : "—", sub: `${km} km`, cls: "text-teal", spark: trends?.steps, color: "#77c8d1", metric: "steps" },
    { label: "Active Calories", info: STAT_INFO.calories, trend: TREND_7D, value: data?.active_kilocalories != null ? Math.round(data.active_kilocalories).toLocaleString() : "—", sub: `${data?.total_kilocalories != null ? Math.round(data.total_kilocalories).toLocaleString() : "—"} total`, cls: "text-warm", spark: trends?.calories, color: "#b17850", unit: "kcal", metric: "calories" },
    { label: "Resting HR", info: STAT_INFO.rhr, trend: TREND_7D_LOWER, value: `${data?.resting_heart_rate ?? "—"}`, sub: `${data?.min_heart_rate ?? "—"}–${data?.max_heart_rate ?? "—"} bpm`, cls: "text-danger", spark: trends?.rhr, color: "#e06060", unit: "bpm", metric: "rhr", inverted: true },
    { label: "Avg Stress", info: STAT_INFO.stress, trend: TREND_7D_LOWER, value: `${data?.avg_stress_level ?? "—"}`, sub: `Peak ${data?.max_stress_level ?? "—"}`, cls: "text-warning", spark: trends?.stress, color: "#e0a458", metric: "stress", inverted: true },
    { label: "Body Battery", value: `${data?.body_battery_max ?? "—"}`, sub: `−${Math.abs(data?.body_battery_drained ?? 0)} drained`, cls: "text-lime", spark: trends?.bodyBattery, color: "#cbe896", metric: "body_battery" },
    { label: "Intensity min", value: `${(data?.moderate_intensity_minutes ?? 0) + (data?.vigorous_intensity_minutes ?? 0)}`, sub: `${data?.vigorous_intensity_minutes ?? 0} vigorous`, cls: "text-indigo", spark: trends?.intensity, color: "#6366b0", unit: "min" },
    { label: "VO₂max", info: STAT_INFO.vo2max, trend: TREND_7D, value: vo2.current != null ? Number(vo2.current).toFixed(1) : "—", sub: "ml/kg/min", cls: "text-teal", spark: vo2.trend.filter((x) => isFinite(x)), color: "#77c8d1", metric: "vo2max" },
    { label: "HRV", value: !hrvFresh.stale && hrvLatest?.weekly_avg != null ? String(hrvLatest.weekly_avg) : "—", sub: hrvFresh.stale ? `${staleShort("HRV", hrvFresh)}${hrvLatest?.weekly_avg != null ? ` · last ${hrvLatest.weekly_avg}` : ""}` : hrvLatest?.status ? String(hrvLatest.status) : "7-night avg", cls: "text-lime", spark: hrvSpark, color: "#cbe896", unit: "ms" },
    { label: "Total activities", info: STAT_INFO.activities, value: rangeTotal ? rangeTotal.toLocaleString() : "—", sub: rangeTotal ? `${Math.round(rangeRunKm)} km running · ${rangeLabel(range)}` : "in this range", cls: "text-teal", color: "#77c8d1", metric: "activities" },
  ];

  return (
    <ScrollView
      className="flex-1 bg-base"
      contentContainerClassName="items-center px-5 pt-6 pb-28"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#77c8d1" colors={["#77c8d1"]} />}
    >
      <View className="w-full max-w-3xl gap-4">
        <View className="gap-1">
          <Text variant="headline">Overview</Text>
          <Text variant="caption" className="text-text-secondary">Today at a glance</Text>
        </View>
        <TimeRangeSelector value={range} onChange={setRange} />

        {error ? <Card><Text variant="body" className="text-danger">API: {error}</Text></Card> : null}

        {/* Readiness hero — the "what should I do today" signal */}
        {readiness ? (
          <Card className="gap-3">
            <View
              className="rounded-xl px-4 py-4 gap-2"
              style={{ backgroundColor: (TL_COLOR[readiness.traffic_light] ?? "#77c8d1") + "1f" }}
            >
              <View className="flex-row items-center justify-between">
                <Text variant="eyebrow" className="text-text-secondary">Readiness</Text>
                <Badge label={readiness.traffic_light.toUpperCase()} tone={TL_TONE[readiness.traffic_light] ?? "teal"} />
              </View>
              <View className="flex-row items-end gap-2">
                {readiness.traffic_light === "unknown" ? (
                  <Text variant="caption" className="text-text-muted">
                    No sleep data for last night — readiness unknown until the watch syncs a night.
                  </Text>
                ) : readiness.composite_score != null && readiness.composite_score > 0 ? (
                  <>
                    <Text variant="display" style={{ color: TL_COLOR[readiness.traffic_light] ?? "#77c8d1" }}>
                      {readinessScore(readiness.composite_score)}
                    </Text>
                    <Text variant="caption" className="text-text-muted mb-1">readiness score</Text>
                  </>
                ) : (
                  <Text variant="caption" className="text-text-muted">
                    Calibrating — not enough baseline data for a score yet.
                  </Text>
                )}
              </View>
              {tsb != null ? (
                <Text variant="micro" className="text-text-secondary">
                  Form {tsb >= 0 ? "+" : ""}{tsb.toFixed(0)} · {formDescriptor(tsb)}
                </Text>
              ) : null}
              {/* Web's Recovery Status row: Garmin's readiness as the comparison, today's body
                  battery charged/drained, and the HRV reading with its freshness (soma#783). */}
              {(garminReadiness != null || bb || hrvLatest) ? (
                <View className="flex-row flex-wrap gap-x-3 gap-y-0.5 mt-0.5" testID="overview-recovery-row">
                  {garminReadiness != null ? <Text variant="micro" className="text-text-secondary tabular-nums">Garmin {garminReadiness}</Text> : null}
                  {bb ? (
                    <Text variant="micro" className="text-text-secondary tabular-nums">
                      Body Battery{bb.date !== todayKey() ? ` · ${chartDateLabel(bb.date)}` : ""} +{Math.round(bb.value ?? 0)}{bb.value2 != null ? ` / −${Math.round(bb.value2)} drained` : ""}
                    </Text>
                  ) : null}
                  {hrvLatest ? (
                    <Text variant="micro" className="text-text-secondary tabular-nums">
                      {hrvFresh.stale
                        ? `No HRV reading since ${localDay(hrvLatest.date)} · last ${hrvLatest.last_night_avg ?? hrvLatest.weekly_avg ?? "—"} ms`
                        : `HRV ${hrvLatest.weekly_avg ?? "—"} ms weekly${hrvLatest.last_night_avg != null ? ` · last night ${hrvLatest.last_night_avg}` : ""}`}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          </Card>
        ) : null}

        {/* This Week training summary */}
        <ThisWeekCard data={weekly} />

        {/* Fitness age */}
        {fitness?.fitness_age != null ? (
          <Card className="gap-2">
            <Text variant="eyebrow">Fitness age</Text>
            <View className="flex-row items-end gap-2">
              <Text variant="display" className="text-teal tabular-nums">{Math.round(fitness.fitness_age)}</Text>
              {fitness.chrono_age != null ? (
                <Text variant="body" className={`mb-1 ${fitness.chrono_age - fitness.fitness_age >= 0 ? "text-success" : "text-warm"}`}>
                  {Math.abs(Math.round(fitness.chrono_age - fitness.fitness_age))} yrs {fitness.chrono_age - fitness.fitness_age >= 0 ? "younger" : "older"}
                </Text>
              ) : null}
            </View>
            {fitness.chrono_age != null ? (
              <>
                <View className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: "#16242c" }}>
                  <View className="h-full rounded-full" style={{ width: `${Math.min((fitness.fitness_age / fitness.chrono_age) * 100, 100)}%`, backgroundColor: "#6ad4a0" }} />
                </View>
                <Text variant="micro" className="text-text-muted">
                  chronological age {fitness.chrono_age}{fitness.achievable_age != null ? ` · achievable ${Math.round(fitness.achievable_age)}` : ""}
                </Text>
              </>
            ) : null}
            {fitness.components && fitness.components.length ? (
              <View className="mt-1 gap-1 border-t border-border-subtle pt-2">
                <Text variant="micro" className="text-text-muted">WHAT LOWERS IT · most impact first</Text>
                {fitness.components.map((c) => {
                  const has = c.target != null && c.value != null;
                  const met = has ? (c.key.startsWith("vigorous") ? (c.value as number) >= (c.target as number) : (c.value as number) <= (c.target as number)) : false;
                  return (
                    <View key={c.key} className="flex-row items-center justify-between">
                      <Text variant="micro" className="text-text-secondary">{c.label}</Text>
                      <Text variant="micro" className="tabular-nums" style={{ color: has ? (met ? "#6ad4a0" : "#e0a458") : "#8aa0ac" }}>
                        {c.value != null ? `${fmtComp(c.value)}${c.unit ? ` ${c.unit}` : ""}` : "—"}
                        {has ? `  →  ${fmtComp(c.target as number)}` : ""}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </Card>
        ) : null}

        {/* Weekly intensity minutes (vs Garmin goal) */}
        {fitness?.intensity && fitness.intensity.goal > 0 ? (() => {
          const im = fitness.intensity;
          const pct = Math.min(100, (im.total / im.goal) * 100);
          const met = im.total >= im.goal;
          return (
            <Card className="gap-2">
              <View className="flex-row items-center justify-between">
                <Text variant="eyebrow">Weekly intensity</Text>
                <Text variant="micro" className="tabular-nums text-text-muted">{im.total} / {im.goal} min</Text>
              </View>
              <View className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: "#16242c" }}>
                <View className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: met ? "#6ad4a0" : "#6366b0" }} />
              </View>
              <Text variant="micro" className="text-text-muted">
                {im.moderate} moderate · {im.vigorous} vigorous (2×) · {Math.round((im.total / im.goal) * 100)}% of goal
              </Text>
            </Card>
          );
        })() : null}

        {/* Cross-domain glance row */}
        <View className="flex-row flex-wrap gap-3">
          <Card className="min-w-[30%] flex-1 gap-1">
            <Text variant="eyebrow">Kcal left</Text>
            <Text variant="headline" className="text-teal">
              {plan?.remaining?.calories != null ? Math.round(plan.remaining.calories) : "—"}
            </Text>
            <Text variant="micro">
              {plan?.plan ? `of ${Math.round(plan.plan.target_calories)} target` : "no plan today"}
            </Text>
          </Card>
          <Pressable
            className="min-w-[30%] flex-1"
            disabled={sleepSeries.length < 2}
            onPress={() => setStatDetail({ label: "Sleep", value: sleepLatest != null ? `${sleepLatest.toFixed(1)}h` : "—", sub: sleepAvg != null ? `7d avg ${sleepAvg.toFixed(1)}h` : "hours", spark: sleepSeries, color: "#8b9df0", unit: "h", metric: "sleep", info: STAT_INFO.sleep })}
          >
            <Card className="gap-1">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-1.5">
                  <Text variant="eyebrow">Sleep</Text>
                  <InfoHint title="Sleep" text={STAT_INFO.sleep} trend={TREND_7D} />
                </View>
                <TrendArrow series={sleep?.current?.map((p) => (p.value != null ? Number(p.value) : null))} />
              </View>
              <Text variant="headline" className="text-indigo">{sleepLatest != null ? `${sleepLatest.toFixed(1)}h` : "—"}</Text>
              <Text variant="micro">{sleepAvg != null ? `7d avg ${sleepAvg.toFixed(1)}h` : "hours"}</Text>
            </Card>
          </Pressable>
          <Card className="min-w-[30%] flex-1 gap-1">
            <Text variant="eyebrow">Weight</Text>
            <Text variant="headline" className="text-warm">{wLatest != null ? wLatest.toFixed(1) : "—"}</Text>
            <Text variant="micro">
              {wDelta != null ? `${wDelta >= 0 ? "+" : ""}${wDelta.toFixed(1)} kg/${rangeLabel(range)}` : bfLatest != null ? `${bfLatest.toFixed(1)}% bf` : "kg"}
            </Text>
            {wSeries.length >= 2 ? (
              <View className="mt-1"><Sparkline data={wSeries} color="#b17850" height={22} baseline /></View>
            ) : null}
          </Card>
        </View>

        {/* Body composition — weight + body-fat % over the 90-day trend */}
        {wSeries.length >= 2 ? (
          <Card className="gap-2">
            <ExpandableChart title="Body composition" chart={bodyCompChart}>
              <View className="flex-row items-end gap-2">
                <Text variant="display" className="text-warm">{wLatest != null ? wLatest.toFixed(1) : "—"}</Text>
                <Text variant="caption" className="text-text-muted mb-1">
                  kg{bfLatest != null ? ` · ${bfLatest.toFixed(1)}% bf` : ""}{wDelta != null ? ` · ${wDelta >= 0 ? "+" : ""}${wDelta.toFixed(1)} kg/${rangeLabel(range)}` : ""}
                </Text>
              </View>
              <LineChart height={130} interactive xTicks={4} labels={wLabels} yFormat={bodyCompChart.yFormat} yFormatRight={bodyCompChart.yFormatRight} refLine={bodyCompChart.refLine} series={bodyCompSeries} />
            </ExpandableChart>
            {hasBf ? <ChartLegend items={[{ color: "#b17850", label: "Weight (kg)" }, { color: "#77c8d1", label: "Body fat (%)", dashed: true }]} /> : null}
          </Card>
        ) : null}

        {/* Today's health KPIs */}
        <Text variant="eyebrow" className="text-text-muted mt-1">Today's metrics</Text>
        <View className="flex-row flex-wrap gap-3">
          {stats.map((s) => (
            <Pressable key={s.label} className="min-w-[46%] flex-1" onPress={() => setStatDetail(s)}>
              <Card className="gap-1">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-1.5">
                    <Text variant="eyebrow">{s.label}</Text>
                    {s.info ? <InfoHint title={s.label} text={s.info} trend={s.trend} /> : null}
                  </View>
                  <View className="flex-row items-center gap-1.5">
                    <TrendArrow series={s.spark} inverted={s.inverted} />
                    <Text variant="micro" className="text-text-muted">›</Text>
                  </View>
                </View>
                <Text variant="headline" className={s.cls}>{s.value}</Text>
                <Text variant="micro">{s.sub}</Text>
                {s.spark && s.spark.length >= 2 ? (
                  <View className="mt-1">
                    <Sparkline data={s.spark} color={s.color} height={26} baseline />
                  </View>
                ) : null}
              </Card>
            </Pressable>
          ))}
        </View>

        {/* Web's four page-level trend charts, scoped to the selected range (soma#769) */}
        <OverviewTrendCharts range={range} />

        {/* Activity content — calendar heatmap, recent feed, breakdown */}
        {activitiesDeep?.all?.length ? (
          <>
            <Text variant="eyebrow" className="text-text-muted mt-1">Activity</Text>
            <ActivityHeatmap activities={activitiesDeep.all} />
            <LastGymSession activities={activitiesDeep.all} workouts={wkSum?.recent} onSelect={setSelActivity} onSelectWorkout={setSelWorkout} />
            <GymFrequency days={wkIns?.calendar ?? []} sinceDays={rangeToDays(range)} rangeLabel={rangeLabel(range)} />
            <RecentActivityFeed activities={activitiesDeep.all} workouts={wkSum?.recent} onSelect={setSelActivity} onSelectWorkout={setSelWorkout} />
            <ActivityBreakdown monthly={activitiesDeep.monthly ?? []} />
          </>
        ) : null}
      </View>

      <StatDetailModal stat={statDetail} onClose={() => setStatDetail(null)} />
      <ActivityDetailModal activity={selActivity} onClose={() => setSelActivity(null)} />
      <WorkoutDetailModal id={selWorkout?.id ?? null} title={selWorkout?.title} unit="kg" onClose={() => setSelWorkout(null)} />
    </ScrollView>
  );
}
