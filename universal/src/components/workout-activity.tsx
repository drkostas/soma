import { useMemo } from "react";
import { View } from "react-native";
import { Text, Card } from "soma-style";
import { LineChart, ChartLegend } from "./line-chart";
import type { WorkoutInsights } from "../lib/api";

const num = (v: unknown): number => { const n = Number(v); return isFinite(n) ? n : 0; };
const EMPTY = "#16242b";
const LVL = ["#1e3a44", "#2f6d5b", "#4fa07a", "#77c8a0"]; // workout-day intensity

function isoDay(d: Date): string { return d.toISOString().slice(0, 10); }
function mondayIndex(d: Date): number { return (d.getUTCDay() + 6) % 7; } // Mon=0..Sun=6

/** 26-week workout calendar heatmap (day cells colored by that day's session count). */
function CalendarHeatmap({ calendar }: { calendar: WorkoutInsights["calendar"] }) {
  const { weeks } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of calendar) {
      const key = String(c.day).slice(0, 10);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // anchor to today (UTC); 26 columns ending this week
    const today = new Date(isoDay(new Date()) + "T00:00:00Z");
    const end = new Date(today); end.setUTCDate(end.getUTCDate() - mondayIndex(today) + 6); // Sunday of this week
    const cols: { c: string; n: number }[][] = [];
    for (let w = 25; w >= 0; w--) {
      const col: { c: string; n: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(end);
        day.setUTCDate(end.getUTCDate() - w * 7 - (6 - d));
        const n = counts.get(isoDay(day)) ?? 0;
        col.push({ c: n === 0 ? EMPTY : LVL[Math.min(LVL.length - 1, n - 1)], n });
      }
      cols.push(col);
    }
    return { weeks: cols };
  }, [calendar]);

  return (
    <View className="gap-1.5">
      <View className="flex-row gap-0.5">
        {weeks.map((col, wi) => (
          <View key={wi} className="flex-1 gap-0.5">
            {col.map((cell, di) => (
              <View key={di} className="rounded-[2px]" style={{ aspectRatio: 1, backgroundColor: cell.c }} />
            ))}
          </View>
        ))}
      </View>
      <View className="flex-row items-center justify-end gap-1">
        <Text variant="micro" className="text-text-muted">less</Text>
        {[EMPTY, ...LVL].map((c) => <View key={c} className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: c }} />)}
        <Text variant="micro" className="text-text-muted">more</Text>
      </View>
    </View>
  );
}

/** Weekly workout frequency (sessions/week), derived from the calendar. */
function frequencyFromCalendar(calendar: WorkoutInsights["calendar"]): { labels: string[]; counts: number[] } {
  const wk = new Map<string, number>();
  for (const c of calendar) {
    const d = new Date(String(c.day).slice(0, 10) + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - mondayIndex(d)); // Monday of that week
    const key = isoDay(d);
    wk.set(key, (wk.get(key) ?? 0) + 1);
  }
  const sorted = [...wk.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-16);
  return {
    labels: sorted.map(([k]) => { const [, m, d] = k.split("-").map(Number); return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][(m ?? 1) - 1]} ${d}`; }),
    counts: sorted.map(([, v]) => v),
  };
}

/** Calendar heatmap + weekly frequency + per-workout avg-HR (web parity, #428). */
export function WorkoutActivity({ insights }: { insights: WorkoutInsights | null | undefined }) {
  if (!insights) return null;
  const cal = insights.calendar ?? [];
  const freq = frequencyFromCalendar(cal);
  const hr = insights.hrTrend ?? [];
  const hrAvg = hr.map((h) => (h.avg_hr == null ? null : num(h.avg_hr)));
  const hrMax = hr.map((h) => (h.max_hr == null ? null : num(h.max_hr)));
  const hrLabels = hr.map((h) => { const [, m, d] = String(h.date).slice(0, 10).split("-").map(Number); return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][(m ?? 1) - 1]} ${d}`; });

  return (
    <View className="gap-4">
      {cal.length ? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Training calendar</Text>
            <Text variant="micro" className="text-text-muted">last 26 weeks</Text>
          </View>
          <CalendarHeatmap calendar={cal} />
        </Card>
      ) : null}

      {freq.counts.length >= 2 ? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Weekly frequency</Text>
            <Text variant="micro" className="text-text-muted">sessions / week</Text>
          </View>
          <LineChart height={120} labels={freq.labels} yFormat={(v) => String(Math.round(v))} series={[{ values: freq.counts, color: "#6ad4a0", width: 2.2 }]} />
        </Card>
      ) : null}

      {hrAvg.filter((v) => v != null).length >= 2 ? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Avg HR per workout</Text>
            <Text variant="micro" className="text-text-muted">bpm</Text>
          </View>
          <LineChart
            height={130}
            labels={hrLabels}
            yFormat={(v) => String(Math.round(v))}
            series={[
              { values: hrMax, color: "#e06060", dashed: true, width: 1.5 },
              { values: hrAvg, color: "#e0a458", width: 2.2 },
            ]}
          />
          <ChartLegend items={[{ color: "#e0a458", label: "avg" }, { color: "#e06060", label: "max", dashed: true }]} />
        </Card>
      ) : null}
    </View>
  );
}
