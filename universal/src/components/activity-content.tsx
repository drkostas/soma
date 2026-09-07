import { useState, useMemo } from "react";
import { View, Pressable, ScrollView } from "react-native";
import { Text, Card } from "soma-style";
import type { ActivityRow, MonthSports } from "../lib/api";
import { LineChart, ExpandableChart, ChartLegend } from "./line-chart";

const SPORT_META: Record<string, { color: string; emoji: string; label: string }> = {
  running: { color: "#77c8d1", emoji: "🏃", label: "Run" },
  treadmill_running: { color: "#77c8d1", emoji: "🏃", label: "Run" },
  strength_training: { color: "#e0a458", emoji: "🏋️", label: "Gym" },
  indoor_cardio: { color: "#e0a458", emoji: "🏋️", label: "Cardio" },
  cycling: { color: "#6366b0", emoji: "🚴", label: "Cycle" },
  road_biking: { color: "#6366b0", emoji: "🚴", label: "Cycle" },
  kiteboarding_v2: { color: "#6ad4a0", emoji: "🪁", label: "Kite" },
  kiteboarding: { color: "#6ad4a0", emoji: "🪁", label: "Kite" },
  lap_swimming: { color: "#82d0c8", emoji: "🏊", label: "Swim" },
  open_water_swimming: { color: "#82d0c8", emoji: "🏊", label: "Swim" },
  walking: { color: "#cbe896", emoji: "🚶", label: "Walk" },
  hiking: { color: "#cbe896", emoji: "🥾", label: "Hike" },
};
function meta(key: string) {
  return SPORT_META[key] ?? SPORT_META[(key || "").toLowerCase()] ?? { color: "#5a7a8a", emoji: "•", label: key || "Activity" };
}
function isGym(key: string) { return key === "strength_training" || key === "indoor_cardio"; }

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function niceDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function relativeDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const then = new Date(y, (m ?? 1) - 1, d ?? 1);
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function stat(a: ActivityRow): string {
  const parts: string[] = [];
  if (a.distance_km && a.distance_km > 0) parts.push(`${a.distance_km.toFixed(1)} km`);
  if (a.duration_min && a.duration_min > 0) parts.push(`${Math.round(a.duration_min)} min`);
  if (a.calories && a.calories > 0) parts.push(`${Math.round(a.calories)} kcal`);
  return parts.join(" · ");
}

/** GitHub-style 26-week activity calendar: a cell per day coloured by sport,
 *  opacity by count; tap a day to see its activities. */
export function ActivityHeatmap({ activities }: { activities: ActivityRow[] }) {
  const [sel, setSel] = useState<string | null>(null);
  const byDay = useMemo(() => {
    const m = new Map<string, ActivityRow[]>();
    for (const a of activities) {
      const day = (a.date || "").slice(0, 10);
      if (!day) continue;
      if (!m.has(day)) m.set(day, []);
      m.get(day)!.push(a);
    }
    return m;
  }, [activities]);

  const { weeks, active } = useMemo(() => {
    const today = new Date();
    const dow = today.getDay();
    const daysToMon = dow === 0 ? 6 : dow - 1;
    const start = new Date(today);
    start.setDate(today.getDate() - daysToMon - 25 * 7);
    const cols: { date: string; acts: ActivityRow[] }[][] = [];
    const cursor = new Date(start);
    let activeDays = 0;
    for (let w = 0; w < 26; w++) {
      const col: { date: string; acts: ActivityRow[] }[] = [];
      for (let d = 0; d < 7; d++) {
        const ds = ymd(cursor);
        const acts = byDay.get(ds) ?? [];
        if (acts.length) activeDays++;
        col.push({ date: ds, acts });
        cursor.setDate(cursor.getDate() + 1);
      }
      cols.push(col);
    }
    return { weeks: cols, active: activeDays };
  }, [byDay]);

  const todayStr = ymd(new Date());
  const selActs = sel ? byDay.get(sel) ?? [] : [];

  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Activity calendar</Text>
        <Text variant="micro" className="text-text-muted">{active} active days · 26 wks</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row" style={{ gap: 3 }}>
          {weeks.map((col, wi) => (
            <View key={wi} style={{ gap: 3 }}>
              {col.map((cell) => {
                const c = cell.acts.length;
                const color = c ? meta(cell.acts[0].type_key).color : "#16242c";
                const future = cell.date > todayStr;
                return (
                  <Pressable key={cell.date} disabled={c === 0} onPress={() => setSel(sel === cell.date ? null : cell.date)}>
                    <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: future ? "transparent" : color, opacity: c ? Math.min(0.45 + c * 0.28, 1) : 1, borderWidth: sel === cell.date ? 1.5 : 0, borderColor: "#e6f6f8" }} />
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      {sel && selActs.length ? (
        <View className="mt-1 gap-1 rounded-lg border border-border-subtle p-2">
          <Text variant="micro" className="text-text-muted">{niceDate(sel)}</Text>
          {selActs.map((a, i) => (
            <View key={i} className="flex-row items-center gap-2">
              <Text variant="caption">{meta(a.type_key).emoji}</Text>
              <Text variant="caption" className="flex-1 text-text" numberOfLines={1}>{a.name || meta(a.type_key).label}</Text>
              <Text variant="micro" className="text-text-muted tabular-nums">{stat(a)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** Recent activity feed: the latest N activities, tap for detail. */
type FeedWorkout = { id: string; title: string; start_time: string; exercise_count: number; duration_min: number | null; volume: number };
type FeedItem = { kind: "activity"; date: string; a: ActivityRow } | { kind: "workout"; date: string; w: FeedWorkout };
/** Web's recent feed lists Garmin activities AND Hevy workouts and routes each to its own
 *  dialog (soma#775). The activity feed here excludes gym, so the Hevy workouts from the
 *  range summary fill that role and open the workout modal. */
export function RecentActivityFeed({ activities, workouts, onSelect, onSelectWorkout }: { activities: ActivityRow[]; workouts?: FeedWorkout[]; onSelect: (a: ActivityRow) => void; onSelectWorkout?: (w: { id: string; title: string }) => void }) {
  const recent = useMemo(() => {
    const items: FeedItem[] = [
      ...activities.map((a) => ({ kind: "activity" as const, date: a.date || "", a })),
      ...(workouts ?? []).map((w) => ({ kind: "workout" as const, date: w.start_time || "", w })),
    ];
    return items.sort((x, y) => y.date.localeCompare(x.date)).slice(0, 20); // web lists twenty (soma#783)
  }, [activities, workouts]);
  if (!recent.length) return null;
  return (
    <Card className="gap-1">
      <Text variant="eyebrow" className="mb-1">Recent activity</Text>
      {recent.map((it, i) => {
        if (it.kind === "workout") {
          const w = it.w;
          return (
            <Pressable key={`w-${w.id}-${i}`} onPress={() => onSelectWorkout?.({ id: w.id, title: w.title })} className="flex-row items-center gap-2 border-b border-border-subtle py-2" testID={`feed-workout-${w.id}`}>
              <Text variant="body">🏋️</Text>
              <View className="flex-1">
                <Text variant="caption" className="text-text" numberOfLines={1}>{w.title || "Workout"}</Text>
                <Text variant="micro" className="text-text-muted tabular-nums">{w.exercise_count} exercises{w.duration_min ? ` · ${w.duration_min} min` : ""}{w.volume > 0 ? ` · ${w.volume >= 1000 ? `${(w.volume / 1000).toFixed(1)}k` : Math.round(w.volume)} kg` : ""}</Text>
              </View>
              <Text variant="micro" className="text-text-muted">{relativeDate(w.start_time)}</Text>
            </Pressable>
          );
        }
        const a = it.a;
        const m = meta(a.type_key);
        return (
          <Pressable key={`${a.activity_id}-${i}`} onPress={() => onSelect(a)} className="flex-row items-center gap-2 border-b border-border-subtle py-2" testID={`feed-row-${i}`}>
            <Text variant="body">{m.emoji}</Text>
            <View className="flex-1">
              <Text variant="caption" className="text-text" numberOfLines={1}>{a.name || m.label}</Text>
              <Text variant="micro" className="text-text-muted tabular-nums">{stat(a) || m.label}</Text>
            </View>
            <Text variant="micro" className="text-text-muted">{relativeDate(a.date)}</Text>
          </Pressable>
        );
      })}
    </Card>
  );
}

/** The most recent gym/strength session, tap for detail. */
export function LastGymSession({ activities, workouts, onSelect, onSelectWorkout }: { activities: ActivityRow[]; workouts?: FeedWorkout[]; onSelect: (a: ActivityRow) => void; onSelectWorkout?: (w: { id: string; title: string }) => void }) {
  const last = useMemo(
    () => [...activities].filter((a) => isGym(a.type_key)).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0] ?? null,
    [activities],
  );
  // Web's "Last Workout" is the newest Hevy workout and opens the workout dialog (soma#775).
  const lastW = useMemo(() => [...(workouts ?? [])].sort((a, b) => (b.start_time || "").localeCompare(a.start_time || ""))[0] ?? null, [workouts]);
  if (lastW && (!last || (lastW.start_time || "") >= (last.date || ""))) {
    return (
      <Pressable onPress={() => onSelectWorkout?.({ id: lastW.id, title: lastW.title })} testID="last-gym-session">
        <Card className="gap-1">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Last gym session</Text>
            <Text variant="micro" className="text-text-muted">{relativeDate(lastW.start_time)}</Text>
          </View>
          <Text variant="title" numberOfLines={1}>🏋️ {lastW.title || "Workout"}</Text>
          <Text variant="caption" className="text-text-muted tabular-nums">{lastW.exercise_count} exercises{lastW.duration_min ? ` · ${lastW.duration_min} min` : ""}{lastW.volume > 0 ? ` · ${lastW.volume >= 1000 ? `${(lastW.volume / 1000).toFixed(1)}k` : Math.round(lastW.volume)} kg` : ""}</Text>
        </Card>
      </Pressable>
    );
  }
  if (!last) return null;
  return (
    <Pressable onPress={() => onSelect(last)}>
      <Card className="gap-1">
        <View className="flex-row items-center justify-between">
          <Text variant="eyebrow">Last gym session</Text>
          <Text variant="micro" className="text-text-muted">{relativeDate(last.date)}</Text>
        </View>
        <Text variant="title" numberOfLines={1}>🏋️ {last.name || "Gym"}</Text>
        <Text variant="caption" className="text-text-muted tabular-nums">{stat(last) || `${Math.round(last.duration_min || 0)} min`}</Text>
      </Card>
    </Pressable>
  );
}

/** Gym sessions per week over the last 12 weeks. */
export function GymFrequency({ days, sinceDays, rangeLabel }: { days: { day: string }[]; sinceDays?: number; rangeLabel?: string }) {
  // Web's Gym Frequency reads hevy_raw_data for the range: "N workouts · M this week" over
  // monthly bars. The deep activity feed excludes strength, so the source is the Hevy calendar
  // from the workout insights (one row per workout day) (soma#783).
  const { months, labels, total, thisWeek } = useMemo(() => {
    const today = new Date();
    // Web scopes the headline to the range (the calendar itself comes back unscoped) and counts
    // "this week" as the last 7 days (NOW - INTERVAL '7 days'), not since Monday.
    const cutoff = sinceDays ? ymd(new Date(today.getTime() - sinceDays * 86400000)) : "";
    const ds = days.map((d) => (d.day || "").slice(0, 10)).filter((d) => d && d >= cutoff).sort();
    const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
    const monS = ymd(weekAgo);
    const byMonth = new Map<string, number>();
    for (const d of ds) byMonth.set(d.slice(0, 7), (byMonth.get(d.slice(0, 7)) ?? 0) + 1);
    // Fill the months between the first and the last workout so a quiet month shows as zero.
    const keys: string[] = [];
    if (ds.length) {
      const [y0, m0] = ds[0].slice(0, 7).split("-").map(Number); const [y1, m1] = ds[ds.length - 1].slice(0, 7).split("-").map(Number);
      for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m++) { if (m > 12) { m = 1; y++; } keys.push(`${y}-${String(m).padStart(2, "0")}`); }
    }
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return {
      months: keys.map((k) => byMonth.get(k) ?? 0),
      labels: keys.map((k) => `${MON[Number(k.slice(5, 7)) - 1]} '${k.slice(2, 4)}`),
      total: ds.length,
      thisWeek: ds.filter((d) => d >= monS).length,
    };
  }, [days, sinceDays]);
  if (!total) return null;
  const chart = {
    labels,
    xTicks: Math.min(4, labels.length),
    yFormat: (v: number) => String(Math.round(v)),
    yMin: 0,
    series: [{ values: months, color: "#e0a458", mode: "bars" as const, label: "Workouts" }],
  };
  return (
    <Card className="gap-2">
      <ExpandableChart title="Gym frequency" chart={chart}>
        <View className="flex-row items-end gap-2" testID="gym-frequency-headline">
          <Text variant="headline" className="tabular-nums">{total}</Text>
          <Text variant="micro" className="text-text-muted mb-0.5">workouts{rangeLabel ? ` · ${rangeLabel}` : ""} · {thisWeek} this week</Text>
        </View>
        <LineChart height={110} interactive {...chart} />
      </ExpandableChart>
      <ChartLegend items={[{ color: "#e0a458", label: "workouts per month" }]} />
    </Card>
  );
}

/** Activity breakdown: sessions by sport over the loaded window (from monthly). */
export function ActivityBreakdown({ monthly }: { monthly: MonthSports[] }) {
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const mo of monthly) for (const [sport, n] of Object.entries(mo.sports ?? {})) m.set(sport, (m.get(sport) ?? 0) + Number(n));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [monthly]);
  if (!totals.length) return null;
  const max = Math.max(...totals.map(([, n]) => n), 1);
  const sum = totals.reduce((a, [, n]) => a + n, 0) || 1;
  // Web's Activity Breakdown dialog: the same bars, taller, with each sport's share of the total.
  const bars = (expanded: boolean) => (
    <View className={expanded ? "gap-2" : "gap-1.5"}>
      {totals.map(([sport, n]) => {
        const m = meta(sport);
        return (
          <View key={sport} className="gap-0.5">
            <View className="flex-row justify-between">
              <Text variant="caption" className="text-text-secondary">{m.emoji} {m.label}</Text>
              <Text variant="caption" className="tabular-nums text-text-muted">{n}{expanded ? ` · ${((n / sum) * 100).toFixed(1)}%` : ""}</Text>
            </View>
            <View className={expanded ? "h-4 overflow-hidden rounded-md" : "h-2 overflow-hidden rounded-full"} style={{ backgroundColor: "#16242c" }}>
              <View className="h-full" style={{ width: `${(n / max) * 100}%`, backgroundColor: m.color, borderRadius: expanded ? 4 : 999 }} />
            </View>
          </View>
        );
      })}
      {expanded ? <Text variant="micro" className="text-text-muted">{sum} activities in this range</Text> : null}
    </View>
  );
  return (
    <Card className="gap-2">
      <ExpandableChart title="Activity breakdown" renderExpanded={() => bars(true)}>
        {bars(false)}
      </ExpandableChart>
    </Card>
  );
}
