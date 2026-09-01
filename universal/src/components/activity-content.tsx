import { useState, useMemo } from "react";
import { View, Pressable, ScrollView } from "react-native";
import { Text, Card } from "soma-style";
import type { ActivityRow, MonthSports } from "../lib/api";
import { LineChart } from "./line-chart";

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
export function RecentActivityFeed({ activities, onSelect }: { activities: ActivityRow[]; onSelect: (a: ActivityRow) => void }) {
  const recent = useMemo(() =>
    [...activities].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8),
    [activities]);
  if (!recent.length) return null;
  return (
    <Card className="gap-1">
      <Text variant="eyebrow" className="mb-1">Recent activity</Text>
      {recent.map((a, i) => {
        const m = meta(a.type_key);
        return (
          <Pressable key={`${a.activity_id}-${i}`} onPress={() => onSelect(a)} className="flex-row items-center gap-2 border-b border-border-subtle py-2">
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
export function LastGymSession({ activities, onSelect }: { activities: ActivityRow[]; onSelect: (a: ActivityRow) => void }) {
  const last = useMemo(
    () => [...activities].filter((a) => isGym(a.type_key)).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0] ?? null,
    [activities],
  );
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
export function GymFrequency({ activities }: { activities: ActivityRow[] }) {
  const { weeks, labels } = useMemo(() => {
    const gym = activities.filter((a) => isGym(a.type_key));
    const today = new Date();
    const dow = today.getDay();
    const daysToMon = dow === 0 ? 6 : dow - 1;
    const thisMon = new Date(today);
    thisMon.setDate(today.getDate() - daysToMon);
    const w: number[] = [];
    const l: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const ws = new Date(thisMon);
      ws.setDate(thisMon.getDate() - i * 7);
      const we = new Date(ws);
      we.setDate(ws.getDate() + 7);
      const wsS = ymd(ws), weS = ymd(we);
      w.push(gym.filter((a) => { const d = (a.date || "").slice(0, 10); return d >= wsS && d < weS; }).length);
      l.push(niceDate(wsS).replace(/^\w+, /, ""));
    }
    return { weeks: w, labels: l };
  }, [activities]);
  if (weeks.every((v) => v === 0)) return null;
  return (
    <Card className="gap-2">
      <Text variant="eyebrow">Gym frequency</Text>
      <LineChart height={110} series={[{ values: weeks, color: "#e0a458", width: 2.2 }]} labels={labels} yFormat={(v) => String(Math.round(v))} />
      <Text variant="micro" className="text-text-muted">sessions / week · last 12 weeks</Text>
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
  return (
    <Card className="gap-2">
      <Text variant="eyebrow">Activity breakdown</Text>
      {totals.map(([sport, n]) => {
        const m = meta(sport);
        return (
          <View key={sport} className="gap-0.5">
            <View className="flex-row justify-between">
              <Text variant="caption" className="text-text-secondary">{m.emoji} {m.label}</Text>
              <Text variant="caption" className="tabular-nums text-text-muted">{n}</Text>
            </View>
            <View className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: "#16242c" }}>
              <View className="h-full rounded-full" style={{ width: `${(n / max) * 100}%`, backgroundColor: m.color }} />
            </View>
          </View>
        );
      })}
    </Card>
  );
}
