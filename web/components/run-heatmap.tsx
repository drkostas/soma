"use client";

import { useMemo } from "react";
import Map, { Source, Layer } from "react-map-gl/maplibre";
import type { LayerProps } from "react-map-gl/maplibre";
import type { FeatureCollection, LineString } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

interface Props {
  routes: Array<Array<[number, number]>>; // array of [lng, lat] arrays
  height?: number;
}

const heatLineLayer: LayerProps = {
  id: "heatmap-lines",
  type: "line",
  paint: {
    "line-color": "hsl(166, 80%, 65%)", // teal, matches primary
    "line-width": 2,
    "line-opacity": 0.4,
  },
  layout: { "line-cap": "round", "line-join": "round" },
};

// Filter routes to the primary running area (largest geographic cluster).
// Computes the centroid of each route, finds the median centroid, then
// keeps only routes whose centroid is within 1.5° (~160km) of the median.
function filterToMainCluster(routes: Array<Array<[number, number]>>) {
  if (!routes.length) return routes;
  const centroids = routes.map((r) => {
    const lngs = r.map((p) => p[0]);
    const lats = r.map((p) => p[1]);
    return [
      lngs.reduce((a, b) => a + b, 0) / lngs.length,
      lats.reduce((a, b) => a + b, 0) / lats.length,
    ] as [number, number];
  });
  const sortedLngs = centroids.map((c) => c[0]).sort((a, b) => a - b);
  const sortedLats = centroids.map((c) => c[1]).sort((a, b) => a - b);
  const medLng = sortedLngs[Math.floor(sortedLngs.length / 2)];
  const medLat = sortedLats[Math.floor(sortedLats.length / 2)];
  const RADIUS = 1.5; // degrees (~160km)
  return routes.filter((_, i) => {
    const [cLng, cLat] = centroids[i];
    return Math.abs(cLng - medLng) < RADIUS && Math.abs(cLat - medLat) < RADIUS;
  });
}

export function RunHeatmap({ routes, height = 380 }: Props) {
  const mainRoutes = useMemo(() => filterToMainCluster(routes), [routes]);

  const geojson = useMemo((): FeatureCollection<LineString> => ({
    type: "FeatureCollection",
    features: mainRoutes.map((coords) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords },
    })),
  }), [mainRoutes]);

  const bounds = useMemo((): [[number, number], [number, number]] | null => {
    const allLng: number[] = [];
    const allLat: number[] = [];
    for (const route of mainRoutes) {
      for (const [lng, lat] of route) {
        allLng.push(lng);
        allLat.push(lat);
      }
    }
    if (!allLng.length) return null;
    return [
      [Math.min(...allLng), Math.min(...allLat)],
      [Math.max(...allLng), Math.max(...allLat)],
    ];
  }, [mainRoutes]);

  if (!bounds) return null;

  return (
    <div style={{ position: "relative", height, borderRadius: 8, overflow: "hidden" }}>
      <Map
        initialViewState={{ bounds, fitBoundsOptions: { padding: 40 } }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        interactive={false}
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
      >
        <Source id="heatmap" type="geojson" data={geojson}>
          <Layer {...heatLineLayer} />
        </Source>
      </Map>
      <div style={{
        position: "absolute",
        bottom: 10,
        right: 10,
        background: "rgba(15,15,15,0.75)",
        backdropFilter: "blur(4px)",
        borderRadius: 6,
        padding: "4px 8px",
        pointerEvents: "none",
        fontSize: 10,
        color: "#9ca3af",
        letterSpacing: "0.05em",
      }}>
        {mainRoutes.length} runs
      </div>
    </div>
  );
}
