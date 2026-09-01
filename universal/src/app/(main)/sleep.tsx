import { useEffect, useState } from "react";
import { ScrollView, View, RefreshControl, Pressable } from "react-native";
import { Text, Card, Badge, Sparkline } from "soma-style";
import { TimeRangeSelector } from "../../components/time-range-selector";
import { useRangePref, statsRange } from "../../lib/time-range";
import { StatDetailModal, type StatDetail } from "../../components/stat-detail-modal";
import { LineChart, ChartLegend } from "../../components/line-chart";
import { fetchJson, usePullRefresh, useSleepSummary, useRecoverySummary, useRespiratory, useSleepSchedule, useWeekdayWeekend } from "../../lib/api";
import { SleepDashboard } from "../../components/sleep-dashboard";
import { RecoveryVitals } from "../../components/recovery-vitals";
import { SleepRespiratory } from "../../components/sleep-respiratory";
import { SleepRegularity } from "../../components/sleep-regularity";
import { SleepWeekdayWeekend } from "../../components/sleep-weekday-weekend";
import { SleepScheduleChart } from "../../components/sleep-schedule-chart";

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


/**
 * Sleep & Recovery data, fetched from soma's /api/stats/[metric] endpoints.
 * The web page reads the DB directly; the RN app has no DB, so it uses the
 * public stats API which serves the same daily_health_summary rows.
 */
function useSleepRecovery(range: string) {
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
    // /api/stats/* only accepts 7d/30d/90d/1y — clamp the shared range to it.
    const get = (m: string) => fetchJson<StatSeries>(`/api/stats/${m}?range=${statsRange(range)}`);

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
  const [range, setRange] = useRangePref();
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

  const summaryCards: {
    label: string;
    value: string;
    sub: string;
    cls: string;
    spark?: { data: number[]; color: string };
    unit?: string;
    metric?: string;
  }[] = [
    {
      label: "Avg Sleep",
      value: fmt1(sleep?.summary.current_avg, "h"),
      sub: `${fmt1(sleep?.summary.current_min, "h")}–${fmt1(sleep?.summary.current_max, "h")}`,
      cls: "text-indigo",
      spark: { data: seriesVals(sleep?.current), color: "#6366b0" },
      unit: "h",
      metric: "sleep",
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
      metric: "rhr",
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

  // Range-average headline stats sourced from /api/sleep/summary (parity with
  // the web stat row: Avg Score / Avg Deep % / Avg Sleep HR).
  const st = sleepSum?.stats;
  const scoreSeries = (sleepSum?.trend ?? []).map((n) => n.score).filter((v): v is number => v != null);
  const deepPctSeries = (sleepSum?.trend ?? [])
    .map((n) => (n.total && n.total > 0 && n.deep != null ? (n.deep / n.total) * 100 : null))
    .filter((v): v is number => v != null);
  const sleepHrSeries = (sleepSum?.trend ?? []).map((n) => n.hr).filter((v): v is number => v != null);
  const extraCards: typeof summaryCards = st
    ? [
        {
          label: "Avg Score",
          value: fmt0(st.avg_score),
          sub: "out of 100",
          cls: "text-indigo",
          spark: scoreSeries.length >= 2 ? { data: scoreSeries, color: "#a5b4fc" } : undefined,
        },
        {
          label: "Avg Deep",
          value: fmt0(st.avg_deep_pct, "%"),
          sub: st.avg_rem_pct != null ? `REM ${Math.round(st.avg_rem_pct)}%` : "of sleep",
          cls: "text-teal",
          spark: deepPctSeries.length >= 2 ? { data: deepPctSeries, color: "#c084fc" } : undefined,
          unit: "%",
        },
        {
          label: "Avg Sleep HR",
          value: fmt0(st.avg_sleep_hr, " bpm"),
          sub: st.avg_spo2 != null ? `SpO₂ ${Math.round(st.avg_spo2)}%` : "during sleep",
          cls: "text-danger",
          spark: sleepHrSeries.length >= 2 ? { data: sleepHrSeries, color: "#e06060" } : undefined,
          unit: "bpm",
        },
      ]
    : [];
  const allCards = [...summaryCards, ...extraCards];

  // Sleep-duration-per-night series for the full-chart upgrade (was a bar list).
  const durSeries = (sleep?.current ?? []).map((p) => finiteOrNull(p.value));
  const durLabels = (sleep?.current ?? []).map((p) => chartLabel(p.date));
  const durVals = durSeries.filter((v): v is number => v != null);

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

        <TimeRangeSelector value={range} onChange={setRange} />

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
          {allCards.map((s) => {
            const tappable = !!(s.spark && s.spark.data.length >= 2);
            return (
              <Pressable
                key={s.label}
                className="min-w-[46%] flex-1"
                disabled={!tappable}
                onPress={() => s.spark && setStatDetail({ label: s.label, value: s.value, sub: s.sub, spark: s.spark.data, color: s.spark.color, unit: s.unit, metric: s.metric })}
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
              interactive
              labels={stress!.current.map((p) => chartLabel(p.date))}
              xTicks={4}
              yMin={0}
              yMax={100}
              yFormat={(v) => String(Math.round(v))}
              refLines={[
                { y: 25, color: "#6ad4a0" },
                { y: 50, color: "#e0c458" },
                { y: 75, color: "#e06060" },
              ]}
              series={[
                { values: stress!.current.map((p) => finiteOrNull(p.value2)), color: "#e06060", dashed: true, width: 1.5, label: "Peak" },
                { values: stress!.current.map((p) => finiteOrNull(p.value)), color: "#e0a458", width: 2.2, label: "Avg" },
              ]}
            />
            <ChartLegend items={[{ color: "#e0a458", label: "Avg" }, { color: "#e06060", label: "Peak", dashed: true }, { color: "#6ad4a0", label: "low/med/high 25·50·75", dashed: true }]} />
          </Card>
        ) : null}

        {(battery?.current?.length ?? 0) >= 2 ? (
          <Card className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text variant="eyebrow">Body Battery</Text>
              <Text variant="micro" className="text-text-muted">charged + drained</Text>
            </View>
            <LineChart
              height={130}
              interactive
              labels={battery!.current.map((p) => chartLabel(p.date))}
              xTicks={4}
              yFormat={(v) => String(Math.round(v))}
              yMin={0}
              series={[
                { values: battery!.current.map((p) => finiteOrNull(p.value2)), color: "#e06060", width: 1.5, dashed: true, label: "Drained" },
                { values: battery!.current.map((p) => finiteOrNull(p.value)), color: "#cbe896", width: 2.2, label: "Charged" },
              ]}
            />
            <ChartLegend items={[{ color: "#cbe896", label: "Charged" }, { color: "#e06060", label: "Drained", dashed: true }]} />
          </Card>
        ) : null}

        {(recoveryVitals?.readiness?.trend?.length ?? 0) >= 2 ? (
          <Card className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text variant="eyebrow">Training readiness</Text>
              <Text variant="micro" className="text-text-muted">score · 30 days</Text>
            </View>
            <LineChart
              height={130}
              labels={recoveryVitals!.readiness.trend.map((p) => chartLabel(p.date))}
              yFormat={(v) => String(Math.round(v))}
              refLine={{ y: 50, color: "#3a5563" }}
              series={[{ values: recoveryVitals!.readiness.trend.map((p) => finiteOrNull(p.score)), color: "#6ad4a0", width: 2.2 }]}
            />
          </Card>
        ) : null}

        {/* Sleep dashboard — last night + stages + score (new /api/sleep/summary) */}
        <SleepDashboard summary={sleepSum} />

        {/* Recovery vitals — HRV + training readiness (new /api/recovery/summary) */}
        <RecoveryVitals summary={recoveryVitals} />

        {/* Blood oxygen + respiration (new /api/sleep/respiratory) */}
        <SleepRespiratory data={respiratory} />

        {/* Sleep schedule — per-night bedtime → wake band (new /api/sleep/schedule) */}
        <SleepScheduleChart schedule={schedule?.schedule} />

        {/* Sleep regularity — bedtime/wake consistency (new /api/sleep/schedule) */}
        <SleepRegularity data={schedule} />

        {/* Weekday vs weekend comparison (new /api/sleep/weekday-weekend) */}
        <SleepWeekdayWeekend data={weekdayWeekend} />

        {/* Sleep duration trend — full chart with 7h target line, tap to expand */}
        <Pressable
          disabled={durVals.length < 2}
          onPress={() =>
            durVals.length >= 2 &&
            setStatDetail({
              label: "Sleep duration",
              value: fmt1(sleep?.summary.current_avg, "h"),
              sub: `avg · last ${durVals.length} nights`,
              spark: durVals,
              color: "#6ad4a0",
              unit: "h",
            })
          }
        >
          <Card className="gap-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-1.5">
                <Text variant="eyebrow">Sleep duration</Text>
                {durVals.length >= 2 ? <Text variant="micro" className="text-text-muted">›</Text> : null}
              </View>
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
            {durVals.length >= 2 ? (
              <LineChart
                height={140}
                labels={durLabels}
                yFormat={(v) => `${v.toFixed(1)}h`}
                refLine={{ y: 7, color: "#6ad4a0" }}
                series={[{ values: durSeries, color: "#8b9df0", width: 2.2 }]}
              />
            ) : (
              <Text variant="micro">No sleep data in this range.</Text>
            )}
            <Text variant="micro">
              Dashed line = 7h target. Showing last {durVals.length} nights.
            </Text>
          </Card>
        </Pressable>

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