import { View } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { Text, Card } from "soma-style";
import type { RouteItem, RoutePoint } from "../lib/api";

function shortDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** One route's GPS path as a normalized SVG polyline (north up), no map tiles. */
function RouteThumb({ points }: { points: RoutePoint[] }) {
  const pts = points.filter((p) => isFinite(p.lat) && isFinite(p.lng));
  // sample down to ~80 points for perf
  const step = Math.max(1, Math.floor(pts.length / 80));
  const s = pts.filter((_, i) => i % step === 0);
  if (s.length < 2) return <View className="h-24 rounded-lg bg-surface-subtle" />;
  const lats = s.map((p) => p.lat), lngs = s.map((p) => p.lng);
  const minLa = Math.min(...lats), maxLa = Math.max(...lats);
  const minLo = Math.min(...lngs), maxLo = Math.max(...lngs);
  const rLa = maxLa - minLa || 1e-6, rLo = maxLo - minLo || 1e-6;
  // keep aspect roughly square, pad to 4..96
  const poly = s
    .map((p) => `${((p.lng - minLo) / rLo) * 92 + 4},${(1 - (p.lat - minLa) / rLa) * 92 + 4}`)
    .join(" ");
  return (
    <View className="h-24 rounded-lg bg-surface-subtle overflow-hidden">
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <Polyline points={poly} fill="none" stroke="#77c8d1" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
    </View>
  );
}

/** Recent-runs route gallery (SVG route shapes), fed by /api/running/recent-routes. */
export function RunningRoutes({ routes }: { routes: RouteItem[] }) {
  const withGps = (routes ?? []).filter((r) => (r.gps_points?.length ?? 0) >= 2);
  if (!withGps.length) return null;

  return (
    <Card className="gap-3">
      <Text variant="eyebrow">Recent routes</Text>
      <View className="flex-row flex-wrap gap-3">
        {withGps.slice(0, 6).map((r) => (
          <View key={r.activity_id} className="min-w-[46%] flex-1 gap-1">
            <RouteThumb points={r.gps_points} />
            <Text variant="micro" className="text-text-secondary" numberOfLines={1}>{r.name || "Run"}</Text>
            <Text variant="micro" className="text-text-muted">
              {shortDate(r.date)}{r.distance_km != null ? ` · ${r.distance_km.toFixed(1)} km` : ""}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}
