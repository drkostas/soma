import { View } from "react-native";
import { Text, Card, Modal, Badge } from "soma-style";
import type { ActivityRow } from "../lib/api";

const num = (v: number | null | undefined): number => (v == null ? 0 : Number(v));
function longDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function hm(mins: number | null | undefined): string {
  if (mins == null || !isFinite(mins)) return "—";
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Activity detail dialog (web parity, #441): the full stat line for one
 * activity (the drill-in behind a table row). The web modal also offers a
 * Strava photo upload + FIT download — those are native/file features left as
 * a documented mobile trim.
 */
export function ActivityDetailModal({ activity, onClose }: { activity: ActivityRow | null; onClose: () => void }) {
  if (!activity) return null;
  const a = activity;
  const rows: [string, string][] = [
    ["Sport", a.sport],
    ["Distance", a.distance_km != null && a.distance_km > 0 ? `${num(a.distance_km).toFixed(2)} km` : "—"],
    ["Duration", hm(a.duration_min)],
    ["Avg HR", a.avg_hr != null ? `${Math.round(num(a.avg_hr))} bpm` : "—"],
    ["Calories", a.calories != null && a.calories > 0 ? `${Math.round(num(a.calories))} kcal` : "—"],
    ["Elevation", a.elev_gain > 0 ? `↑ ${Math.round(a.elev_gain)} m` : "—"],
  ];
  return (
    <Modal visible={!!activity} onClose={onClose} title={a.name || a.sport}>
      <View className="gap-3">
        <View className="flex-row items-center gap-2">
          <Badge label={a.sport} tone="teal" />
          <Text variant="micro" className="text-text-muted">{longDate(a.date)}</Text>
        </View>
        <View className="gap-2">
          {rows.map(([label, value]) => (
            <View key={label} className="flex-row items-center justify-between border-b border-border-subtle py-1.5">
              <Text variant="body" className="text-text-secondary">{label}</Text>
              <Text variant="body" className="tabular-nums text-text">{value}</Text>
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}
