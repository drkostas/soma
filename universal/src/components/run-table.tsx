import { useMemo, useState } from "react";
import { View, Pressable } from "react-native";
import { Text, Card } from "soma-style";
import { ActivityDetailModal } from "./activity-detail-modal";
import type { ActivityRow } from "../lib/api";

/** One run row — structurally matches the screen's RecentRun. */
export interface RunRow {
  activity_id: string;
  date: string | null;
  name: string | null;
  distance: number | null; // km
  duration_min: number | null;
  pace: number | null; // min/km
  avg_hr: number | null;
  calories: number | null;
}

type SortKey = "date" | "distance" | "duration_min" | "pace" | "avg_hr" | "calories";
const COLS: { key: SortKey; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "distance", label: "Dist" },
  { key: "duration_min", label: "Time" },
  { key: "pace", label: "Pace" },
  { key: "avg_hr", label: "HR" },
  { key: "calories", label: "Cal" },
];

const num = (v: number | null | undefined): number => (v == null ? 0 : Number(v));
function paceLabel(mins: number | null | undefined): string {
  if (mins == null || !isFinite(mins)) return "—";
  const t = Math.round(mins * 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
/** Adapt a run row into the ActivityRow the rich detail modal expects. The
 *  modal fetches /api/activity/<id> for splits, HR zones, weather, gear and
 *  running dynamics; these row fields seed its header + overview metrics. */
function toActivityRow(r: RunRow): ActivityRow {
  return {
    activity_id: r.activity_id,
    type_key: "running",
    sport: "Running",
    date: r.date ?? "",
    name: r.name,
    distance_km: r.distance,
    duration_min: r.duration_min,
    avg_hr: r.avg_hr,
    calories: r.calories,
    elev_gain: 0,
  };
}

/**
 * Sortable, tap-to-detail run table (web parity, #436). Replaces the plain
 * "Recent Runs" list: tap a column header to sort (tap again to reverse),
 * tap a row to open its detail modal. Fed by the screen's recentRuns.
 */
export function RunTable({ runs }: { runs: RunRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);
  const [selected, setSelected] = useState<RunRow | null>(null);

  const sorted = useMemo(() => {
    const arr = [...(runs ?? [])];
    arr.sort((a, b) => {
      let av: number, bv: number;
      if (sortKey === "date") { av = a.date ? new Date(a.date).getTime() : 0; bv = b.date ? new Date(b.date).getTime() : 0; }
      else { av = num(a[sortKey]); bv = num(b[sortKey]); }
      return asc ? av - bv : bv - av;
    });
    return arr;
  }, [runs, sortKey, asc]);

  if (!runs || runs.length === 0) return null;

  const onHeader = (k: SortKey) => {
    if (k === sortKey) setAsc((v) => !v);
    else { setSortKey(k); setAsc(k === "pace"); } // pace defaults ascending (fastest first)
  };

  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Runs</Text>
        <Text variant="micro" className="text-text-muted">{runs.length} · tap to sort / open</Text>
      </View>

      {/* Sortable column chips (all 6 sortable; 3 are shown as aligned columns) */}
      <View className="flex-row flex-wrap gap-x-3 gap-y-1 border-b border-border-subtle pb-1.5">
        {COLS.map((c) => (
          <Pressable key={c.key} onPress={() => onHeader(c.key)} hitSlop={4}>
            <Text variant="micro" className={sortKey === c.key ? "text-teal" : "text-text-muted"}>
              {c.label}{sortKey === c.key ? (asc ? " ↑" : " ↓") : ""}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Rows */}
      {sorted.map((r) => (
        <Pressable key={r.activity_id} onPress={() => setSelected(r)} className="flex-row items-center border-b border-border-subtle py-2">
          <View className="flex-1 pr-2">
            <Text variant="caption" className="text-text" numberOfLines={1}>{r.name ?? "Run"}</Text>
            <Text variant="micro" className="text-text-muted">
              {shortDate(r.date)}
              {r.duration_min != null ? ` · ${Math.round(num(r.duration_min))} min` : ""}
              {r.calories != null && r.calories > 0 ? ` · ${Math.round(num(r.calories))} kcal` : ""}
            </Text>
          </View>
          <Text variant="caption" className="w-14 text-right tabular-nums text-text">
            {r.distance != null ? `${num(r.distance).toFixed(1)}` : "—"}
          </Text>
          <Text variant="caption" className="w-14 text-right tabular-nums text-lime">
            {r.pace != null ? paceLabel(r.pace) : "—"}
          </Text>
          <Text variant="caption" className="w-12 text-right tabular-nums text-danger">
            {r.avg_hr != null ? Math.round(num(r.avg_hr)) : "—"}
          </Text>
        </Pressable>
      ))}

      <ActivityDetailModal activity={selected ? toActivityRow(selected) : null} onClose={() => setSelected(null)} />
    </Card>
  );
}
