import { useEffect, useState } from "react";
import { ScrollView, View, RefreshControl, Pressable } from "react-native";
import { Text, Card, Badge, ProgressBar, SegmentedControl, Sparkline } from "soma-style";
import { StatDetailModal, type StatDetail } from "../../components/stat-detail-modal";
import { LineChart, ChartLegend } from "../../components/line-chart";
import { fetchJson, usePullRefresh, useSleepSummary, useRecoverySummary, useRespiratory, useSleepSchedule, useWeekdayWeekend } from "../../lib/api";
import { SleepDashboard } from "../../components/sleep-dashboard";
import { RecoveryVitals } from "../../components/recovery-vitals";
import { SleepRespiratory } from "../../components/sleep-respiratory";
import { SleepRegularity } from "../../components/sleep-regularity";
import { SleepWeekdayWeekend } from "../../components/sleep-weekday-weekend";

/** Value series from a StatSeries.current, dropping nulls (for sparklines). */
const seriesVals = (pts?: { value: number | null }[]) =>
  (pts ?? []).map((p) => Number(p.value)).filter((v) => isFinite(v));
const series2Vals = (pts?: { value2?: number | null }[]) =>
  (pts ?? []).map((p) => Number(p.value2)).filter((v) => isFinite(v));
const chartLabel = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][(m ?? 1) - 1]} ${d}`;
};
const finiteOrNull = (v: number | null | undefined): number | null => (v != null && isFinite(Number(v)) ? Number(v) : null);

/** One point on a metric series from /api/stats/[metric]. */
interface StatPoint {
  date: string;
  value: number | null;
  value2?: number | null;
}
interface StatSeries {
  current: StatPoint[];
  previous: StatPoint[];
  summary: {
    current_avg: number | null;
    current_min: number | null;
    current_max: number | null;
    previous_avg: number | null;
  };
}

type Range = "7d" | "30d" | "90d";
const RANGES: readonly Range[] = ["7d", "30d", "90d"] as const;

/**
 * Sleep & Recovery data, fetched from soma's /api/stats/[metric] endpoints.
 * The web page reads the DB directly; the RN app has no DB, so it uses the
 * public stats API which serves the same daily_health_summary rows.
 */
function useSleepRecovery(range: Range) {
  const [sleep, setSleep] = useState<StatSeries | null>(null);
  const [rhr, setRhr] = useState<StatSeries | null>(null);
  const [stress, setStress] = useState<StatSeries | null>(null);
  const [battery, setBattery] = useState<StatSeries | null>(null);
  const [recovery, setRecovery] = useState<StatSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const get = (m: string) => fetchJson<StatSeries>(`/api/stats/${m}?range=${range}`);

    Promise.all([
      get("sleep"),
      get("rhr"),
      get("stress"),
      get("body_battery"),
      get("recovery"),
    ])
      .then(([s, h, st, bb, rc]: StatSeries[]) => {
        if (!alive) return;
        setSleep(s);
        setRhr(h);
        setStress(st);
        setBattery(bb);
        setRecovery(rc);
        setError(null);
      })
      .catch((e) => alive && setError(String(e.message ?? e)))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [range, reload]);

  return { sleep, rhr, stress, battery, recovery, loading, error, refetch: () => setReload((n) => n + 1) };
}

const fmt1 = (v: number | null | undefined, unit = "") =>
  v == null ? "—" : `${v.toFixed(1)}${unit}`;
const fmt0 = (v: number | null | undefined, unit = "") =>
  v == null ? "—" : `${Math.round(v)}${unit}`;

/** Last value in a series (most recent day). */
function last(series: StatSeries | null): StatPoint | null {
  const arr = series?.current;
  return arr && arr.length ? arr[arr.length - 1] : null;
}

/** Trend delta vs the previous window (current_avg − previous_avg). */
function delta(series: StatSeries | null): number | null {
  const s = series?.summary;
  if (!s || s.current_avg == null || s.previous_avg == null) return null;
  return s.current_avg - s.previous_avg;
}

export default function SleepScreen() {
  const [range, setRange] = useState<Range>("30d");
  const [statDetail, setStatDetail] = useState<StatDetail | null>(null);
  const { sleep, rhr, stress, battery, recovery, loading, error, refetch } =
    useSleepRecovery(range);
  const { data: sleepSum } = useSleepSummary(range);
  const { data: recoveryVitals } = useRecoverySummary(range);
  const { data: respiratory } = useRespiratory(range);
  const { data: schedule } = useSleepSchedule(range);
  const { data: weekdayWeekend } = useWeekdayWeekend(range);
  const { refreshing, onRefresh } = usePullRefresh(refetch);

  const lastSleep = last(sleep);
  const nights = sleep?.current.length ?? 0;

  // Sleep score isn't served by the stats API; recovery.value2 carries HRV weekly avg.
  const lastRecovery = last(recovery);
  // HRV comes from /api/recovery/summary (same source as the RecoveryVitals card
  // below) — /api/stats/recovery.value2 is null here, which rendered the top card
  // as "—" while the card right beneath it showed 64ms. Wire both to one source.
  const hrvLatest = recoveryVitals?.hrv?.latest ?? null;
  const hrvTrend = (recoveryVitals?.hrv?.trend ?? [])
    .map((p) => p.weekly_avg)
    .filter((v): v is number => v != null);
  const lastRhr = last(rhr);
  const lastStress = last(stress);
  const lastBattery = last(battery);

  const sleepDelta = delta(sleep);
  const rhrDelta = delta(rhr);

  // Sparse bar visualisation of the sleep-hours series (approximates the web chart).
  const sleepBars = (sleep?.current ?? []).slice(-14);
  const maxHours = Math.max(9, ...sleepBars.map((p) => p.value ?? 0));

  const summaryCards: {
    label: string;
    value: string;
    sub: string;
    cls: string;
    spark?: { data: number[]; color: string };
    unit?: string;
  }[] = [
    {
      label: "Avg Sleep",
      value: fmt1(sleep?.summary.current_avg, "h"),
      sub: `${fmt1(sleep?.summary.current_min, "h")}–${fmt1(sleep?.summary.current_max, "h")}`,
      cls: "text-indigo",
      spark: { data: seriesVals(sleep?.current), color: "#6366b0" },
      unit: "h",
    },
    {
      label: "Last Night",
      value: fmt1(lastSleep?.value, "h"),
      sub: lastSleep?.date ?? "no data",
      cls: "text-teal",
    },
    {
      label: "Resting HR",
      value: fmt0(rhr?.summary.current_avg, " bpm"),
      sub:
        rhrDelta == null
          ? "avg"
          : `${rhrDelta >= 0 ? "+" : ""}${rhrDelta.toFixed(1)} vs prev`,
      cls: "text-danger",
      spark: { data: seriesVals(rhr?.current), color: "#e06060" },
      unit: "bpm",
    },
    {
      label: "HRV (weekly)",
      value: fmt0(hrvLatest?.weekly_avg, " ms"),
      sub: hrvLatest?.last_night_avg != null ? `last night ${hrvLatest.last_night_avg} ms` : "weekly avg",
      cls: "text-lime",
      spark: { data: hrvTrend, color: "#cbe896" },
      unit: "ms",
    },
  ];

  return (
    <ScrollView
      className="flex-1 bg-base"
      contentContainerClassName="items-center px-5 py-6"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#77c8d1" colors={["#77c8d1"]} />}
    >
      <View className="w-full max-w-2xl gap-4">
        <View className="flex-row items-center gap-2">
          <Text variant="headline">Sleep & Recovery</Text>
          {nights > 0 ? (
            <Badge label={`${nights} nights logged`} tone="teal" />
          ) : null}
        </View>

        <SegmentedControl
          options={RANGES}
          value={range}
          onChange={(v) => setRange(v as Range)}
        />

        {error ? (
          <Card>
            <Text variant="body" className="text-danger">
              API: {error} — is soma running on :3456?
            </Text>
          </Card>
        ) : null}

        {loading && !sleep ? (
          <Card>
            <Text variant="body" className="text-text-secondary">
              Loading…
            </Text>
          </Card>
        ) : null}

        {/* Summary stat cards */}
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
                      <Sparkline data={s.spark.data} color={s.spark.color} height={26} baseline />
                    </View>
                  ) : null}
                </Card>
              </Pressable>
            );
          })}
        </View>

        {/* Recovery trend charts — Stress (avg+peak), Body Battery, Readiness */}
        {(stress?.current?.length ?? 0) >= 2 ? (
          <Card className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text variant="eyebrow">Stress</Text>
              <Text variant="micro" className="text-text-muted">avg + peak</Text>
            </View>
            <LineChart
              height={140}
              labels={stress!.current.map((p) => chartLabel(p.date))}
              yFormat={(v) => String(Math.round(v))}
              refLine={{ y: 50, color: "#e0a458" }}
              series={[
                { values: stress!.current.map((p) => finiteOrNull(p.value2)), color: "#e06060", dashed: true, width: 1.5 },
                { values: stress!.current.map((p) => finiteOrNull(p.value)), color: "#e0a458", width: 2.2 },
              ]}
            />
            <ChartLegend items={[{ color: "#e0a458", label: "Avg" }, { color: "#e06060", label: "Peak", dashed: true }]} />
          </Card>
        ) : null}

        {(battery?.current?.length ?? 0) >= 2 ? (
          <Card className="gap-2">
            <Text variant="eyebrow">Body Battery</Text>
            <LineChart
              height={130}
              labels={battery!.current.map((p) => chartLabel(p.date))}
              yFormat={(v) => String(Math.round(v))}
              yMin={0}
              yMax={100}
              series={[{ values: battery!.current.map((p) => finiteOrNull(p.value)), color: "#cbe896", width: 2.2 }]}
            />
          </Card>
        ) : null}

        {(recovery?.current?.length ?? 0) >= 2 ? (
          <Card className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text variant="eyebrow">Training readiness</Text>
              <Text variant="micro" className="text-text-muted">30 days</Text>
            </View>
            <LineChart
              height={130}
              labels={recovery!.current.map((p) => chartLabel(p.date))}
              yFormat={(v) => String(Math.round(v))}
              refLine={{ y: 50, color: "#3a5563" }}
              series={[{ values: recovery!.current.map((p) => finiteOrNull(p.value)), color: "#6ad4a0", width: 2.2 }]}
            />
          </Card>
        ) : null}

        {/* Sleep dashboard — last night + stages + score (new /api/sleep/summary) */}
        <SleepDashboard summary={sleepSum} />

        {/* Recovery vitals — HRV + training readiness (new /api/recovery/summary) */}
        <RecoveryVitals summary={recoveryVitals} />

        {/* Blood oxygen + respiration (new /api/sleep/respiratory) */}
        <SleepRespiratory data={respiratory} />

        {/* Sleep regularity — bedtime/wake consistency (new /api/sleep/schedule) */}
        <SleepRegularity data={schedule} />

        {/* Weekday vs weekend comparison (new /api/sleep/weekday-weekend) */}
        <SleepWeekdayWeekend data={weekdayWeekend} />

        {/* Sleep duration trend (bar approximation) */}
        <Card className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Sleep duration</Text>
            {sleepDelta != null ? (
              <Text
                variant="caption"
                className={`tabular-nums ${sleepDelta >= 0 ? "text-success" : "text-warning"}`}
              >
                {sleepDelta >= 0 ? "+" : ""}
                {sleepDelta.toFixed(1)}h vs prev
              </Text>
            ) : null}
          </View>
          {sleepBars.length ? (
            sleepBars.map((p) => (
              <View key={p.date} className="gap-1">
                <View className="flex-row justify-between">
                  <Text variant="micro" className="text-text-muted">
                    {p.date.slice(5)}
                  </Text>
                  <Text variant="micro" className="tabular-nums text-text">
                    {fmt1(p.value, "h")}
                  </Text>
                </View>
                <ProgressBar
                  pct={(p.value ?? 0) / maxHours}
                  color={(p.value ?? 0) >= 7 ? "#6ad4a0" : "#e0a458"}
                />
              </View>
            ))
          ) : (
            <Text variant="micro">No sleep data in this range.</Text>
          )}
          <Text variant="micro">
            Green ≥ 7h · amber below target. Showing last{" "}
            {sleepBars.length} nights.
          </Text>
        </Card>

        {/* Recovery signals */}
        <Card className="gap-2">
          <Text variant="eyebrow">Recovery signals</Text>
          {(
            [
              [
                "Resting HR",
                fmt0(lastRhr?.value, " bpm"),
                rhr?.summary.current_avg,
              ],
              [
                "Stress (latest)",
                fmt0(lastStress?.value),
                stress?.summary.current_avg,
              ],
              [
                "Peak stress (latest)",
                fmt0(lastStress?.value2),
                stress?.summary.current_max,
              ],
              [
                "Body Battery charged",
                fmt0(lastBattery?.value),
                battery?.summary.current_avg,
              ],
              [
                "Body Battery drained",
                fmt0(lastBattery?.value2),
                null,
              ],
              [
                "Body Battery max",
                fmt0(lastRecovery?.value),
                recovery?.summary.current_avg,
              ],
            ] as const
          ).map(([label, val, avg]) => (
            <View
              key={label}
              className="flex-row items-center justify-between border-b border-border-subtle py-2"
            >
              <Text variant="body" className="text-text-secondary">
                {label}
              </Text>
              <View className="items-end">
                <Text variant="body" className="tabular-nums text-text">
                  {val}
                </Text>
                {avg != null ? (
                  <Text variant="micro" className="tabular-nums text-text-muted">
                    avg {avg.toFixed(0)}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </Card>

        {/* Stress vs body-battery quick read */}
        <View className="flex-row gap-3">
          <Card className="flex-1 gap-1">
            <Text variant="eyebrow">Stress avg</Text>
            <Text variant="headline" className="text-warning">
              {fmt0(stress?.summary.current_avg)}
            </Text>
            <Text variant="micro">peak {fmt0(stress?.summary.current_max)}</Text>
          </Card>
          <Card className="flex-1 gap-1">
            <Text variant="eyebrow">Battery avg</Text>
            <Text variant="headline" className="text-lime">
              {fmt0(battery?.summary.current_avg)}
            </Text>
            <Text variant="micro">charged / day</Text>
          </Card>
        </View>
      </View>

      <StatDetailModal stat={statDetail} onClose={() => setStatDetail(null)} />
    </ScrollView>
  );
}