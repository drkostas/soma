import { useMemo } from "react";
import { View } from "react-native";
import { Text, Card } from "soma-style";
import { Map, Camera, GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import type { HeatRoute } from "../lib/api";

/** OpenFreeMap dark vector basemap — free, no API key, beautiful streets/labels. */
const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";

type Feature = { type: "Feature"; geometry: { type: "LineString"; coordinates: [number, number][] }; properties: Record<string, never> };

/**
 * Route heatmap (native): recent run GPS paths overlaid on a real MapLibre
 * vector basemap (OpenFreeMap dark), matching the web's map. Fits to the
 * dominant location cluster so a run abroad doesn't zoom out to the whole world.
 * The web SVG fallback (run-heatmap.tsx) is used instead. Fed by
 * /api/running/heatmap.
 */
export function RunHeatmap({ routes }: { routes: HeatRoute[] }) {
  const valid = (routes ?? []).filter((r) => Array.isArray(r) && r.length >= 2);

  const { geojson, bounds, count } = useMemo(() => {
    // Per-route center (mean of its points), aligned to `valid`.
    const centers = valid.map((r) => {
      let slng = 0, slat = 0, c = 0;
      for (const [lng, lat] of r) if (isFinite(lng) && isFinite(lat)) { slng += lng; slat += lat; c++; }
      return c ? ([slng / c, slat / c] as [number, number]) : null;
    });
    const lngs = centers.filter((c): c is [number, number] => !!c).map((c) => c[0]).sort((a, b) => a - b);
    const lats = centers.filter((c): c is [number, number] => !!c).map((c) => c[1]).sort((a, b) => a - b);
    const empty = { geojson: { type: "FeatureCollection" as const, features: [] as Feature[] }, bounds: null as [number, number, number, number] | null, count: 0 };
    if (!lngs.length) return empty;
    const cLng = lngs[Math.floor(lngs.length / 2)];
    const cLat = lats[Math.floor(lats.length / 2)];

    // Keep only the dominant cluster (within ~1.5° of the median center).
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    const features: Feature[] = [];
    valid.forEach((r, i) => {
      const ctr = centers[i];
      if (!ctr || Math.abs(ctr[0] - cLng) > 1.5 || Math.abs(ctr[1] - cLat) > 1.5) return;
      const coordinates: [number, number][] = [];
      for (const [lng, lat] of r) {
        if (!isFinite(lng) || !isFinite(lat)) continue;
        coordinates.push([lng, lat]);
        if (lng < w) w = lng;
        if (lng > e) e = lng;
        if (lat < s) s = lat;
        if (lat > n) n = lat;
      }
      if (coordinates.length >= 2) features.push({ type: "Feature", geometry: { type: "LineString", coordinates }, properties: {} });
    });
    return {
      geojson: { type: "FeatureCollection" as const, features },
      bounds: isFinite(w) ? ([w, s, e, n] as [number, number, number, number]) : null,
      count: features.length,
    };
  }, [valid]);

  if (!bounds || count < 1) return null;

  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Route heatmap</Text>
        <Text variant="micro" className="text-text-muted">{count} routes · last 12 mo</Text>
      </View>
      <View className="rounded-lg overflow-hidden" style={{ aspectRatio: 1 }}>
        <Map style={{ flex: 1 }} mapStyle={DARK_STYLE} attribution={false} logo={false}>
          <Camera bounds={bounds} padding={{ top: 30, bottom: 30, left: 30, right: 30 }} />
          <GeoJSONSource id="routes" data={geojson}>
            <Layer
              id="routeLines"
              type="line"
              paint={{ "line-color": "#77c8d1", "line-width": 1.6, "line-opacity": 0.5 }}
              layout={{ "line-cap": "round", "line-join": "round" }}
            />
          </GeoJSONSource>
        </Map>
      </View>
      <Text variant="micro" className="text-text-muted">Brighter lines = roads you run most.</Text>
    </Card>
  );
}
