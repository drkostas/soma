import { View } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import type { RoutePoint } from "../lib/api";

/** One route's GPS path as a normalized SVG polyline (north up), no map tiles — the Expo web
 *  fallback; the .native.tsx twin draws a static MapLibre mini map like web's gallery (soma#793). */
export function RouteThumb({ points, stroke = 2 }: { points: RoutePoint[]; stroke?: number }) {
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
