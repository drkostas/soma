import { useEffect, useState } from "react";
import { View } from "react-native";
import { Text, Modal, SegmentedControl } from "soma-style";
import { LineChart, ChartLegend, chartDateLabel } from "./line-chart";
import { fetchJson } from "../lib/api";

export interface StatDetail {
  label: string;
  value: string;
  sub: string;
  spark?: number[];
  color: string;
  /** Optional unit suffix for the axis labels (e.g. "bpm", "kcal"). */
  unit?: string;
  /** If set, the modal fetches /api/stats/[metric] for a range toggle + previous-period overlay. */
  metric?: string;
  /** Web's stat-card tooltip text, shown under the value (soma#758). */
  info?: string;
  /** Pre-supplied dated timeline (e.g. per-workout duration/calories); renders a dated chart with tap-to-read. */
  timeline?: { date: string; value: number; label?: string }[];
  /** How to draw the timeline: connected line (cumulative/monthly) or scatter dots (per-workout). */
  timelineMode?: "line" | "dots";
  /** Plural noun for the timeline point count in the eyebrow (default "workouts"). */
  timelineNoun?: string;
}

interface StatPoint { date: string; value: number | null; value2?: number | null }

/** Metrics whose endpoint returns a second series (value2): label pair + color. */
const TWO_SERIES: Record<string, { primary: string; secondary: string; color: string }> = {
  calories: { primary: "Active", secondary: "BMR", color: "#e0a458" },
  stress: { primary: "Avg", secondary: "Max", color: "#e06060" },
};
interface StatSeries {
  current: StatPoint[];
  previous: StatPoint[];
  summary: { current_avg: number | null; current_min: number | null; current_max: number | null; previous_avg: number | null };
}
type Range = "7d" | "30d" | "90d" | "1y";
type RefLine = { y: number; color?: string; dashed?: boolean; label?: string };
/** Web's stat dialogs draw goal / threshold / average reference lines; mirror them
 *  per metric (soma#756): 10K steps goal, stress low/med/high, BMR on calories,
 *  7h/9h on sleep, otherwise the period average. */
function refLinesFor(metric: string | undefined, avg: number | null | undefined, secondaryAvg: number | null): RefLine[] {
  switch (metric) {
    case "steps": return [{ y: 10000, color: "#77c8d1", label: "10K goal" }];
    case "stress": return [{ y: 25, color: "#6ad4a0", label: "low" }, { y: 50, color: "#e0c458", label: "med" }, { y: 75, color: "#e06060", label: "high" }];
    case "calories": return secondaryAvg != null && isFinite(secondaryAvg) ? [{ y: secondaryAvg, color: "#e0a458", label: `BMR ~${Math.round(secondaryAvg)}` }] : [];
    case "sleep": return [{ y: 7, color: "#77c8d1", label: "7h min" }, { y: 9, color: "#6ad4a0", label: "9h target" }];
    default: return avg != null && isFinite(avg) ? [{ y: avg, color: "#5a7a8a", label: `avg ${Math.round(avg).toLocaleString()}` }] : [];
  }
}
const mean = (xs: (number | null)[]): number | null => { const v = xs.filter((x): x is number => x != null && isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const RANGES: readonly Range[] = ["7d", "30d", "90d", "1y"] as const;

/** Detail dialog for a stat card. With `metric`, fetches the real trend for a
 *  chosen range with a dashed previous-period overlay, tap-to-read, and
 *  avg/min/max + Δ-vs-previous; otherwise shows the card's sparkline trend. */
export function StatDetailModal({ stat, onClose }: { stat: StatDetail | null; onClose: () => void }) {
  const [range, setRange] = useState<Range>("30d");
  // The series is tagged with the metric and range it answers (no setState in the effect body).
  const [fetched, setFetched] = useState<{ key: string; series: StatSeries | null } | null>(null);
  const key = stat?.metric ? `${stat.metric}|${range}` : null;
  const metric = stat?.metric ?? null;
  const data = key != null && fetched?.key === key ? fetched.series : null;
  const loading = key != null && fetched?.key !== key;

  useEffect(() => {
    if (!key || !metric) return;
    let alive = true;
    fetchJson<StatSeries>(`/api/stats/${metric}?range=${range}`)
      .then((d) => alive && setFetched({ key, series: d }))
      .catch(() => alive && setFetched({ key, series: null }));
    return () => { alive = false; };
  }, [key, metric, range]);

  if (!stat) return null;
  const unit = stat.unit ? ` ${stat.unit}` : "";
  const fmt = (v: number | null) => (v == null ? "–" : `${Math.round(v).toLocaleString()}${unit}`);

  // Timeline path: pre-supplied dated points (per-workout duration/calories,
  // cumulative count, workouts/month) — matches the web ClickableSummaryStats modal.
  if (stat.timeline) {
    const pts = stat.timeline.filter((p) => isFinite(p.value));
    const vals = pts.map((p) => p.value);
    const labels = pts.map((p) => chartDateLabel(p.date));
    const min = vals.length ? Math.min(...vals) : null;
    const max = vals.length ? Math.max(...vals) : null;
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const dots = stat.timelineMode === "dots";
    return (
      <Modal visible={!!stat} onClose={onClose} title={stat.label}>
        <View className="gap-3">
          <View className="flex-row items-end gap-2">
            <Text variant="display" className="tabular-nums" style={{ color: stat.color }}>{stat.value}</Text>
            <Text variant="body" className="mb-1 text-text-muted">{stat.sub}</Text>
          </View>
          {stat.info ? <Text variant="caption" className="text-text-secondary">{stat.info}</Text> : null}
          {pts.length >= 2 ? (
            <View className="gap-1">
              <Text variant="eyebrow" className="text-text-muted">{pts.length} {stat.timelineNoun ?? "workouts"}</Text>
              <LineChart
                height={170}
                interactive
                labels={labels}
                xTicks={4}
                yFormat={(v) => `${Math.round(v).toLocaleString()}`}
                refLine={avg != null ? { y: avg, color: "#5a7a8a", label: "avg" } : undefined}
                series={dots
                  ? [{ values: vals, color: stat.color, mode: "dots" as const, width: 3 }]
                  : [{ values: vals, color: stat.color, width: 2.2 }]}
              />
              <View className="mt-1 flex-row justify-between">
                <Text variant="micro" className="text-text-muted tabular-nums">min {fmt(min)}</Text>
                <Text variant="micro" className="text-text-muted tabular-nums">avg {fmt(avg)}</Text>
                <Text variant="micro" className="text-text-muted tabular-nums">max {fmt(max)}</Text>
              </View>
            </View>
          ) : (
            <Text variant="caption" className="text-text-muted">No timeline data yet.</Text>
          )}
        </View>
      </Modal>
    );
  }

  // Rich path: real endpoint with range + previous overlay
  if (stat.metric) {
    const cur = (data?.current ?? []).map((p) => (p.value != null && isFinite(p.value) ? p.value : null));
    const prev = (data?.previous ?? []).map((p) => (p.value != null && isFinite(p.value) ? p.value : null));
    const cur2 = (data?.current ?? []).map((p) => (p.value2 != null && isFinite(Number(p.value2)) ? Number(p.value2) : null));
    const two = stat.metric ? TWO_SERIES[stat.metric] : undefined;
    const hasTwo = !!two && cur2.filter((v) => v != null).length >= 2;
    const labels = (data?.current ?? []).map((p) => chartDateLabel(p.date));
    const sm = data?.summary;
    const delta = sm?.current_avg != null && sm?.previous_avg != null ? sm.current_avg - sm.previous_avg : null;
    return (
      <Modal visible={!!stat} onClose={onClose} title={stat.label}>
        <View className="gap-3">
          <View className="flex-row items-end gap-2">
            <Text variant="display" className="tabular-nums" style={{ color: stat.color }}>{stat.value}</Text>
            <Text variant="body" className="mb-1 text-text-muted">{stat.sub}</Text>
          </View>
          {stat.info ? <Text variant="caption" className="text-text-secondary">{stat.info}</Text> : null}
          <SegmentedControl options={RANGES} value={range} onChange={(v) => setRange(v as Range)} />
          {loading && !data ? (
            <Text variant="body" className="text-text-muted">Loading…</Text>
          ) : cur.filter((v) => v != null).length >= 2 ? (
            <View className="gap-1">
              <LineChart
                height={170}
                interactive
                labels={labels}
                xTicks={4}
                yFormat={(v) => `${Math.round(v).toLocaleString()}`}
                refLines={refLinesFor(stat.metric, sm?.current_avg, hasTwo ? mean(cur2) : null)}
                series={hasTwo ? [
                  { values: cur, color: stat.color, width: 2.2, label: two!.primary },
                  { values: cur2, color: two!.color, width: 1.6, dashed: true, label: two!.secondary },
                ] : [
                  ...(prev.filter((v) => v != null).length >= 2 ? [{ values: prev, color: "#5a7a8a", width: 1.4, dashed: true, label: "Previous" }] : []),
                  { values: cur, color: stat.color, width: 2.2, label: "Current" },
                ]}
              />
              {hasTwo ? (
                <ChartLegend items={[{ color: stat.color, label: two!.primary }, { color: two!.color, label: two!.secondary, dashed: true }]} />
              ) : prev.filter((v) => v != null).length >= 2 ? (
                <ChartLegend items={[{ color: stat.color, label: "Current" }, { color: "#5a7a8a", label: "Previous", dashed: true }]} />
              ) : null}
              <View className="mt-1 flex-row justify-between">
                <Text variant="micro" className="text-text-muted tabular-nums">min {fmt(sm?.current_min ?? null)}</Text>
                <Text variant="micro" className="text-text-muted tabular-nums">avg {fmt(sm?.current_avg ?? null)}</Text>
                <Text variant="micro" className="text-text-muted tabular-nums">max {fmt(sm?.current_max ?? null)}</Text>
              </View>
              {delta != null && sm?.previous_avg != null ? (
                <Text variant="micro" className={`tabular-nums ${delta >= 0 ? "text-success" : "text-warning"}`}>
                  {delta >= 0 ? "+" : ""}{Math.round(delta).toLocaleString()}{unit} vs previous {range} (avg {fmt(sm.previous_avg)})
                </Text>
              ) : null}
            </View>
          ) : (
            <Text variant="caption" className="text-text-muted">No trend data for this range.</Text>
          )}
        </View>
      </Modal>
    );
  }

  // Fallback path: the card's sparkline values
  const s = (stat.spark ?? []).filter((v) => isFinite(v));
  const min = s.length ? Math.min(...s) : null;
  const max = s.length ? Math.max(...s) : null;
  const avg = s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
  return (
    <Modal visible={!!stat} onClose={onClose} title={stat.label}>
      <View className="gap-3">
        <View className="flex-row items-end gap-2">
          <Text variant="display" className="tabular-nums" style={{ color: stat.color }}>{stat.value}</Text>
          <Text variant="body" className="mb-1 text-text-muted">{stat.sub}</Text>
        </View>
        {stat.info ? <Text variant="caption" className="text-text-secondary">{stat.info}</Text> : null}
        {s.length >= 2 ? (
          <View className="gap-1">
            <Text variant="eyebrow" className="text-text-muted">Trend · last {s.length} days</Text>
            <LineChart height={160} interactive refLine={avg != null ? { y: avg, color: "#5a7a8a", label: `avg ${Math.round(avg).toLocaleString()}` } : undefined} series={[{ values: s, color: stat.color, width: 2.2 }]} yFormat={(v) => `${Math.round(v).toLocaleString()}`} />
            <View className="mt-1 flex-row justify-between">
              <Text variant="micro" className="text-text-muted tabular-nums">min {fmt(min)}</Text>
              <Text variant="micro" className="text-text-muted tabular-nums">avg {fmt(avg)}</Text>
              <Text variant="micro" className="text-text-muted tabular-nums">max {fmt(max)}</Text>
            </View>
          </View>
        ) : (
          <Text variant="caption" className="text-text-muted">No trend data yet.</Text>
        )}
      </View>
    </Modal>
  );
}
