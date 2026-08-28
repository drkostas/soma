import { useEffect, useState } from "react";
import { ScrollView, View, RefreshControl, Pressable } from "react-native";
import { Text, Card, Badge, ProgressBar, SegmentedControl, Sparkline } from "soma-style";
import { StatDetailModal, type StatDetail } from "../../components/stat-detail-modal";
import { fetchJson, usePullRefresh, useRunningTrends, useFitnessScores, useRunningSplits, useHrPace, useRecentRoutes, useRunHeatmap } from "../../lib/api";
import { RunningMileage } from "../../components/running-mileage";
import { RunningDeepTrends } from "../../components/running-deep-trends";
import { RunningFitnessScores } from "../../components/running-fitness-scores";
import { RunningSplits } from "../../components/running-splits";
import { RunningHrPace } from "../../components/running-hr-pace";
import { RunningRoutes } from "../../components/running-routes";
import { RunningPaceVo2Charts } from "../../components/running-pace-vo2-charts";
import { RunHeatmap } from "../../components/run-heatmap";
import { RunTable } from "../../components/run-table";

/* ------------------------------------------------------------------ */
/* Types — mirror the fields the web /running page renders             */
/* ------------------------------------------------------------------ */

interface RunningStats {
  total_runs: number | null;
  total_km: number | null;
  avg_pace: number | null; // minutes / km
  avg_hr: number | null;
  peak_vo2max: number | null;
  longest_run: number | null;
}

interface TrainingStatus {
  status_code: string | null;
  sport: string | null;
  feedback: string | null;
  acute_load: number | null;
  chronic_load: number | null;
  acwr: number | null;
  acwr_status: string | null;
  vo2max: number | null;
}

interface HrZone {
  zone: string;
  count: number;
  avg_duration: number | null;
  avg_km: number | null;
}

interface PersonalRecord {
  date: string | null;
  name?: string | null;
  pace?: number | null;
  distance?: number | null;
  duration_min?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  calories?: number | null;
  est_5k_seconds?: number | null;
  est_10k_seconds?: number | null;
}

interface Records {
  fastest5k: PersonalRecord | null;
  fastest10k: PersonalRecord | null;
  fastestPace: PersonalRecord | null;
  longest: PersonalRecord | null;
  maxHR: PersonalRecord | null;
  maxCal: PersonalRecord | null;
}

interface ShoeMileage {
  gear_pk: string;
  shoe_name: string;
  status: string | null;
  max_km: number | null;
  runs: number;
  total_km: number;
}

interface RecentRun {
  activity_id: string;
  date: string | null;
  name: string | null;
  distance: number | null;
  duration_min: number | null;
  pace: number | null;
  avg_hr: number | null;
  calories: number | null;
}

interface RunningPayload {
  stats: RunningStats | null;
  trainingStatus: TrainingStatus | null;
  hrDistribution: HrZone[];
  records: Records | null;
  shoeMileage: ShoeMileage[];
  recentRuns: RecentRun[];
  trends: { pace: number[]; vo2max: number[]; mileage: number[] } | null;
}

/* ------------------------------------------------------------------ */
/* Data hook — inline useEffect+fetch, matching useToday/useTraining   */
/* ------------------------------------------------------------------ */

function useRunning() {
  const [data, setData] = useState<RunningPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchJson<RunningPayload>("/api/running/stats")
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [reload]);
  return { data, error, refetch: () => setReload((n) => n + 1) };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatPace(mins: number | null | undefined): string {
  if (mins == null || !isFinite(mins)) return "—";
  const t = Math.round(mins * 60); // round total seconds so :60 can never render
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSeconds(secs: number | null | undefined): string {
  if (secs == null || !isFinite(secs)) return "—";
  const t = Math.round(secs);
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const num = (v: number | null | undefined): number => (v == null ? 0 : Number(v));

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  "7": { label: "Productive", cls: "text-success" },
  "6": { label: "Maintaining", cls: "text-teal" },
  "5": { label: "Recovery", cls: "text-warning" },
  "4": { label: "Unproductive", cls: "text-warm" },
  "3": { label: "Detraining", cls: "text-danger" },
  "2": { label: "Peaking", cls: "text-indigo" },
  "1": { label: "Overreaching", cls: "text-danger" },
};

// Zone tint hexes for the HR distribution bar (Zone 1 → 5).
const ZONE_HEX = ["#77c8d1", "#6ad4a0", "#e0c458", "#e0a458", "#e06060"];

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

export default function RunningScreen() {
  const { data, error, refetch } = useRunning();
  // Range drives the trend sections (all four endpoints accept 90d/1y/2y).
  const [range, setRange] = useState<"90d" | "1y" | "2y">("1y");
  const [statDetail, setStatDetail] = useState<StatDetail | null>(null);
  const { data: runTrends } = useRunningTrends(range);
  const { data: fitScores } = useFitnessScores(range);
  const { data: splits } = useRunningSplits(range);
  const { data: hrPace } = useHrPace(range);
  const { data: routes } = useRecentRoutes();
  const { routes: heatRoutes } = useRunHeatmap();
  const { refreshing, onRefresh } = usePullRefresh(refetch);

  const stats = data?.stats;
  const ts = data?.trainingStatus;
  const zones = data?.hrDistribution ?? [];
  const records = data?.records;
  const shoes = data?.shoeMileage ?? [];
  const recent = data?.recentRuns ?? [];

  const zoneTotal = zones.reduce((s, z) => s + num(z.count), 0);
  const trends = data?.trends;

  const summaryCards: {
    label: string;
    value: string;
    sub: string;
    cls: string;
    spark?: { data: number[]; color: string };
    unit?: string;
  }[] = [
    {
      label: "Total Distance",
      value: stats?.total_km != null ? `${num(stats.total_km).toFixed(0)} km` : "—",
      sub: `${num(stats?.total_runs)} runs`,
      cls: "text-teal",
      spark: trends?.mileage?.length ? { data: trends.mileage, color: "#77c8d1" } : undefined,
      unit: "km",
    },
    {
      label: "Avg Pace",
      value: stats?.avg_pace != null ? `${formatPace(num(stats.avg_pace))}/km` : "—",
      sub: "per kilometre",
      cls: "text-lime",
      spark: trends?.pace?.length ? { data: trends.pace, color: "#cbe896" } : undefined,
    },
    {
      label: "Avg Heart Rate",
      value: stats?.avg_hr != null ? `${Math.round(num(stats.avg_hr))} bpm` : "—",
      sub: "across runs",
      cls: "text-danger",
    },
    {
      label: "VO2max",
      value: (() => {
        const t = trends?.vo2max;
        const latest = t && t.length ? t[t.length - 1] : stats?.peak_vo2max;
        return latest != null ? num(latest).toFixed(1) : "—";
      })(),
      sub: stats?.peak_vo2max != null ? `peak ${num(stats.peak_vo2max).toFixed(1)}` : "ml/kg/min",
      cls: "text-warning",
      spark: trends?.vo2max?.length ? { data: trends.vo2max, color: "#e0a458" } : undefined,
      unit: "ml/kg/min",
    },
  ];

  const statusInfo =
    ts?.status_code != null
      ? STATUS_MAP[ts.status_code] ?? { label: ts.feedback ?? "Unknown", cls: "text-text-secondary" }
      : null;

  return (
    <ScrollView
      className="flex-1 bg-base"
      contentContainerClassName="items-center px-5 py-6"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#77c8d1" colors={["#77c8d1"]} />}
    >
      <View className="w-full max-w-2xl gap-4">
        {/* Header */}
        <View className="gap-1">
          <Text variant="headline">Running</Text>
          <Text variant="caption" className="text-text-secondary">
            {stats?.total_runs
              ? `${num(stats.total_runs)} runs tracked · ${num(stats.total_km).toFixed(0)} km total`
              : "No runs tracked yet."}
          </Text>
        </View>

        {error ? (
          <Card>
            <Text variant="body" className="text-danger">
              API: {error} — is soma running on :3456?
            </Text>
          </Card>
        ) : null}

        {/* Summary stat grid */}
        <View className="flex-row flex-wrap gap-3">
          {summaryCards.map((s) => {
            const tappable = !!(s.spark && s.spark.data.length >= 2);
            return (
              <Pressable
                key={s.label}
                className="min-w-[46%] flex-1"
                disabled={!tappable}
                onPress={() => s.spark && setStatDetail({ label: s.label, value: s.value, sub: s.sub, spark: s.spark.data, color: s.spark.color, unit: s.unit })}
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
                      <Sparkline data={s.spark.data} color={s.spark.color} height={28} baseline />
                    </View>
                  ) : null}
                </Card>
              </Pressable>
            );
          })}
        </View>

        {/* Training Status — only when Garmin actually populated it (else it was
            a card full of dashes next to the live VO2max + load-trend below). */}
        {ts && (ts.status_code != null || ts.vo2max != null || ts.acute_load != null) ? (
          <Card className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text variant="eyebrow">Training Status</Text>
              {statusInfo ? (
                <Badge
                  label={statusInfo.label}
                  tone={
                    ts.acwr_status === "OPTIMAL"
                      ? "success"
                      : ts.acwr_status === "HIGH"
                        ? "warm"
                        : "teal"
                  }
                />
              ) : null}
            </View>
            <View className="flex-row flex-wrap gap-3">
              <View className="min-w-[46%] flex-1 gap-0.5">
                <Text variant="micro" className="text-text-muted">
                  Status
                </Text>
                <Text variant="title" className={statusInfo?.cls ?? "text-text"}>
                  {statusInfo?.label ?? "—"}
                </Text>
                <Text variant="micro" className="capitalize">
                  {ts.sport?.toLowerCase() ?? ""}
                </Text>
              </View>
              <View className="min-w-[46%] flex-1 gap-0.5">
                <Text variant="micro" className="text-text-muted">
                  VO2 Max
                </Text>
                <Text variant="title" className="text-teal">
                  {ts.vo2max != null ? num(ts.vo2max).toFixed(1) : "—"}
                </Text>
                <Text variant="micro">ml/kg/min</Text>
              </View>
              <View className="min-w-[46%] flex-1 gap-0.5">
                <Text variant="micro" className="text-text-muted">
                  Training Load
                </Text>
                <Text variant="title" className="text-warm">
                  {ts.acute_load != null ? Math.round(num(ts.acute_load)) : "—"}
                </Text>
                <Text variant="micro">
                  {ts.chronic_load != null ? `Chronic ${Math.round(num(ts.chronic_load))}` : ""}
                </Text>
              </View>
              <View className="min-w-[46%] flex-1 gap-0.5">
                <Text variant="micro" className="text-text-muted">
                  ACWR
                </Text>
                <Text variant="title" className="text-lime">
                  {ts.acwr != null ? num(ts.acwr).toFixed(2) : "—"}
                </Text>
                <Text variant="micro" className="capitalize">
                  {ts.acwr_status?.toLowerCase() ?? ""}
                </Text>
              </View>
            </View>
          </Card>
        ) : null}

        {/* Monthly mileage bar chart (web parity) */}
        <RunningMileage mileage={trends?.mileage} />

        {/* Dedicated Pace Progression + VO2max Trend charts (web parity) */}
        <RunningPaceVo2Charts pace={trends?.pace} vo2max={trends?.vo2max} />

        {/* Recent route thumbnails (SVG shapes from /api/running/recent-routes) */}
        <RunningRoutes routes={routes} />

        {/* Route heatmap — all recent GPS paths overlaid (new /api/running/heatmap) */}
        <RunHeatmap routes={heatRoutes} />

        {/* Range governs the trend charts below (stats above are all-time). */}
        <View className="gap-1">
          <Text variant="eyebrow" className="text-text-muted">Trends — last {range}</Text>
          <SegmentedControl
            options={["90d", "1y", "2y"] as const}
            value={range}
            onChange={(v) => setRange(v as "90d" | "1y" | "2y")}
          />
        </View>

        {/* Training load/ACWR + cadence trends (new /api/running/trends) */}
        <RunningDeepTrends trends={runTrends} />

        {/* Endurance + hill fitness scores (new /api/running/fitness-scores) */}
        <RunningFitnessScores scores={fitScores} />

        {/* Per-km splits + fastest splits (new /api/running/splits) */}
        <RunningSplits data={splits} />

        {/* HR vs pace scatter (new /api/running/hr-pace) */}
        <RunningHrPace data={hrPace} />

        {/* Training Intensity Distribution (approximated with ProgressBars) */}
        {zones.length > 0 ? (
          <Card className="gap-3">
            <Text variant="eyebrow">Training Intensity Distribution</Text>
            {/* Single stacked 5-zone bar (web parity) */}
            {zoneTotal > 0 ? (
              <View className="gap-1">
                <View className="flex-row h-4 rounded-full overflow-hidden">
                  {zones.map((z, i) =>
                    num(z.count) > 0 ? (
                      <View key={`seg-${z.zone}`} style={{ width: `${(num(z.count) / zoneTotal) * 100}%`, backgroundColor: ZONE_HEX[i] ?? ZONE_HEX[0] }} />
                    ) : null,
                  )}
                </View>
                <View className="flex-row flex-wrap gap-x-3 gap-y-0.5">
                  {zones.map((z, i) => (
                    <View key={`lg-${z.zone}`} className="flex-row items-center gap-1">
                      <View className="h-2 w-2 rounded-full" style={{ backgroundColor: ZONE_HEX[i] ?? ZONE_HEX[0] }} />
                      <Text variant="micro" className="text-text-muted">{z.zone} {Math.round((num(z.count) / zoneTotal) * 100)}%</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            {zones.map((z, i) => {
              const pct = zoneTotal > 0 ? num(z.count) / zoneTotal : 0;
              return (
                <View key={z.zone} className="gap-1">
                  <View className="flex-row justify-between">
                    <Text variant="caption" className="text-text-secondary">
                      {z.zone}
                    </Text>
                    <Text variant="caption" className="tabular-nums text-text">
                      {num(z.count)} · {Math.round(pct * 100)}%
                    </Text>
                  </View>
                  <ProgressBar pct={pct} color={ZONE_HEX[i] ?? ZONE_HEX[0]} />
                  <Text variant="micro">
                    avg {z.avg_km != null ? `${num(z.avg_km).toFixed(1)} km` : "—"} ·{" "}
                    {z.avg_duration != null ? `${Math.round(num(z.avg_duration))}m` : "—"}
                  </Text>
                </View>
              );
            })}
          </Card>
        ) : null}

        {/* Personal Records */}
        {records ? (
          <Card className="gap-3">
            <Text variant="eyebrow">Personal Records</Text>
            <View className="flex-row flex-wrap gap-3">
              {records.fastest5k ? (
                <View className="min-w-[46%] flex-1 gap-0.5">
                  <Text variant="micro" className="text-text-muted">
                    Est. 5K Time
                  </Text>
                  <Text variant="title" className="text-success">
                    {formatSeconds(records.fastest5k.est_5k_seconds)}
                  </Text>
                  <Text variant="micro">
                    {formatPace(records.fastest5k.pace)}/km · {shortDate(records.fastest5k.date)}
                  </Text>
                </View>
              ) : null}
              {records.fastest10k ? (
                <View className="min-w-[46%] flex-1 gap-0.5">
                  <Text variant="micro" className="text-text-muted">
                    Est. 10K Time
                  </Text>
                  <Text variant="title" className="text-teal">
                    {formatSeconds(records.fastest10k.est_10k_seconds)}
                  </Text>
                  <Text variant="micro">
                    {formatPace(records.fastest10k.pace)}/km · {shortDate(records.fastest10k.date)}
                  </Text>
                </View>
              ) : null}
              {records.fastestPace ? (
                <View className="min-w-[46%] flex-1 gap-0.5">
                  <Text variant="micro" className="text-text-muted">
                    Best Avg Pace
                  </Text>
                  <Text variant="title" className="text-warning">
                    {formatPace(records.fastestPace.pace)}/km
                  </Text>
                  <Text variant="micro">
                    {records.fastestPace.distance != null
                      ? `${num(records.fastestPace.distance).toFixed(1)} km`
                      : "—"}{" "}
                    · {shortDate(records.fastestPace.date)}
                  </Text>
                </View>
              ) : null}
              {records.longest ? (
                <View className="min-w-[46%] flex-1 gap-0.5">
                  <Text variant="micro" className="text-text-muted">
                    Longest Run
                  </Text>
                  <Text variant="title" className="text-text">
                    {records.longest.distance != null
                      ? `${num(records.longest.distance).toFixed(1)} km`
                      : "—"}
                  </Text>
                  <Text variant="micro">
                    {records.longest.duration_min != null
                      ? `${Math.round(num(records.longest.duration_min))} min`
                      : "—"}{" "}
                    · {shortDate(records.longest.date)}
                  </Text>
                </View>
              ) : null}
              {records.maxHR ? (
                <View className="min-w-[46%] flex-1 gap-0.5">
                  <Text variant="micro" className="text-text-muted">
                    Max Heart Rate
                  </Text>
                  <Text variant="title" className="text-danger">
                    {records.maxHR.max_hr != null ? `${Math.round(num(records.maxHR.max_hr))} bpm` : "—"}
                  </Text>
                  <Text variant="micro">
                    {records.maxHR.avg_hr != null
                      ? `Avg ${Math.round(num(records.maxHR.avg_hr))} bpm`
                      : "—"}{" "}
                    · {shortDate(records.maxHR.date)}
                  </Text>
                </View>
              ) : null}
              {records.maxCal ? (
                <View className="min-w-[46%] flex-1 gap-0.5">
                  <Text variant="micro" className="text-text-muted">
                    Most Calories
                  </Text>
                  <Text variant="title" className="text-warm">
                    {records.maxCal.calories != null
                      ? `${Math.round(num(records.maxCal.calories))} kcal`
                      : "—"}
                  </Text>
                  <Text variant="micro">
                    {records.maxCal.distance != null
                      ? `${num(records.maxCal.distance).toFixed(1)} km`
                      : "—"}{" "}
                    · {shortDate(records.maxCal.date)}
                  </Text>
                </View>
              ) : null}
            </View>
          </Card>
        ) : null}

        {/* Shoe Mileage */}
        {shoes.length > 0 ? (
          <Card className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text variant="eyebrow">Shoe Mileage</Text>
              <Text variant="micro" className="tabular-nums">
                {shoes.length} {shoes.length === 1 ? "pair" : "pairs"}
              </Text>
            </View>
            {shoes.map((shoe) => {
              const totalKm = num(shoe.total_km);
              const maxKm = shoe.max_km != null ? num(shoe.max_km) : null;
              const worn = maxKm ? totalKm / maxKm : 0;
              const active = shoe.status === "active";
              const barColor = worn > 0.8 ? "#e06060" : worn > 0.6 ? "#e0c458" : "#6ad4a0";
              return (
                <View key={shoe.gear_pk} className="gap-1">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                      <Text
                        variant="body"
                        className={active ? "text-text" : "text-text-muted line-through"}
                      >
                        {shoe.shoe_name}
                      </Text>
                      {!active ? <Badge label="Retired" tone="neutral" /> : null}
                      {active && maxKm && worn >= 1 ? <Badge label="Replace" tone="danger" /> : null}
                    </View>
                    <Text variant="micro" className="tabular-nums">
                      {num(shoe.runs)} runs · {totalKm.toFixed(0)} km
                    </Text>
                  </View>
                  {maxKm ? <ProgressBar pct={Math.min(worn, 1)} color={barColor} /> : null}
                  <View className="flex-row items-center justify-between">
                    <Text variant="micro">
                      {maxKm
                        ? `${totalKm.toFixed(0)} / ${maxKm.toFixed(0)} km (${Math.round(worn * 100)}%)`
                        : `${totalKm.toFixed(0)} km total`}
                    </Text>
                    {maxKm ? (
                      <Text variant="micro" className={worn >= 1 ? "text-danger" : "text-text-muted"}>
                        {worn >= 1
                          ? `${(totalKm - maxKm).toFixed(0)} km over`
                          : `${(maxKm - totalKm).toFixed(0)} km remaining`}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </Card>
        ) : null}

        {/* Recent Runs — sortable, tap-to-detail table (web parity) */}
        <RunTable runs={recent} />
      </View>

      <StatDetailModal stat={statDetail} onClose={() => setStatDetail(null)} />
    </ScrollView>
  );
}