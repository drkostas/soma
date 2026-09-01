import { View } from "react-native";
import Svg, { Polyline, Circle, Defs, LinearGradient, Stop, Rect as SvgRect } from "react-native-svg";
import { Text } from "soma-style";

/** One GPS sample of a run/ride. lat+lng required; speed drives pace colour. */
export interface RoutePoint { lat: number; lng: number; speed?: number | null }

// Pace colour ramp (min/km): red fast → amber → cyan slow. Mirrors web run-map.
function paceColor(pace: number | null): string {
  if (pace == null) return "#77c8d1";
  const stops: [number, [number, number, number]][] = [
    [3.5, [255, 23, 68]], [5.0, [255, 171, 0]], [7.0, [0, 229, 255]],
  ];
  if (pace <= stops[0][0]) return "#ff1744";
  if (pace >= stops[2][0]) return "#00e5ff";
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i], [p1, c1] = stops[i + 1];
    if (pace >= p0 && pace <= p1) {
      const t = (pace - p0) / (p1 - p0);
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return "#77c8d1";
}

/**
 * Single-route map (Expo-web fallback for route-map.native.tsx): draws the
 * activity's GPS trace as an aspect-corrected SVG polyline coloured by pace,
 * with green/red start/end dots. No map library (native gets the real MapLibre
 * basemap). Fed by /api/activity/[id].gps_route.
 */
export function RouteMap({ points, height = 300 }: { points: RoutePoint[]; height?: number }) {
  const pts = (points ?? []).filter((p) => p && isFinite(p.lat) && isFinite(p.lng));
  if (pts.length < 2) return null;

  let minLo = Infinity, maxLo = -Infinity, minLa = Infinity, maxLa = -Infinity;
  for (const p of pts) { if (p.lng < minLo) minLo = p.lng; if (p.lng > maxLo) maxLo = p.lng; if (p.lat < minLa) minLa = p.lat; if (p.lat > maxLa) maxLa = p.lat; }
  const rLa = maxLa - minLa || 1e-6;
  const midLa = (minLa + maxLa) / 2;
  const cos = Math.max(0.2, Math.cos((midLa * Math.PI) / 180));
  const spanLo = (maxLo - minLo) * cos || 1e-6;
  const span = Math.max(spanLo, rLa) || 1e-6;
  const offX = (100 - (spanLo / span) * 92) / 2;
  const offY = (100 - (rLa / span) * 92) / 2;
  const X = (lng: number) => offX + ((lng - minLo) * cos / span) * 92;
  const Y = (lat: number) => offY + (1 - (lat - minLa) / span) * 92;

  // Downsample to ~120 segments for pace-coloured polyline chunks.
  const step = Math.max(1, Math.floor(pts.length / 120));
  const s = pts.filter((_, i) => i % step === 0);
  if (s[s.length - 1] !== pts[pts.length - 1]) s.push(pts[pts.length - 1]);
  const segs: { d: string; color: string }[] = [];
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], b = s[i + 1];
    const sp = a.speed ?? b.speed;
    const pace = sp != null && sp > 0.3 ? 1000 / sp / 60 : null;
    segs.push({ d: `${X(a.lng).toFixed(2)},${Y(a.lat).toFixed(2)} ${X(b.lng).toFixed(2)},${Y(b.lat).toFixed(2)}`, color: paceColor(pace) });
  }
  const first = pts[0], last = pts[pts.length - 1];

  return (
    <View className="gap-1.5">
      <View className="relative rounded-lg bg-surface-subtle overflow-hidden" style={{ height }}>
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
          {segs.map((sg, i) => (
            <Polyline key={i} points={sg.d} fill="none" stroke={sg.color} strokeWidth={1.1} strokeOpacity={0.95} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          <Circle cx={X(first.lng)} cy={Y(first.lat)} r={2} fill="#22c55e" stroke="#ffffff" strokeWidth={0.6} />
          <Circle cx={X(last.lng)} cy={Y(last.lat)} r={2} fill="#ef4444" stroke="#ffffff" strokeWidth={0.6} />
        </Svg>
        {/* Pace legend */}
        <View className="absolute bottom-2 left-2 rounded-md px-2 py-1" style={{ backgroundColor: "rgba(15,20,26,0.8)" }}>
          <Text variant="micro" className="text-text-muted">Pace</Text>
          <View className="flex-row items-center gap-1.5">
            <Text variant="micro" style={{ color: "#ff1744" }}>Fast</Text>
            <Svg width={50} height={4}>
              <Defs>
                <LinearGradient id="paceleg-web" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#ff1744" />
                  <Stop offset="0.5" stopColor="#ffab00" />
                  <Stop offset="1" stopColor="#00e5ff" />
                </LinearGradient>
              </Defs>
              <SvgRect width={50} height={4} rx={2} fill="url(#paceleg-web)" />
            </Svg>
            <Text variant="micro" style={{ color: "#00e5ff" }}>Slow</Text>
          </View>
        </View>
      </View>
      <Text variant="micro" className="text-text-muted">GPS route · green start, red finish · colour = pace.</Text>
    </View>
  );
}
