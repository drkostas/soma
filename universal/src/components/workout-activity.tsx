import { useMemo, useState } from "react";
import { View, Pressable } from "react-native";
import { Text, Card } from "soma-style";
import { LineChart, ChartLegend } from "./line-chart";
import type { WorkoutInsights } from "../lib/api";

const num = (v: unknown): number => { const n = Number(v); return isFinite(n) ? n : 0; };
const EMPTY = "#16242b";
const REST_WORKED = "#4fa07a"; // worked-out day whose program is unlabelled
/** Distinct colors assigned to programs in first-seen order. */
const PROG_PALETTE = ["#6ad4a0", "#77c8d1", "#e0a458", "#c084fc", "#6aa0e0", "#cbe896", "#e06060", "#b17bd4"];

function isoDay(d: Date): string { return d.toISOString().slice(0, 10); }
function mondayIndex(d: Date): number { return (d.getUTCDay() + 6) % 7; } // Mon=0..Sun=6
function longDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
function programColor(program: string, order: string[]): string {
  const i = order.indexOf(program);
  return i >= 0 ? PROG_PALETTE[i % PROG_PALETTE.length] : REST_WORKED;
}

type Cell = { key: string; worked: boolean; program: string | null };

/** 26-week workout calendar heatmap. Days are colored by their program (web
 *  parity #428); tapping a worked day reveals its date + program, and a legend
 *  maps each color to its program. */
function CalendarHeatmap({ calendar }: { calendar: WorkoutInsights["calendar"] }) {
  const [selected, setSelected] = useState<Cell | null>(null);
  const { weeks, programs } = useMemo(() => {
    const dayProg = new Map<string, string | null>();
    const order: string[] = [];
    for (const c of calendar) {
      const key = String(c.day).slice(0, 10);
      const p = c.program ?? null;
      if (p && !order.includes(p)) order.push(p);
      const cur = dayProg.get(key);
      if (cur === undefined) dayProg.set(key, p);
      else if (!cur && p) dayProg.set(key, p); // upgrade a null day to a labelled one
    }
    const today = new Date(isoDay(new Date()) + "T00:00:00Z");
    const end = new Date(today); end.setUTCDate(end.getUTCDate() - mondayIndex(today) + 6); // Sunday of this week
    const cols: Cell[][] = [];
    for (let w = 25; w >= 0; w--) {
      const col: Cell[] = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(end);
        day.setUTCDate(end.getUTCDate() - w * 7 - (6 - d));
        const key = isoDay(day);
        col.push({ key, worked: dayProg.has(key), program: dayProg.get(key) ?? null });
      }
      cols.push(col);
    }
    return { weeks: cols, programs: order };
  }, [calendar]);

  const cellColor = (c: Cell): string => (c.worked ? (c.program ? programColor(c.program, programs) : REST_WORKED) : EMPTY);

  return (
    <View className="gap-1.5">
      {selected ? (
        <View className="flex-row items-center gap-2 self-start rounded-md px-2 py-1" style={{ backgroundColor: "#152028" }}>
          <View className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: cellColor(selected) }} />
          <Text variant="micro" className="text-text-secondary">
            {longDay(selected.key)}{selected.program ? ` · ${selected.program}` : " · workout"}
          </Text>
        </View>
      ) : (
        <Text variant="micro" className="text-text-muted">tap a day to see its program</Text>
      )}

      <View className="flex-row gap-0.5">
        {weeks.map((col, wi) => (
          <View key={wi} className="flex-1 gap-0.5">
            {col.map((cell, di) => (
              <Pressable
                key={di}
                disabled={!cell.worked}
                onPress={() => setSelected(cell)}
                className="rounded-[2px]"
                style={{ aspectRatio: 1, backgroundColor: cellColor(cell) }}
              />
            ))}
          </View>
        ))}
      </View>

      {programs.length ? (
        <View className="flex-row flex-wrap gap-x-3 gap-y-1">
          {programs.map((p) => (
            <View key={p} className="flex-row items-center gap-1">
              <View className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: programColor(p, programs) }} />
              <Text variant="micro" className="text-text-muted">{p}</Text>
            </View>
          ))}
        </View>
      ) : null}
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
            <Text variant="micro" className="text-text-muted">sessions / week · tap to read</Text>
          </View>
          <LineChart height={120} interactive xTicks={4} labels={freq.labels} yFormat={(v) => String(Math.round(v))} series={[{ values: freq.counts, color: "#6ad4a0", width: 2.2, label: "Sessions" }]} />
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
            interactive
            xTicks={4}
            labels={hrLabels}
            yFormat={(v) => String(Math.round(v))}
            series={[
              { values: hrMax, color: "#e06060", dashed: true, width: 1.5, label: "Max" },
              { values: hrAvg, color: "#e0a458", width: 2.2, label: "Avg" },
            ]}
          />
          <ChartLegend items={[{ color: "#e0a458", label: "avg" }, { color: "#e06060", label: "max", dashed: true }]} />
        </Card>
      ) : null}
    </View>
  );
}
