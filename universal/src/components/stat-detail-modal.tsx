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
const RANGES: readonly Range[] = ["7d", "30d", "90d", "1y"] as const;

/** Detail dialog for a stat card. With `metric`, fetches the real trend for a
 *  chosen range with a dashed previous-period overlay, tap-to-read, and
 *  avg/min/max + Δ-vs-previous; otherwise shows the card's sparkline trend. */
export function StatDetailModal({ stat, onClose }: { stat: StatDetail | null; onClose: () => void }) {
  const [range, setRange] = useState<Range>("30d");
  const [data, setData] = useState<StatSeries | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!stat?.metric) { setData(null); return; }
    let alive = true; setLoading(true);
    fetchJson<StatSeries>(`/api/stats/${stat.metric}?range=${range}`)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [stat?.metric, range]);

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
          {pts.length >= 2 ? (
            <View className="gap-1">
              <Text variant="eyebrow" className="text-text-muted">{pts.length} {stat.timelineNoun ?? "workouts"}</Text>
              <LineChart
                height={170}
                interactive
                labels={labels}
                xTicks={4}
                yFormat={(v) => `${Math.round(v).toLocaleString()}`}
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
        {s.length >= 2 ? (
          <View className="gap-1">
            <Text variant="eyebrow" className="text-text-muted">Trend · last {s.length} days</Text>
            <LineChart height={160} interactive series={[{ values: s, color: stat.color, width: 2.2 }]} yFormat={(v) => `${Math.round(v).toLocaleString()}`} />
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
