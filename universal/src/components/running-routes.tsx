import { useState } from "react";
import { View, Pressable } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { Text, Card, Modal } from "soma-style";
import type { RouteItem, RoutePoint } from "../lib/api";

function shortDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function paceLabel(mins: number | null): string {
  if (mins == null || !isFinite(mins)) return "—";
  const t = Math.round(mins * 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** One route's GPS path as a normalized SVG polyline (north up), no map tiles. */
function RouteThumb({ points, stroke = 2 }: { points: RoutePoint[]; stroke?: number }) {
  const pts = points.filter((p) => isFinite(p.lat) && isFinite(p.lng));
  const step = Math.max(1, Math.floor(pts.length / 80));
  const s = pts.filter((_, i) => i % step === 0);
  if (s.length < 2) return <View className="h-24 rounded-lg bg-surface-subtle" />;
  const lats = s.map((p) => p.lat), lngs = s.map((p) => p.lng);
  const minLa = Math.min(...lats), maxLa = Math.max(...lats);
  const minLo = Math.min(...lngs), maxLo = Math.max(...lngs);
  const rLa = maxLa - minLa || 1e-6, rLo = maxLo - minLo || 1e-6;
  const poly = s
    .map((p) => `${((p.lng - minLo) / rLo) * 92 + 4},${(1 - (p.lat - minLa) / rLa) * 92 + 4}`)
    .join(" ");
  return (
    <View className="h-24 rounded-lg bg-surface-subtle overflow-hidden">
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <Polyline points={poly} fill="none" stroke="#77c8d1" strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
    </View>
  );
}

/** Enlarged route + stats (drill-in behind a thumbnail). */
function RouteDetailModal({ route, onClose }: { route: RouteItem | null; onClose: () => void }) {
  if (!route) return null;
  const km = route.distance_km;
  const durMin = route.duration_s != null ? route.duration_s / 60 : null;
  const pace = km && durMin ? durMin / km : null;
  const rows: [string, string][] = [
    ["Distance", km != null ? `${km.toFixed(2)} km` : "—"],
    ["Duration", durMin != null ? `${Math.round(durMin)} min` : "—"],
    ["Avg pace", pace != null ? `${paceLabel(pace)} /km` : "—"],
  ];
  return (
    <Modal visible={!!route} onClose={onClose} title={route.name ?? "Run"}>
      <View className="gap-3">
        <View className="rounded-lg bg-surface-subtle overflow-hidden" style={{ aspectRatio: 1 }}>
          <RouteThumb points={route.gps_points} stroke={2.4} />
        </View>
        <Text variant="micro" className="text-text-muted">{shortDate(route.date)}</Text>
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
        {shown.map((r) => (
          <Pressable key={r.activity_id} className="min-w-[46%] flex-1 gap-1" onPress={() => setSelected(r)}>
            <RouteThumb points={r.gps_points} />
            <Text variant="micro" className="text-text-secondary" numberOfLines={1}>{r.name || "Run"}</Text>
            <Text variant="micro" className="text-text-muted">
              {shortDate(r.date)}{r.distance_km != null ? ` · ${r.distance_km.toFixed(1)} km` : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      {withGps.length > 6 ? (
        <Pressable onPress={() => setShowAll((v) => !v)} className="self-start">
          <Text variant="caption" className="text-teal">{showAll ? "Show fewer" : `Show all ${withGps.length}`}</Text>
        </Pressable>
      ) : null}
      <RouteDetailModal route={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}
