import { useEffect, useState } from "react";
import { View } from "react-native";
import { Text, Card } from "soma-style";
import { LineChart, ChartLegend, ExpandableChart, chartDateLabel, type LineChartProps } from "./line-chart";
import { fetchJson } from "../lib/api";

interface StatPoint { date: string; value: number | null; value2?: number | null }
interface StatSeries { current: StatPoint[]; summary: { current_avg: number | null } }
type Metric = "steps" | "calories" | "rhr" | "stress";
const METRICS: Metric[] = ["steps", "calories", "rhr", "stress"];

const fin = (v: number | null | undefined): number | null => (v != null && isFinite(Number(v)) ? Number(v) : null);
const mean = (xs: (number | null)[]): number | null => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

/** Web's four page-level trend cards (Daily Steps / Daily Calories / Resting Heart Rate /
 *  Stress Trend), range-scoped through /api/stats, each expandable (soma#769). */
export function OverviewTrendCharts({ range }: { range: string }) {
  const [data, setData] = useState<Partial<Record<Metric, StatSeries>>>({});
  useEffect(() => {
    let alive = true;
    Promise.all(METRICS.map((m) => fetchJson<StatSeries>(`/api/stats/${m}?range=${range}`).then((d) => [m, d] as const).catch(() => [m, null] as const)))
      .then((pairs) => { if (!alive) return; const next: Partial<Record<Metric, StatSeries>> = {}; for (const [m, d] of pairs) if (d) next[m] = d; setData(next); });
    return () => { alive = false; };
  }, [range]);

  const series = (m: Metric) => (data[m]?.current ?? []).filter((p) => p.value != null);
  const labels = (pts: StatPoint[]) => pts.map((p) => chartDateLabel(p.date));
  const last7 = (pts: StatPoint[]) => mean(pts.slice(-7).map((p) => fin(p.value)));

  const steps = series("steps"); const cal = series("calories"); const rhr = series("rhr"); const stress = series("stress");
  if (!steps.length && !cal.length && !rhr.length && !stress.length) return null;

  const cards: { key: string; title: string; subtitle: string; chart: LineChartProps; legend?: { color: string; label: string; dashed?: boolean }[] }[] = [];
  if (steps.length >= 2) {
    const avg7 = last7(steps);
    cards.push({
      key: "steps", title: "Daily Steps", subtitle: avg7 != null ? `7-day avg: ${Math.round(avg7).toLocaleString()}` : "",
      chart: { labels: labels(steps), xTicks: 4, yMin: 0, yFormat: (v) => `${Math.round(v / 1000)}k`, refLine: { y: 10000, color: "#77c8d1", label: "10K goal" }, series: [{ values: steps.map((p) => fin(p.value)), color: "#77c8d1", mode: "bars", label: "Steps" }] },
    });
  }
  if (cal.length >= 2) {
    const active = cal.map((p) => fin(p.value)); const bmr = cal.map((p) => fin(p.value2)); const bmrAvg = mean(bmr); const avg7 = last7(cal);
    cards.push({
      key: "calories", title: "Daily Calories", subtitle: avg7 != null ? `7-day active avg: ${Math.round(avg7).toLocaleString()} kcal` : "",
      chart: { labels: labels(cal), xTicks: 4, yMin: 0, yFormat: (v) => `${Math.round(v).toLocaleString()}`, refLine: bmrAvg != null ? { y: bmrAvg, color: "#8fa8b8", label: `BMR ~${Math.round(bmrAvg).toLocaleString()}` } : undefined, series: [{ values: active, color: "#e0a458", width: 2.2, label: "Active" }, ...(bmr.some((v) => v != null) ? [{ values: bmr, color: "#5a7a8a", width: 1.4, dashed: true, label: "BMR" }] : [])] },
      legend: [{ color: "#e0a458", label: "Active" }, { color: "#5a7a8a", label: "BMR", dashed: true }],
    });
  }
  if (rhr.length >= 2) {
    const vals = rhr.map((p) => fin(p.value)); const latest = vals.filter((v): v is number => v != null).at(-1); const avg7 = last7(rhr);
    cards.push({
      key: "rhr", title: "Resting Heart Rate", subtitle: latest != null && avg7 != null ? `${Math.round(latest)} bpm · avg ${Math.round(avg7)}` : "",
      chart: { labels: labels(rhr), xTicks: 4, yFormat: (v) => `${Math.round(v)}`, refLine: avg7 != null ? { y: avg7, color: "#e06060", label: `avg ${Math.round(avg7)}` } : undefined, series: [{ values: vals, color: "#e06060", width: 2.2, label: "RHR" }] },
    });
  }
  if (stress.length >= 2) {
    const avg = stress.map((p) => fin(p.value)); const max = stress.map((p) => fin(p.value2)); const latest = avg.filter((v): v is number => v != null).at(-1); const avg7 = last7(stress);
    cards.push({
      key: "stress", title: "Stress Trend", subtitle: latest != null && avg7 != null ? `Today: ${Math.round(latest)} · avg ${Math.round(avg7)}` : "",
      chart: { labels: labels(stress), xTicks: 4, yMin: 0, yMax: 100, yFormat: (v) => `${Math.round(v)}`, refLines: [{ y: 25, color: "#6ad4a0", label: "low" }, { y: 50, color: "#e0c458", label: "med" }, { y: 75, color: "#e06060", label: "high" }], series: [...(max.some((v) => v != null) ? [{ values: max, color: "#e06060", width: 1.4, dashed: true, label: "Max" }] : []), { values: avg, color: "#e0c458", width: 2.2, label: "Avg" }] },
      legend: [{ color: "#e0c458", label: "Avg" }, { color: "#e06060", label: "Max", dashed: true }],
    });
  }
  if (!cards.length) return null;
  return (
    <View className="gap-3">
      <Text variant="eyebrow" className="text-text-muted mt-1">Trends</Text>
      {cards.map((c) => (
        <Card key={c.key} className="gap-2">
          <ExpandableChart title={c.title} chart={c.chart}>
            {c.subtitle ? <Text variant="micro" className="text-text-muted">{c.subtitle}</Text> : null}
            <LineChart height={130} interactive {...c.chart} />
          </ExpandableChart>
          {c.legend ? <ChartLegend items={c.legend} /> : null}
        </Card>
      ))}
    </View>
  );
}
