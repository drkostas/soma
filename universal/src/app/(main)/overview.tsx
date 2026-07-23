import { useEffect, useState } from "react";
import { ScrollView, View, RefreshControl } from "react-native";
import { Text, Card, Badge, Sparkline } from "soma-style";
import {
  useToday,
  useTraining,
  useSomaPlan,
  fetchJson,
  usePullRefresh,
  todayLocal,
} from "../../lib/api";

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
function useWeightTrend() {
  const [rows, setRows] = useState<WeightRow[]>([]);
  useEffect(() => {
    let alive = true;
    fetchJson<WeightRow[]>("/api/health/weight?days=30")
      .then((d) => alive && setRows(Array.isArray(d) ? d : []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
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
  const weight = useWeightTrend();
  const sleep = useSleepGlance();
  const trends = useOverviewTrends();
  const { refreshing, onRefresh } = usePullRefresh(() => {
    refetch();
    refetchTraining();
    refetchPlan();
  });

  const readiness = training?.readiness;
  const tsb = training?.pmc?.tsb ?? null;

  const km = data?.total_distance_meters ? (data.total_distance_meters / 1000).toFixed(1) : "—";

  // Weight glance: latest value + 30-day delta + spark
  const wSeries = weight.map((r) => Number(r.weight_kg)).filter((v) => isFinite(v));
  const wLatest = wSeries.length ? wSeries[wSeries.length - 1] : null;
  const wDelta = wSeries.length >= 2 ? wLatest! - wSeries[0] : null;
  const bfLatest = weight.length ? weight[weight.length - 1].body_fat_pct : null;

  // Sleep glance: latest night's score + 7-day series
  const sleepSeries = (sleep?.current ?? []).map((p) => Number(p.value)).filter((v) => isFinite(v));
  const sleepLatest = sleepSeries.length ? sleepSeries[sleepSeries.length - 1] : null;
  const sleepAvg = sleep?.summary?.current_avg ?? null;

  const stats: { label: string; value: string; sub: string; cls: string; spark?: number[]; color: string }[] = [
    { label: "Steps", value: (data?.total_steps ?? 0).toLocaleString(), sub: `${km} km`, cls: "text-teal", spark: trends?.steps, color: "#77c8d1" },
    { label: "Active Calories", value: `${Math.round(data?.active_kilocalories ?? 0)}`, sub: `${Math.round(data?.total_kilocalories ?? 0)} total`, cls: "text-warm", spark: trends?.calories, color: "#b17850" },
    { label: "Resting HR", value: `${data?.resting_heart_rate ?? "—"}`, sub: `${data?.min_heart_rate ?? "—"}–${data?.max_heart_rate ?? "—"} bpm`, cls: "text-danger", spark: trends?.rhr, color: "#e06060" },
    { label: "Avg Stress", value: `${data?.avg_stress_level ?? "—"}`, sub: `Peak ${data?.max_stress_level ?? "—"}`, cls: "text-warning", spark: trends?.stress, color: "#e0a458" },
    { label: "Body Battery", value: `${data?.body_battery_max ?? "—"}`, sub: `−${data?.body_battery_drained ?? 0} drained`, cls: "text-lime", spark: trends?.bodyBattery, color: "#cbe896" },
    { label: "Intensity min", value: `${(data?.moderate_intensity_minutes ?? 0) + (data?.vigorous_intensity_minutes ?? 0)}`, sub: `${data?.vigorous_intensity_minutes ?? 0} vigorous`, cls: "text-indigo", spark: trends?.intensity, color: "#6366b0" },
  ];

  return (
    <ScrollView
      className="flex-1 bg-base"
      contentContainerClassName="items-center px-5 py-6"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#77c8d1" colors={["#77c8d1"]} />}
    >
      <View className="w-full max-w-3xl gap-4">
        <View className="gap-1">
          <Text variant="headline">Overview</Text>
          <Text variant="caption" className="text-text-secondary">Today at a glance</Text>
        </View>

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
                <Text variant="display" style={{ color: TL_COLOR[readiness.traffic_light] ?? "#77c8d1" }}>
                  {readiness.composite_score == null ? "—" : Math.round(readiness.composite_score * 100)}
                </Text>
                <Text variant="caption" className="text-text-muted mb-1">readiness score</Text>
              </View>
              {tsb != null ? (
                <Text variant="micro" className="text-text-secondary">
                  Form {tsb >= 0 ? "+" : ""}{tsb.toFixed(0)} · {formDescriptor(tsb)}
                </Text>
              ) : null}
            </View>
          </Card>
        ) : null}

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
          <Card className="min-w-[30%] flex-1 gap-1">
            <Text variant="eyebrow">Sleep</Text>
            <Text variant="headline" className="text-indigo">{sleepLatest != null ? sleepLatest.toFixed(0) : "—"}</Text>
            <Text variant="micro">{sleepAvg != null ? `7d avg ${sleepAvg.toFixed(0)}` : "score"}</Text>
          </Card>
          <Card className="min-w-[30%] flex-1 gap-1">
            <Text variant="eyebrow">Weight</Text>
            <Text variant="headline" className="text-warm">{wLatest != null ? wLatest.toFixed(1) : "—"}</Text>
            <Text variant="micro">
              {wDelta != null ? `${wDelta >= 0 ? "+" : ""}${wDelta.toFixed(1)} kg/30d` : bfLatest != null ? `${bfLatest.toFixed(1)}% bf` : "kg"}
            </Text>
            {wSeries.length >= 2 ? (
              <View className="mt-1"><Sparkline data={wSeries} color="#b17850" height={22} baseline /></View>
            ) : null}
          </Card>
        </View>

        {/* Today's health KPIs */}
        <Text variant="eyebrow" className="text-text-muted mt-1">Today's metrics</Text>
        <View className="flex-row flex-wrap gap-3">
          {stats.map((s) => (
            <Card key={s.label} className="min-w-[46%] flex-1 gap-1">
              <Text variant="eyebrow">{s.label}</Text>
              <Text variant="headline" className={s.cls}>{s.value}</Text>
              <Text variant="micro">{s.sub}</Text>
              {s.spark && s.spark.length >= 2 ? (
                <View className="mt-1">
                  <Sparkline data={s.spark} color={s.color} height={26} baseline />
                </View>
              ) : null}
            </Card>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
