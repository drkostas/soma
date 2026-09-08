import { useState } from "react";
import { View, Pressable } from "react-native";
import { Text, Card } from "soma-style";
import { RouteThumb } from "./route-thumb";
import { ActivityDetailModal } from "./activity-detail-modal";
import type { RouteItem, RoutePoint, ActivityRow } from "../lib/api";

/** Web's gallery caption pace (mm:ss /km from distance + duration). */
function formatPace(distanceKm: number | null, durationS: number | null): string {
  if (!distanceKm || !durationS) return "";
  const secPerKm = Math.round(durationS / distanceKm);
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, "0")}`;
}
function shortDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
/** Adapt a recent-route item into the ActivityRow the full detail modal expects
 *  (it fetches /api/activity/<id> for map/splits/HR-zones/charts) — matching web,
 *  where a route thumbnail opens the full ActivityDetailModal, not a mini preview. */
function toActivityRow(r: RouteItem): ActivityRow {
  return {
    activity_id: r.activity_id,
    type_key: "running",
    sport: "Running",
    date: r.date ?? "",
    name: r.name,
    distance_km: r.distance_km,
    duration_min: r.duration_s != null ? r.duration_s / 60 : null,
    avg_hr: null,
    calories: null,
    elev_gain: 0,
  };
}

/** Recent-runs route gallery (SVG route shapes), fed by /api/running/recent-routes. */
export function RunningRoutes({ routes }: { routes: RouteItem[] }) {
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<RouteItem | null>(null);
  const withGps = (routes ?? []).filter((r) => (r.gps_points?.length ?? 0) >= 2);
  if (!withGps.length) return null;
  const shown = showAll ? withGps : withGps.slice(0, 6);

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Recent routes</Text>
        <Text variant="micro" className="text-text-muted">{withGps.length} routes · tap to open</Text>
      </View>
      <View className="flex-row flex-wrap gap-3">
        {shown.map((r, i) => (
          <Pressable key={r.activity_id} className="min-w-[46%] flex-1 gap-1" onPress={() => setSelected(r)} testID={`route-thumb-${i}`}>
            <RouteThumb points={r.gps_points} />
            <Text variant="micro" className="text-text-secondary" numberOfLines={1}>{r.name || "Run"}</Text>
            <Text variant="micro" className="text-text-muted">
              {shortDate(r.date)}{r.distance_km != null ? ` · ${r.distance_km.toFixed(1)} km` : ""}{formatPace(r.distance_km, r.duration_s) ? ` · ${formatPace(r.distance_km, r.duration_s)} /km` : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      {withGps.length > 6 ? (
        <Pressable onPress={() => setShowAll((v) => !v)} className="self-start">
          <Text variant="caption" className="text-teal">{showAll ? "Show fewer" : `Show all ${withGps.length}`}</Text>
        </Pressable>
      ) : null}
      <ActivityDetailModal activity={selected ? toActivityRow(selected) : null} onClose={() => setSelected(null)} />
    </Card>
  );
}
