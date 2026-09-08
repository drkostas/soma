import { useMemo } from "react";
import { View } from "react-native";
import { Map, Camera, GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import type { RoutePoint } from "../lib/api";
import { DARK_STYLE } from "./map-fullscreen";

/** Static mini MapLibre map of one route — web's Recent Routes gallery draws a real map per
 *  card (RunMap, non-interactive); the SVG polyline stays as the web fallback (soma#793).
 *  Gestures locked so the thumbnail is a plain tap target inside the gallery. */
export function RouteThumb({ points }: { points: RoutePoint[]; stroke?: number }) {
  const { geojson, bounds } = useMemo(() => {
    const pts = (points ?? []).filter((p) => p && isFinite(p.lat) && isFinite(p.lng));
    if (pts.length < 2) return { geojson: null, bounds: null as [number, number, number, number] | null };
    const step = Math.max(1, Math.floor(pts.length / 120));
    const s = pts.filter((_, i) => i % step === 0);
    let w = Infinity, so = Infinity, e = -Infinity, n = -Infinity;
    for (const p of s) { if (p.lng < w) w = p.lng; if (p.lng > e) e = p.lng; if (p.lat < so) so = p.lat; if (p.lat > n) n = p.lat; }
    return {
      geojson: { type: "FeatureCollection" as const, features: [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: s.map((p) => [p.lng, p.lat] as [number, number]) } }] },
      bounds: [w, so, e, n] as [number, number, number, number],
    };
  }, [points]);
  if (!geojson || !bounds) return <View className="h-24 rounded-lg bg-surface-subtle" />;
  return (
    <View className="h-24 rounded-lg overflow-hidden" pointerEvents="none">
      <Map style={{ flex: 1 }} mapStyle={DARK_STYLE} attribution={false} logo={false}
        dragPan={false} touchZoom={false} doubleTapZoom={false} doubleTapHoldZoom={false} touchRotate={false} touchPitch={false}>
        <Camera bounds={bounds} padding={{ top: 10, bottom: 10, left: 10, right: 10 }} />
        <GeoJSONSource id="thumb" data={geojson}>
          <Layer id="thumb-line" type="line" paint={{ "line-color": "#77c8d1", "line-width": 2.2, "line-opacity": 0.95 }} layout={{ "line-cap": "round", "line-join": "round" }} />
        </GeoJSONSource>
      </Map>
    </View>
  );
}
