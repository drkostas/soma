"use client";

import { useMemo } from "react";
import Map, { Source, Layer } from "react-map-gl/maplibre";
import type { LayerProps } from "react-map-gl/maplibre";
import type { FeatureCollection, Feature, LineString } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

export interface GpsPoint {
  lat: number;
  lng: number;
  hr: number | null;
  speed: number | null;
  elev: number | null;
  cadence: number | null;
  dist_m: number | null;
}

interface RunMapProps {
  points: GpsPoint[];
  height?: number;
}

// Pace color expression: cyan (fast) → amber (medium) → red (slow), min/km scale
const paceColorExpr = [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "pace"], 5.5],
  3.5, "#00e5ff",
  5.0, "#ffab00",
  7.0, "#ff1744",
];

// HR-based line width for the core layer
const hrWidthExpr = [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "hr"], 150],
  0, 1.5,
  130, 1.5,
  145, 2.5,
  160, 3.5,
  175, 4.5,
];

const glowOuterLayer: LayerProps = {
  id: "route-glow-outer",
  type: "line",
  paint: {
    "line-width": 18,
    "line-opacity": 0.07,
    "line-color": paceColorExpr as any,
    "line-blur": 8,
  },
  layout: { "line-cap": "round", "line-join": "round" },
};

const glowMidLayer: LayerProps = {
  id: "route-glow-mid",
  type: "line",
  paint: {
    "line-width": 7,
    "line-opacity": 0.32,
    "line-color": paceColorExpr as any,
    "line-blur": 3,
  },
  layout: { "line-cap": "round", "line-join": "round" },
};

const coreLayers: LayerProps = {
  id: "route-core",
  type: "line",
  paint: {
    "line-width": hrWidthExpr as any,
    "line-opacity": 1.0,
    "line-color": paceColorExpr as any,
  },
  layout: { "line-cap": "round", "line-join": "round" },
};

function buildRouteGeoJSON(points: GpsPoint[]): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const speedMs = a.speed ?? b.speed;
    const pace =
      speedMs && speedMs > 0.3 ? 1000 / speedMs / 60 : null;
    features.push({
      type: "Feature",
      properties: { pace, hr: a.hr ?? null },
      geometry: {
        type: "LineString",
        coordinates: [
          [a.lng, a.lat],
          [b.lng, b.lat],
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

export function RunMap({ points, height = 340 }: RunMapProps) {
  const routeGeoJSON = useMemo(() => buildRouteGeoJSON(points), [points]);

  const bounds = useMemo((): [[number, number], [number, number]] | null => {
    if (points.length < 2) return null;
    const lngs = points.map((p) => p.lng);
    const lats = points.map((p) => p.lat);
    return [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ];
  }, [points]);

  if (!bounds) return null;

  return (
    <div style={{ height, borderRadius: 8, overflow: "hidden" }}>
      <Map
        initialViewState={{
          bounds,
          fitBoundsOptions: { padding: 48 },
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        interactive={false}
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
      >
        <Source id="route" type="geojson" data={routeGeoJSON}>
          <Layer {...glowOuterLayer} />
          <Layer {...glowMidLayer} />
          <Layer {...coreLayers} />
        </Source>
      </Map>
    </div>
  );
}
