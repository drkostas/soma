import { useMemo, useState } from "react";
import { View, Pressable, TextInput } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";
import { Text, Card } from "soma-style";
import type { ActivitiesDeep, ActivityRow, KiteSession } from "../lib/api";
import { ActivityDetailModal } from "./activity-detail-modal";

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

      <KiteWind sessions={sessions} />
    </Card>
  );
}

/** Kite wind conditions: avg wind, max gust, sessions-with-wind + a per-session list. */
function KiteWind({ sessions }: { sessions: KiteSession[] }) {
  const withWind = (sessions ?? []).filter((s) => (s.windKts ?? 0) > 0);
  if (withWind.length < 1) return null;
  const winds = withWind.map((s) => s.windKts as number);
  const avgWind = winds.reduce((a, b) => a + b, 0) / winds.length;
  const gusts = withWind.map((s) => s.gustKts ?? 0).filter((g) => g > 0);
  const maxGust = gusts.length ? Math.max(...gusts) : null;
  const windy = [...withWind].sort((a, b) => (b.windKts ?? 0) - (a.windKts ?? 0)).slice(0, 4);

  return (
    <View className="gap-2 border-t border-border-subtle pt-2.5">
      <Text variant="micro" className="text-text-muted">WIND CONDITIONS</Text>
      <View className="flex-row flex-wrap gap-x-6 gap-y-1">
        {[
          ["Avg wind", `${avgWind.toFixed(0)} kts`],
          ["Max gust", maxGust != null ? `${maxGust.toFixed(0)} kts` : "—"],
          ["With wind", `${withWind.length}`],
        ].map(([label, value]) => (
          <View key={label} className="gap-0.5">
            <Text variant="micro" className="text-text-muted">{label}</Text>
            <Text variant="title" className="text-teal">{value}</Text>
          </View>
        ))}
      </View>
      {windy.map((s, i) => (
        <View key={`${s.date}-${i}`} className="flex-row items-center justify-between">
          <Text variant="micro" className="text-text-secondary flex-1" numberOfLines={1}>{s.spot ?? "Session"} · {shortDate(s.date)}</Text>
          <Text variant="micro" className="tabular-nums text-text-muted ml-2">
            {(s.windKts as number).toFixed(0)} kts{s.gustKts != null && s.gustKts > 0 ? ` · gust ${s.gustKts.toFixed(0)}` : ""}
          </Text>
        </View>
      ))}
    </View>
  );
}

const PAGE = 12;
type SortKey = "date" | "distance_km" | "duration_min" | "avg_hr" | "calories" | "elev_gain";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "date", label: "Date" }, { key: "distance_km", label: "Dist" }, { key: "duration_min", label: "Time" },
  { key: "avg_hr", label: "HR" }, { key: "calories", label: "Cal" }, { key: "elev_gain", label: "Elev" },
];
const numf = (v: number | null | undefined): number => (v == null || !isFinite(Number(v)) ? 0 : Number(v));

/** Full activity table: search + sport pills + sortable columns + numbered
 *  pagination + tap-to-detail. Web parity (#441). */
export function ActivitiesList({ all }: { all: ActivityRow[] }) {
  const [filter, setFilter] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ActivityRow | null>(null);

  const sports = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of all ?? []) m.set(a.sport, (m.get(a.sport) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const arr = (all ?? []).filter((a) =>
      (!filter || a.sport === filter) &&
      (!ql || (a.name ?? "").toLowerCase().includes(ql) || a.sport.toLowerCase().includes(ql)),
    );
    arr.sort((a, b) => {
      const av = sortKey === "date" ? new Date(a.date).getTime() : numf(a[sortKey]);
      const bv = sortKey === "date" ? new Date(b.date).getTime() : numf(b[sortKey]);
      return asc ? av - bv : bv - av;
    });
    return arr;
  }, [all, filter, q, sortKey, asc]);

  if (!all?.length) return null;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const rows = filtered.slice(cur * PAGE, cur * PAGE + PAGE);
  const onSort = (k: SortKey) => { if (k === sortKey) setAsc((v) => !v); else { setSortKey(k); setAsc(false); } setPage(0); };

  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">All activities</Text>
        <Text variant="micro" className="tabular-nums text-text-muted">{filtered.length} total</Text>
      </View>

      <TextInput
        value={q}
        onChangeText={(t) => { setQ(t); setPage(0); }}
        placeholder="Search activities…"
        placeholderTextColor="#5a7a8a"
        className="rounded-lg bg-surface-subtle px-3 py-2 text-text"
        style={{ color: "#e6edf0" }}
      />

      {sports.length > 1 ? (
        <View className="flex-row flex-wrap gap-2">
          <Pressable onPress={() => { setFilter(null); setPage(0); }} hitSlop={6}>
            <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: filter == null ? "#77c8d122" : "#142530" }}>
              <Text variant="micro" style={{ color: filter == null ? "#77c8d1" : "#8aa0ac" }}>All</Text>
            </View>
          </Pressable>
          {sports.map(([s, c]) => (
            <Pressable key={s} onPress={() => { setFilter(filter === s ? null : s); setPage(0); }} hitSlop={6}>
              <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: filter === s ? sportColor(s) + "33" : "#142530" }}>
                <Text variant="micro" style={{ color: filter === s ? sportColor(s) : "#8aa0ac" }}>{s} {c}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Sortable column chips */}
      <View className="flex-row flex-wrap gap-1.5 border-b border-border-subtle pb-1.5">
        {SORTS.map((c) => (
          <Pressable key={c.key} onPress={() => onSort(c.key)} hitSlop={4}>
            <Text variant="micro" className={sortKey === c.key ? "text-teal" : "text-text-muted"}>
              {c.label}{sortKey === c.key ? (asc ? " ↑" : " ↓") : ""}
            </Text>
          </Pressable>
        ))}
      </View>

      {rows.map((a) => (
        <Pressable key={a.activity_id} onPress={() => setSelected(a)} className="border-b border-border-subtle py-2">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2 flex-1 pr-2">
              <View className="h-2 w-2 rounded-full" style={{ backgroundColor: sportColor(a.sport) }} />
              <Text variant="body" className="text-text" numberOfLines={1} style={{ flex: 1 }}>{a.name || a.sport}</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <Text variant="micro" className="text-text-muted">{shortDate(a.date)}</Text>
              <Text variant="micro" className="text-text-muted">›</Text>
            </View>
          </View>
          <Text variant="micro" className="text-text-muted ml-4">
            {a.distance_km != null && a.distance_km > 0 ? `${a.distance_km.toFixed(1)} km · ` : ""}{hm(a.duration_min)}
            {a.avg_hr != null ? ` · ${Math.round(a.avg_hr)} bpm` : ""}
            {a.calories != null && a.calories > 0 ? ` · ${Math.round(a.calories)} kcal` : ""}
            {a.elev_gain > 0 ? ` · ↑${Math.round(a.elev_gain)}m` : ""}
          </Text>
        </Pressable>
      ))}

      {pages > 1 ? (
        <View className="flex-row items-center justify-between pt-1">
          <Pressable disabled={cur === 0} onPress={() => setPage((p) => Math.max(0, p - 1))} hitSlop={6}>
            <Text variant="caption" className={cur === 0 ? "text-text-muted" : "text-teal"}>‹ Prev</Text>
          </Pressable>
          <Text variant="micro" className="tabular-nums text-text-muted">Page {cur + 1} of {pages}</Text>
          <Pressable disabled={cur >= pages - 1} onPress={() => setPage((p) => Math.min(pages - 1, p + 1))} hitSlop={6}>
            <Text variant="caption" className={cur >= pages - 1 ? "text-text-muted" : "text-teal"}>Next ›</Text>
          </Pressable>
        </View>
      ) : null}

      <ActivityDetailModal activity={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}
