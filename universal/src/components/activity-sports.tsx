import { useMemo } from "react";
import { View } from "react-native";
import { Text, Card } from "soma-style";
import type { ActivityRow } from "../lib/api";

const num = (v: number | null | undefined): number => (v == null || !isFinite(Number(v)) ? 0 : Number(v));
function shortDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const SPORT_COLOR: Record<string, string> = {
  Kiteboarding: "#22d3ee", Snowboarding: "#93c5fd", Hiking: "#6ad4a0", "E-Bike": "#c084fc",
  Swimming: "#6aa0e0", Walking: "#cbe896", Cycling: "#e0a458", Cardio: "#e06060", Running: "#6ad4a0",
  Gym: "#e0a458", SUP: "#f0abfc", Other: "#5a7a8a",
};
const sportColor = (s: string) => SPORT_COLOR[s] ?? "#5a7a8a";

/** One sport section: heading + 4 stat cards + a short recent list. Data from all[]. */
function SportSection({ sport, rows }: { sport: string; rows: ActivityRow[] }) {
  const mine = useMemo(
    () => rows.filter((a) => a.sport.toLowerCase().includes(sport.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date)),
    [rows, sport],
  );
  if (mine.length < 1) return null;
  const km = mine.reduce((s, a) => s + num(a.distance_km), 0);
  const hours = mine.reduce((s, a) => s + num(a.duration_min), 0) / 60;
  const hrVals = mine.map((a) => num(a.avg_hr)).filter((v) => v > 0);
  const avgHr = hrVals.length ? Math.round(hrVals.reduce((a, b) => a + b, 0) / hrVals.length) : null;
  const stats: [string, string][] = [
    ["Sessions", `${mine.length}`],
    ["Distance", km > 0 ? `${km.toFixed(0)} km` : "—"],
    ["Time", `${hours.toFixed(0)}h`],
    ["Avg HR", avgHr != null ? `${avgHr} bpm` : "—"],
  ];

  return (
    <Card className="gap-3">
      <View className="flex-row items-center gap-2">
        <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: sportColor(sport) }} />
        <Text variant="eyebrow">{sport}</Text>
      </View>
      <View className="flex-row flex-wrap gap-3">
        {stats.map(([label, value]) => (
          <View key={label} className="min-w-[22%] flex-1 gap-0.5">
            <Text variant="micro" className="text-text-muted">{label}</Text>
            <Text variant="title" style={{ color: sportColor(sport) }}>{value}</Text>
          </View>
        ))}
      </View>
      <View className="gap-1">
        {mine.slice(0, 3).map((a) => (
          <View key={a.activity_id} className="flex-row items-center justify-between border-t border-border-subtle pt-1.5">
            <Text variant="micro" className="text-text-secondary flex-1" numberOfLines={1}>{a.name || sport}</Text>
            <Text variant="micro" className="tabular-nums text-text-muted ml-2">
              {num(a.distance_km) > 0 ? `${num(a.distance_km).toFixed(1)} km · ` : ""}{shortDate(a.date)}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** Activity-by-Year: per-year sessions / km / hours + a stacked sport bar. */
function ActivityByYear({ rows }: { rows: ActivityRow[] }) {
  const years = useMemo(() => {
    const m = new Map<string, { count: number; km: number; min: number; sports: Record<string, number> }>();
    for (const a of rows) {
      const y = String(a.date).slice(0, 4);
      if (!m.has(y)) m.set(y, { count: 0, km: 0, min: 0, sports: {} });
      const e = m.get(y)!;
      e.count++; e.km += num(a.distance_km); e.min += num(a.duration_min);
      e.sports[a.sport] = (e.sports[a.sport] ?? 0) + 1;
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);
  if (years.length < 1) return null;

  return (
    <Card className="gap-3">
      <Text variant="eyebrow">Activity by year</Text>
      {years.map(([year, e]) => {
        const sports = Object.entries(e.sports).sort((a, b) => b[1] - a[1]);
        return (
          <View key={year} className="gap-1.5 border-b border-border-subtle pb-2">
            <View className="flex-row items-center justify-between">
              <Text variant="body" className="text-text">{year}</Text>
              <Text variant="micro" className="tabular-nums text-text-muted">
                {e.count} · {e.km > 0 ? `${e.km.toFixed(0)} km · ` : ""}{(e.min / 60).toFixed(0)}h
              </Text>
            </View>
            <View className="h-2.5 flex-row overflow-hidden rounded-full">
              {sports.map(([s, c]) => (
                <View key={s} style={{ flex: c, backgroundColor: sportColor(s) }} />
              ))}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

/** Per-sport sections (Walking / Cycling / Swimming) + Activity-by-Year (web parity, #439). */
export function ActivitySports({ all }: { all: ActivityRow[] | undefined }) {
  const rows = all ?? [];
  if (rows.length < 1) return null;
  return (
    <View className="gap-4">
      {["Walking", "Cycling", "Swimming"].map((sp) => (
        <SportSection key={sp} sport={sp} rows={rows} />
      ))}
      <ActivityByYear rows={rows} />
    </View>
  );
}
