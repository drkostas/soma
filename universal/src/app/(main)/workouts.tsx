import { ScrollView, View, RefreshControl, Pressable } from "react-native";
import { useEffect, useState } from "react";
import { Text, Card, Badge, ProgressBar, SegmentedControl, Sparkline } from "soma-style";
import { fetchJson, usePullRefresh, useWorkoutsSummary, useWorkoutInsights } from "../../lib/api";
import { StatDetailModal, type StatDetail } from "../../components/stat-detail-modal";
import { WorkoutsDashboard } from "../../components/workouts-dashboard";
import { WorkoutActivity } from "../../components/workout-activity";
import { WorkoutMuscle } from "../../components/workout-muscle";
import { WorkoutStrength } from "../../components/workout-strength";

interface RecentWorkout {
  title: string;
  date: string;
  kcal: number;
  exercises: number;
  sets: number;
  synced: boolean;
  status: string;
}

interface HevyStatus {
  hevyConnected: boolean;
  garminConnected: boolean;
  totalSynced: number;
  syncedThisWeek: number;
  recent: RecentWorkout[];
}

/**
 * soma's Hevy/Garmin workout sync status — recent strength workouts, their
 * enrichment (Garmin calories) and sync state. Mirrors the web /workouts page
 * (which reads the DB directly); this first pass consumes the JSON API instead.
 */
function useWorkouts() {
  const [data, setData] = useState<HevyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchJson<HevyStatus>("/api/hevy/status")
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [reload]);
  return { data, error, refetch: () => setReload((n) => n + 1) };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "2-digit" }),
  });
}

export default function WorkoutsScreen() {
  const { data, error, refetch } = useWorkouts();
  const [range, setRange] = useState<"30d" | "90d" | "1y">("90d");
  const [unit, setUnit] = useState<"kg" | "lb">("kg");
  const { data: wkSum } = useWorkoutsSummary(range);
  const { data: insights } = useWorkoutInsights(range);
  const { refreshing, onRefresh } = usePullRefresh(refetch);
  const [statDetail, setStatDetail] = useState<StatDetail | null>(null);

  // Training span (first → last workout) from the all-time calendar.
  const trainingSpan = (() => {
    const cal = insights?.calendar ?? [];
    if (cal.length < 2) return null;
    const first = new Date(String(cal[0].day).slice(0, 10));
    const last = new Date(String(cal[cal.length - 1].day).slice(0, 10));
    const days = Math.round((last.getTime() - first.getTime()) / 86400000);
    const months = Math.max(1, Math.round(days / 30.4));
    return { count: cal.length, years: days / 365, months, first: cal[0].day, last: cal[cal.length - 1].day };
  })();

  const recent = data?.recent ?? [];
  const totalSynced = data?.totalSynced ?? 0;
  const syncedThisWeek = data?.syncedThisWeek ?? 0;
  const syncedCount = recent.filter((w) => w.synced).length;
  const syncPct = recent.length > 0 ? syncedCount / recent.length : 0;

  const avgKcal = (() => {
    const withKcal = recent.filter((w) => w.kcal > 0);
    if (withKcal.length === 0) return null;
    return Math.round(withKcal.reduce((s, w) => s + w.kcal, 0) / withKcal.length);
  })();
  const avgExercises = (() => {
    const withEx = recent.filter((w) => w.exercises > 0);
    if (withEx.length === 0) return null;
    return Math.round(withEx.reduce((s, w) => s + w.exercises, 0) / withEx.length);
  })();

  // Per-session calories, oldest→newest, for the Avg-Calories trend sparkline.
  const kcalTrend = recent
    .map((w) => w.kcal)
    .filter((k) => k > 0)
    .reverse();

  const stats: { label: string; value: string; sub: string; cls: string; spark?: { data: number[]; color: string } }[] = [
    {
      label: "Total Synced",
      value: `${totalSynced}`,
      sub: `${syncedThisWeek} this week`,
      cls: "text-teal",
    },
    {
      label: "Recent Sessions",
      value: `${recent.length}`,
      sub: `${syncedCount} on Garmin`,
      cls: "text-lime",
    },
    {
      label: "Avg Calories",
      value: avgKcal != null ? `${avgKcal}` : "—",
      sub: "kcal via Garmin HR",
      cls: "text-warm",
      spark: { data: kcalTrend, color: "#b17850" },
    },
    ...(trainingSpan
      ? [{
          label: "Training Span",
          value: trainingSpan.years >= 1 ? `${trainingSpan.years.toFixed(1)}y` : `${trainingSpan.months}mo`,
          sub: `${trainingSpan.count} workouts logged`,
          cls: "text-indigo",
        }]
      : []),
  ];

  return (
    <ScrollView
      className="flex-1 bg-base"
      contentContainerClassName="items-center px-5 py-6"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#77c8d1" colors={["#77c8d1"]} />}
    >
      <View className="w-full max-w-2xl gap-4">
        <View className="flex-row items-center gap-2">
          <Text variant="headline">Workouts</Text>
          {data ? (
            <Badge
              label={data.garminConnected ? "Garmin synced" : data.hevyConnected ? "Hevy only" : "No data"}
              tone={data.garminConnected ? "success" : data.hevyConnected ? "warm" : "neutral"}
            />
          ) : null}
        </View>
        <Text variant="caption" className="text-text-secondary">
          Training history and Garmin sync
        </Text>

        {error ? (
          <Card>
            <Text variant="body" className="text-danger">
              API: {error} — is soma running on :3456?
            </Text>
          </Card>
        ) : null}

        {/* Summary stats */}
        <View className="flex-row flex-wrap gap-3">
          {stats.map((s) => {
            const tappable = !!(s.spark && s.spark.data.length >= 2);
            return (
              <Pressable
                key={s.label}
                className="min-w-[46%] flex-1"
                disabled={!tappable}
                onPress={() => s.spark && setStatDetail({ label: s.label, value: s.value, sub: s.sub, spark: s.spark.data, color: s.spark.color, unit: s.label === "Avg Calories" ? "kcal" : undefined })}
              >
                <Card className="gap-1">
                  <View className="flex-row items-center justify-between">
                    <Text variant="eyebrow">{s.label}</Text>
                    {tappable ? <Text variant="micro" className="text-text-muted">›</Text> : null}
                  </View>
                  <Text variant="headline" className={s.cls}>
                    {s.value}
                  </Text>
                  <Text variant="micro">{s.sub}</Text>
                  {tappable && s.spark ? (
                    <View className="mt-1">
                      <Sparkline data={s.spark.data} color={s.spark.color} height={24} baseline />
                    </View>
                  ) : null}
                </Card>
              </Pressable>
            );
          })}
        </View>

        {/* Workout data — volume, stats, top exercises, recent (new /api/workouts/summary) */}
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <SegmentedControl
              options={["30d", "90d", "1y"] as const}
              value={range}
              onChange={(v) => setRange(v as "30d" | "90d" | "1y")}
            />
          </View>
          <View className="w-24">
            <SegmentedControl options={["kg", "lb"] as const} value={unit} onChange={(v) => setUnit(v as "kg" | "lb")} />
          </View>
        </View>
        <WorkoutsDashboard summary={wkSum} unit={unit} topRich={insights?.topExercises} />

        {/* Muscle-group distribution + monthly-by-muscle (new /api/workouts/insights) */}
        <WorkoutMuscle insights={insights} />

        {/* Configurable strength progression + PRs + program split */}
        <WorkoutStrength insights={insights} unit={unit} />

        {/* Training calendar + weekly frequency + avg-HR per workout */}
        <WorkoutActivity insights={insights} />

        {/* Sync coverage bar */}
        {recent.length > 0 ? (
          <Card className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text variant="eyebrow">Garmin sync coverage</Text>
              <Text variant="caption" className="tabular-nums text-text">
                {syncedCount}/{recent.length}
              </Text>
            </View>
            <ProgressBar pct={syncPct} color="#6ad4a0" />
            <Text variant="micro">
              {syncPct >= 1
                ? "Every recent workout is on Garmin."
                : `${Math.round(syncPct * 100)}% of recent workouts mirrored to Garmin.`}
            </Text>
          </Card>
        ) : null}

      </View>

      <StatDetailModal stat={statDetail} onClose={() => setStatDetail(null)} />
    </ScrollView>
  );
}