import { useMemo, useState } from "react";
import { View, Pressable } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";
import { Text, Card } from "soma-style";
import type { ActivitiesDeep, ActivityRow, KiteSession } from "../lib/api";

/* Sport → colour, mirroring the web activities palette. */
const SPORT_COLOR: Record<string, string> = {
  Kiteboarding: "#22d3ee",
  Snowboarding: "#93c5fd",
  Hiking: "#6ad4a0",
  "E-Bike": "#c084fc",
  Swimming: "#6aa0e0",
  Walking: "#cbe896",
  Cycling: "#e0a458",
  Cardio: "#e06060",
  SUP: "#f0abfc",
  Other: "#5a7a8a",
};
const sportColor = (s: string) => SPORT_COLOR[s] ?? "#5a7a8a";

function shortMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: "short" });
}
function shortDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function hm(mins: number | null | undefined): string {
  if (mins == null || !isFinite(mins)) return "—";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Monthly activity distribution — stacked columns by sport. */
export function ActivitiesMonthly({ monthly }: { monthly: ActivitiesDeep["monthly"] }) {
  const data = (monthly ?? []).slice(-12);
  if (data.length < 2) return null;
  const totals = data.map((m) => Object.values(m.sports).reduce((a, b) => a + b, 0));
  const max = Math.max(...totals) || 1;
  const sports = [...new Set(data.flatMap((m) => Object.keys(m.sports)))];

  return (
    <Card className="gap-2">
      <Text variant="eyebrow">Monthly activity</Text>
      <View className="h-28 flex-row items-end gap-1">
        {data.map((m, i) => {
          const total = totals[i];
          return (
            <View key={m.month} className="flex-1 items-center justify-end self-stretch gap-0.5">
              <View className="w-full overflow-hidden rounded-t-sm" style={{ height: `${Math.max(3, (total / max) * 100)}%` }}>
                {Object.entries(m.sports).map(([s, c]) => (
                  <View key={s} style={{ height: `${(c / total) * 100}%`, backgroundColor: sportColor(s) }} />
                ))}
              </View>
              <Text variant="micro" className="text-text-muted" style={{ fontSize: 8 }}>{shortMonth(m.month)}</Text>
            </View>
          );
        })}
      </View>
      <View className="flex-row flex-wrap gap-x-3 gap-y-1">
        {sports.map((s) => (
          <View key={s} className="flex-row items-center gap-1">
            <View className="h-2 w-2 rounded-full" style={{ backgroundColor: sportColor(s) }} />
            <Text variant="micro" className="text-text-muted">{s}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** Kite deep-dive: speed progression (dots + moving avg), top spots, jump records. */
export function KiteDeepDive({ sessions }: { sessions: KiteSession[] }) {
  const withSpeed = (sessions ?? []).filter((s) => s.maxSpeedKts != null && s.maxSpeedKts > 0);
  const spots = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions ?? []) if (s.spot) m.set(s.spot, (m.get(s.spot) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [sessions]);
  const jumps = useMemo(
    () => (sessions ?? []).filter((s) => (s.jumpM ?? 0) > 0).sort((a, b) => (b.jumpM ?? 0) - (a.jumpM ?? 0)).slice(0, 5),
    [sessions],
  );
  if (!withSpeed.length && !spots.length) return null;

  // moving-average line over max speeds (window ≈ sessions/4, ≤5)
  const speeds = withSpeed.map((s) => s.maxSpeedKts as number);
  const win = Math.max(2, Math.min(5, Math.ceil(speeds.length / 4)));
  const ma = speeds.map((_, i) => {
    const from = Math.max(0, i - win + 1);
    const slice = speeds.slice(from, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  const minS = Math.min(...speeds), maxS = Math.max(...speeds), rS = maxS - minS || 1;
  const H = 90;
  const x = (i: number) => (i / Math.max(1, speeds.length - 1)) * 96 + 2;
  const y = (v: number) => H - ((v - minS) / rS) * (H - 10) - 5;

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Kite deep dive</Text>
        <Text variant="micro" className="tabular-nums text-text-muted">top {maxS.toFixed(1)} kts</Text>
      </View>

      {speeds.length >= 3 ? (
        <View className="gap-1">
          <Svg width="100%" height={H} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none">
            <Polyline points={ma.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke="#22d3ee" strokeWidth={1.4} opacity={0.9} />
            {speeds.map((v, i) => (
              <Circle key={i} cx={x(i)} cy={y(v)} r={2} fill="#22d3ee" fillOpacity={0.5} />
            ))}
          </Svg>
          <Text variant="micro" className="text-text-muted">max speed per session · line = moving avg</Text>
        </View>
      ) : null}

      {spots.length ? (
        <View className="gap-1.5">
          <Text variant="micro" className="text-text-muted">TOP SPOTS</Text>
          {spots.map(([spot, count]) => (
            <View key={spot} className="flex-row items-center gap-2">
              <Text variant="body" className="text-text-secondary flex-1" numberOfLines={1}>{spot}</Text>
              <View className="h-2 rounded-full bg-surface-subtle overflow-hidden" style={{ width: 90 }}>
                <View className="h-full rounded-full" style={{ width: `${(count / spots[0][1]) * 100}%`, backgroundColor: "#22d3ee" }} />
              </View>
              <Text variant="caption" className="tabular-nums text-text-muted w-8 text-right">{count}×</Text>
            </View>
          ))}
        </View>
      ) : null}

      {jumps.length ? (
        <View className="gap-1.5 border-t border-border-subtle pt-2.5">
          <Text variant="micro" className="text-text-muted">JUMP RECORDS</Text>
          {jumps.map((j, i) => (
            <View key={`${j.date}-${i}`} className="flex-row items-center justify-between">
              <Text variant="body" className="text-text-secondary">{j.spot ?? "Session"} · {shortDate(j.date)}</Text>
              <Text variant="body" className="tabular-nums text-teal">{(j.jumpM as number).toFixed(1)} m</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const PAGE = 15;

/** Full activity list: sport-filter pills + load-more paging. */
export function ActivitiesList({ all }: { all: ActivityRow[] }) {
  const [filter, setFilter] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const sports = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of all ?? []) m.set(a.sport, (m.get(a.sport) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);
  const filtered = (all ?? []).filter((a) => !filter || a.sport === filter);
  const page = filtered.slice(0, shown);
  if (!all?.length) return null;

  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">All activities</Text>
        <Text variant="micro" className="tabular-nums text-text-muted">{filtered.length} total</Text>
      </View>
      {sports.length > 1 ? (
        <View className="flex-row flex-wrap gap-2">
          <Pressable onPress={() => { setFilter(null); setShown(PAGE); }} hitSlop={6}>
            <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: filter == null ? "#77c8d122" : "#142530" }}>
              <Text variant="micro" style={{ color: filter == null ? "#77c8d1" : "#8aa0ac" }}>All</Text>
            </View>
          </Pressable>
          {sports.map(([s, c]) => (
            <Pressable key={s} onPress={() => { setFilter(filter === s ? null : s); setShown(PAGE); }} hitSlop={6}>
              <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: filter === s ? sportColor(s) + "33" : "#142530" }}>
                <Text variant="micro" style={{ color: filter === s ? sportColor(s) : "#8aa0ac" }}>{s} {c}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {page.map((a) => (
        <View key={a.activity_id} className="border-b border-border-subtle py-2">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2 flex-1 pr-2">
              <View className="h-2 w-2 rounded-full" style={{ backgroundColor: sportColor(a.sport) }} />
              <Text variant="body" className="text-text" numberOfLines={1} style={{ flex: 1 }}>{a.name || a.sport}</Text>
            </View>
            <Text variant="micro" className="text-text-muted">{shortDate(a.date)}</Text>
          </View>
          <Text variant="micro" className="text-text-muted ml-4">
            {a.distance_km != null && a.distance_km > 0 ? `${a.distance_km.toFixed(1)} km · ` : ""}{hm(a.duration_min)}
            {a.avg_hr != null ? ` · ${Math.round(a.avg_hr)} bpm` : ""}
            {a.elev_gain > 0 ? ` · ↑${Math.round(a.elev_gain)}m` : ""}
          </Text>
        </View>
      ))}
      {filtered.length > shown ? (
        <Pressable onPress={() => setShown((n) => n + PAGE)} hitSlop={6}>
          <View className="items-center rounded-lg bg-surface-subtle py-2">
            <Text variant="caption" className="text-teal">Show {Math.min(PAGE, filtered.length - shown)} more</Text>
          </View>
        </Pressable>
      ) : null}
    </Card>
  );
}
