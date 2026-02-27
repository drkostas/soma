"use client";

import { useMemo } from "react";
import Map, { Source, Layer } from "react-map-gl/maplibre";
import type { LayerProps } from "react-map-gl/maplibre";
import type { FeatureCollection, Feature, LineString, Point } from "geojson";
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

// Pace color expression: red (fast) → amber (medium) → cyan (slow), min/km scale
const paceColorExpr = [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "pace"], 5.5],
  3.5, "#ff1744",
  5.0, "#ffab00",
  7.0, "#00e5ff",
];

// Subtle outer glow — reduced to be less "neon disco"
const glowOuterLayer: LayerProps = {
  id: "route-glow-outer",
  type: "line",
  paint: {
    "line-width": 10,
    "line-opacity": 0.06,
    "line-color": paceColorExpr as any,
    "line-blur": 6,
  },
  layout: { "line-cap": "round", "line-join": "round" },
};

const glowMidLayer: LayerProps = {
  id: "route-glow-mid",
  type: "line",
  paint: {
    "line-width": 4,
    "line-opacity": 0.22,
    "line-color": paceColorExpr as any,
    "line-blur": 2,
  },
  layout: { "line-cap": "round", "line-join": "round" },
};

// Core line — fixed 2.5px width, colour carries all the pace info
const coreLayers: LayerProps = {
  id: "route-core",
  type: "line",
  paint: {
    "line-width": 2.5,
    "line-opacity": 1.0,
    "line-color": paceColorExpr as any,
  },
  layout: { "line-cap": "round", "line-join": "round" },
};

// Start (green) / end (red) dot layers
const startEndCircleLayer: LayerProps = {
  id: "start-end-circle",
  type: "circle",
  paint: {
    "circle-radius": 5,
    "circle-color": ["match", ["get", "markerType"], "start", "#22c55e", "#ef4444"],
    "circle-stroke-width": 2,
    "circle-stroke-color": "#ffffff",
    "circle-opacity": 0.95,
  },
};

function buildRouteGeoJSON(points: GpsPoint[]): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const speedMs = a.speed ?? b.speed;
    const pace = speedMs && speedMs > 0.3 ? 1000 / speedMs / 60 : null;
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

function buildStartEndGeoJSON(points: GpsPoint[]): FeatureCollection<Point> {
  const first = points[0];
  const last = points[points.length - 1];
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { markerType: "start" },
        geometry: { type: "Point", coordinates: [first.lng, first.lat] },
      },
      {
        type: "Feature",
        properties: { markerType: "end" },
        geometry: { type: "Point", coordinates: [last.lng, last.lat] },
      },
    ],
  };
}

export function RunMap({ points, height = 340 }: RunMapProps) {
  const routeGeoJSON = useMemo(() => buildRouteGeoJSON(points), [points]);
  const startEndGeoJSON = useMemo(() => buildStartEndGeoJSON(points), [points]);

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
    <div style={{ position: "relative", height, borderRadius: 8, overflow: "hidden" }}>
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
        <Source id="start-end" type="geojson" data={startEndGeoJSON}>
          <Layer {...startEndCircleLayer} />
        </Source>
      </Map>

      {/* Pace legend */}
      <div style={{
        position: "absolute",
        bottom: 10,
        left: 10,
        background: "rgba(15,15,15,0.78)",
        backdropFilter: "blur(4px)",
        borderRadius: 6,
        padding: "5px 8px",
        pointerEvents: "none",
      }}>
        <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 3, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          Pace
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 9, color: "#ff1744" }}>Fast</span>
          <div style={{
            width: 50,
            height: 4,
            borderRadius: 2,
            background: "linear-gradient(to right, #ff1744, #ffab00, #00e5ff)",
          }} />
          <span style={{ fontSize: 9, color: "#00e5ff" }}>Slow</span>
        </div>
      </div>
    </div>
  );
}
