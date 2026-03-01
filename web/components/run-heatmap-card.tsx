"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const RunHeatmap = dynamic(
  () => import("@/components/run-heatmap").then((m) => m.RunHeatmap),
  { ssr: false, loading: () => <div className="bg-muted animate-pulse rounded-lg" style={{ height: 380 }} /> }
);

export function RunHeatmapCard() {
  const [routes, setRoutes] = useState<Array<Array<[number, number]>> | null>(null);

  useEffect(() => {
    fetch("/api/running/heatmap")
      .then((r) => r.json())
      .then((d) => setRoutes(d.routes ?? []))
      .catch(() => setRoutes([]));
  }, []);

  if (routes === null) {
    return <div className="bg-muted animate-pulse rounded-lg" style={{ height: 380 }} />;
  }
  if (!routes.length) return null;

  return <RunHeatmap routes={routes} height={380} />;
}
