import { useState } from "react";
import { View, Pressable } from "react-native";
import { Text, Card, Badge, Modal, SegmentedControl } from "soma-style";
import { useWeeklyComparison, type WeekDay } from "../lib/api";

interface WeekTotals { sessions: number; total_hours: number; total_km: number; total_cal: number }
export interface WeeklyTraining { this_week: WeekTotals | null; last_week: WeekTotals | null; streak: number }

// Per-day metric config (keys match /api/weekly-comparison day rows).
const DAY_METRICS = ["Sessions", "Duration", "Distance", "Calories"] as const;
type DayMetric = typeof DAY_METRICS[number];
const DAY_CFG: Record<DayMetric, { get: (d: WeekDay) => number; fmt: (v: number) => string }> = {
  Sessions: { get: (d) => d.sessions, fmt: (v) => String(Math.round(v)) },
  Duration: { get: (d) => d.hours, fmt: (v) => `${v.toFixed(1)}h` },
  Distance: { get: (d) => d.km, fmt: (v) => `${Math.round(v)}km` },
  Calories: { get: (d) => d.calories, fmt: (v) => Math.round(v).toLocaleString() },
};

type MetricKey = "sessions" | "total_hours" | "total_km" | "total_cal";
const METRICS: { key: MetricKey; label: string; unit: string; fmt: (v: number) => string }[] = [
  { key: "sessions", label: "Sessions", unit: "", fmt: (v) => String(Math.round(v)) },
  { key: "total_hours", label: "Duration", unit: "h", fmt: (v) => v.toFixed(1) },
  { key: "total_km", label: "Distance", unit: "km", fmt: (v) => String(Math.round(v)) },
  { key: "total_cal", label: "Calories", unit: "kcal", fmt: (v) => Math.round(v).toLocaleString() },
];

const num = (t: WeekTotals) => ({
  sessions: Number(t.sessions) || 0, total_hours: Number(t.total_hours) || 0,
  total_km: Number(t.total_km) || 0, total_cal: Number(t.total_cal) || 0,
});
function pctChange(cur: number, prev: number | null): number | null {
  if (prev == null || prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** Overview "This Week" training summary: Sessions / Duration / Distance /
 *  Calories with vs-last-week deltas + a streak badge; taps into a this-vs-last
 *  comparison dialog. Mobile-adapted from the web InteractiveThisWeek. */
export function ThisWeekCard({ data }: { data: WeeklyTraining | null }) {
  const [open, setOpen] = useState(false);
  const [dayMetric, setDayMetric] = useState<DayMetric>("Sessions");
  const { data: comparison } = useWeeklyComparison(open);
  if (!data || !data.this_week) return null;
  const tw = num(data.this_week);
  const lw = data.last_week ? num(data.last_week) : null;

  const cmpCfg = DAY_CFG[dayMetric];
  const twDays = comparison?.this_week ?? [];
  const lwDays = comparison?.last_week ?? [];
  const dayMax = Math.max(
    ...twDays.map((d) => cmpCfg.get(d)),
    ...lwDays.map((d) => cmpCfg.get(d)),
    1,
  );

  return (
    <>
      <Pressable onPress={() => setOpen(true)}>
        <Card className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">This week</Text>
            {data.streak > 0 ? <Badge label={`${data.streak}-day streak`} tone="teal" /> : <Text variant="micro" className="text-text-muted">›</Text>}
          </View>
          <View className="flex-row flex-wrap gap-y-3">
            {METRICS.map((m) => {
              const cur = tw[m.key];
              const pc = pctChange(cur, lw ? lw[m.key] : null);
              return (
                <View key={m.key} className="w-1/2 gap-0.5 pr-2">
                  <Text variant="micro" className="text-text-muted">{m.label}</Text>
                  <Text variant="headline" className="tabular-nums">{m.fmt(cur)}{m.unit ? ` ${m.unit}` : ""}</Text>
                  {pc != null ? (
                    <Text variant="micro" className={pc >= 0 ? "text-success" : "text-text-muted"}>{pc >= 0 ? "+" : ""}{pc}% vs last week</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        </Card>
      </Pressable>

      <Modal visible={open} onClose={() => setOpen(false)} title="This week vs last">
        <View className="gap-3">
          {twDays.length ? (
            <View className="gap-1.5">
              <SegmentedControl options={DAY_METRICS} value={dayMetric} onChange={(v) => setDayMetric(v as DayMetric)} />
              {twDays.map((d, i) => {
                const cur = cmpCfg.get(d);
                const prev = lwDays[i] ? cmpCfg.get(lwDays[i]) : 0;
                return (
                  <View key={d.date} className="gap-0.5">
                    <View className="flex-row items-center gap-2">
                      <Text variant="micro" className="w-8 text-text-muted">{d.day}</Text>
                      <View className="flex-1 gap-0.5">
                        <View className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: "#142530" }}>
                          <View style={{ width: `${Math.max((cur / dayMax) * 100, cur > 0 ? 3 : 0)}%`, height: "100%", backgroundColor: "#77c8d1" }} />
                        </View>
                        <View className="h-1 overflow-hidden rounded-full" style={{ backgroundColor: "#101c24" }}>
                          <View style={{ width: `${Math.max((prev / dayMax) * 100, prev > 0 ? 3 : 0)}%`, height: "100%", backgroundColor: "#3a5563" }} />
                        </View>
                      </View>
                      <Text variant="micro" className="w-16 text-right text-text tabular-nums">{cur > 0 ? cmpCfg.fmt(cur) : "–"}</Text>
                    </View>
                  </View>
                );
              })}
              <View className="flex-row items-center gap-3">
                <View className="flex-row items-center gap-1"><View style={{ width: 10, height: 4, borderRadius: 2, backgroundColor: "#77c8d1" }} /><Text variant="micro" className="text-text-muted">This week</Text></View>
                <View className="flex-row items-center gap-1"><View style={{ width: 10, height: 4, borderRadius: 2, backgroundColor: "#3a5563" }} /><Text variant="micro" className="text-text-muted">Last week</Text></View>
              </View>
            </View>
          ) : null}

          <View className="gap-1">
          <View className="flex-row border-b border-border-subtle pb-1.5">
            <Text variant="micro" className="flex-1 text-text-muted">Metric</Text>
            <Text variant="micro" className="w-24 text-right text-text-muted">This week</Text>
            <Text variant="micro" className="w-24 text-right text-text-muted">Last week</Text>
          </View>
          {METRICS.map((m) => {
            const cur = tw[m.key];
            const prev = lw ? lw[m.key] : null;
            const pc = pctChange(cur, prev);
            return (
              <View key={m.key} className="flex-row items-center border-b border-border-subtle py-2">
                <View className="flex-1">
                  <Text variant="caption" className="text-text">{m.label}</Text>
                  {pc != null ? <Text variant="micro" className={pc >= 0 ? "text-success" : "text-text-muted"}>{pc >= 0 ? "+" : ""}{pc}%</Text> : null}
                </View>
                <Text variant="caption" className="w-24 text-right tabular-nums">{m.fmt(cur)}{m.unit ? ` ${m.unit}` : ""}</Text>
                <Text variant="caption" className="w-24 text-right tabular-nums text-text-muted">{prev != null ? `${m.fmt(prev)}${m.unit ? ` ${m.unit}` : ""}` : "–"}</Text>
              </View>
            );
          })}
          {data.streak > 0 ? (
            <View className="mt-2 flex-row justify-center">
              <Badge label={`${data.streak}-day training streak 🔥`} tone="teal" />
            </View>
          ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}
