import { useMemo } from "react";
import { View } from "react-native";
import { Text } from "soma-style";
import { Map, Camera, GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import Svg, { Defs, LinearGradient, Stop, Rect as SvgRect } from "react-native-svg";

/** One GPS sample of a run/ride. lat+lng required; speed drives pace colour. */
export interface RoutePoint { lat: number; lng: number; speed?: number | null }

/** OpenFreeMap dark vector basemap — free, no API key, matches run-heatmap. */
const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";

// Pace colour ramp (min/km): red fast → amber → cyan slow. Mirrors web run-map.
// Cast to `any` like the web run-map — the style-spec expression tuple types
// are too strict to satisfy inline (@maplibre/maplibre-react-native v11).
const PACE_COLOR: any = [
  "interpolate", ["linear"], ["coalesce", ["get", "pace"], 5.5],
  3.5, "#ff1744", 5.0, "#ffab00", 7.0, "#00e5ff",
];
const END_COLOR: any = ["match", ["get", "markerType"], "start", "#22c55e", "#ef4444"];

type LineF = { type: "Feature"; properties: { pace: number | null }; geometry: { type: "LineString"; coordinates: [number, number][] } };
type PointF = { type: "Feature"; properties: { markerType: "start" | "end" }; geometry: { type: "Point"; coordinates: [number, number] } };

/**
 * Single-route map (native, web run-map.tsx parity): the activity's GPS trace on
 * a real MapLibre vector basemap, coloured by pace (red fast → cyan slow) with a
 * subtle glow and green/red start/end dots. Camera fits the route. The web SVG
 * fallback (route-map.tsx) is used on Expo web. Fed by /api/activity/[id].gps_route.
 */
export function RouteMap({ points, height = 300 }: { points: RoutePoint[]; height?: number }) {
  const { routes, ends, bounds } = useMemo(() => {
    const pts = (points ?? []).filter((p) => p && isFinite(p.lat) && isFinite(p.lng));
    if (pts.length < 2) return { routes: null as null | { type: "FeatureCollection"; features: LineF[] }, ends: null as null | { type: "FeatureCollection"; features: PointF[] }, bounds: null as null | [number, number, number, number] };
    // Downsample long tracks (~300 segments max) so the emulator stays smooth.
    const step = Math.max(1, Math.floor(pts.length / 300));
    const sampled = pts.filter((_, i) => i % step === 0);
    if (sampled[sampled.length - 1] !== pts[pts.length - 1]) sampled.push(pts[pts.length - 1]);
    const features: LineF[] = [];
    let w = Infinity, s = Infinity, e = -Infinity, nn = -Infinity;
    for (let i = 0; i < sampled.length - 1; i++) {
      const a = sampled[i], b = sampled[i + 1];
      const sp = a.speed ?? b.speed;
      const pace = sp != null && sp > 0.3 ? 1000 / sp / 60 : null;
      features.push({ type: "Feature", properties: { pace }, geometry: { type: "LineString", coordinates: [[a.lng, a.lat], [b.lng, b.lat]] } });
    }
    for (const p of sampled) { if (p.lng < w) w = p.lng; if (p.lng > e) e = p.lng; if (p.lat < s) s = p.lat; if (p.lat > nn) nn = p.lat; }
    const first = sampled[0], last = sampled[sampled.length - 1];
    return {
      routes: { type: "FeatureCollection" as const, features },
      ends: { type: "FeatureCollection" as const, features: [
        { type: "Feature" as const, properties: { markerType: "start" as const }, geometry: { type: "Point" as const, coordinates: [first.lng, first.lat] as [number, number] } },
        { type: "Feature" as const, properties: { markerType: "end" as const }, geometry: { type: "Point" as const, coordinates: [last.lng, last.lat] as [number, number] } },
      ] },
      bounds: [w, s, e, nn] as [number, number, number, number],
    };
  }, [points]);

  if (!bounds || !routes) return null;

  return (
    <View className="gap-1.5">
      <View className="relative rounded-lg overflow-hidden" style={{ height }}>
        {/* Gestures locked to match web run-map (interactive={false}); a pannable
            map inside the modal ScrollView would also trap vertical scroll drags. */}
        <Map style={{ flex: 1 }} mapStyle={DARK_STYLE} attribution={false} logo={false}
          dragPan={false} touchZoom={false} doubleTapZoom={false} doubleTapHoldZoom={false} touchRotate={false} touchPitch={false}>
          <Camera bounds={bounds} padding={{ top: 48, bottom: 48, left: 48, right: 48 }} />
          <GeoJSONSource id="route" data={routes}>
            {/* Two-layer glow + core, matching web run-map.tsx exactly. */}
            <Layer id="route-glow-outer" type="line" paint={{ "line-color": PACE_COLOR, "line-width": 10, "line-opacity": 0.06, "line-blur": 6 }} layout={{ "line-cap": "round", "line-join": "round" }} />
            <Layer id="route-glow-mid" type="line" paint={{ "line-color": PACE_COLOR, "line-width": 4, "line-opacity": 0.22, "line-blur": 2 }} layout={{ "line-cap": "round", "line-join": "round" }} />
            <Layer id="route-core" type="line" paint={{ "line-color": PACE_COLOR, "line-width": 2.5, "line-opacity": 1 }} layout={{ "line-cap": "round", "line-join": "round" }} />
          </GeoJSONSource>
          {ends ? (
            <GeoJSONSource id="route-ends" data={ends}>
              <Layer id="route-end-dots" type="circle" paint={{
                "circle-radius": 5,
                "circle-color": END_COLOR,
                "circle-stroke-width": 2, "circle-stroke-color": "#ffffff", "circle-opacity": 0.95,
              }} />
            </GeoJSONSource>
          ) : null}
        </Map>
        {/* Pace legend */}
        <View className="absolute bottom-2 left-2 rounded-md px-2 py-1" style={{ backgroundColor: "rgba(15,20,26,0.8)" }}>
          <Text variant="micro" className="text-text-muted">Pace</Text>
          <View className="flex-row items-center gap-1.5">
            <Text variant="micro" style={{ color: "#ff1744" }}>Fast</Text>
            <Svg width={50} height={4}>
              <Defs>
                <LinearGradient id="paceleg" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#ff1744" />
                  <Stop offset="0.5" stopColor="#ffab00" />
                  <Stop offset="1" stopColor="#00e5ff" />
                </LinearGradient>
              </Defs>
              <SvgRect width={50} height={4} rx={2} fill="url(#paceleg)" />
            </Svg>
            <Text variant="micro" style={{ color: "#00e5ff" }}>Slow</Text>
          </View>
        </View>
      </View>
      <Text variant="micro" className="text-text-muted">GPS route · green start, red finish · colour = pace.</Text>
    </View>
  );
}
