"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Card } from "@/components/ui/card";
import { ActivityDetailModal } from "@/components/activity-detail-modal";

const RunMap = dynamic(
  () => import("@/components/run-map").then((m) => m.RunMap),
  { ssr: false, loading: () => <div className="h-[140px] bg-muted animate-pulse" /> }
);

interface RouteItem {
  activity_id: string;
  name: string;
  date: string;
  distance_km: number;
  duration_s: number;
  gps_points: Array<{
    lat: number;
    lng: number;
    hr: null;
    speed: number | null;
    elev: null;
    cadence: null;
    dist_m: null;
  }>;
}

function formatPace(distance_km: number, duration_s: number): string {
  if (!distance_km || !duration_s) return "—";
  const paceMin = duration_s / 60 / distance_km;
  const m = Math.floor(paceMin);
  const s = Math.round((paceMin - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function RecentRoutesGallery() {
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(6);

  useEffect(() => {
    fetch("/api/running/recent-routes")
      .then((r) => r.json())
      .then((data) => setRoutes(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  if (!routes.length) return null;

  const visibleRoutes = routes.slice(0, visibleCount);
  const hasMore = visibleCount < routes.length;

  return (
    <>
      <p className="text-xs text-muted-foreground mb-2">{routes.length} routes</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {visibleRoutes.map((run) => {
          const dateStr = run.date.slice(5).replace("-", "/");
          const pace = formatPace(run.distance_km, run.duration_s);
          const hasGps = run.gps_points.length > 10;

          return (
            <Card
              key={run.activity_id}
              className="overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/60 hover:scale-[1.02] transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              onClick={() => setSelectedId(run.activity_id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(run.activity_id); } }}
              tabIndex={0}
              role="button"
            >
              <div className="relative">
                {hasGps ? (
                  <RunMap points={run.gps_points} height={140} />
                ) : (
                  <div className="h-[140px] bg-muted flex items-center justify-center">
                    <span className="text-[11px] text-muted-foreground">No GPS</span>
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 py-1.5 pointer-events-none">
                  <div className="flex items-end justify-between">
                    <span className="text-[10px] text-white/80">{dateStr}</span>
                    <div className="text-right">
                      <div className="text-xs font-semibold text-white leading-tight">
                        {run.distance_km.toFixed(1)} km
                      </div>
                      <div className="text-[10px] text-white/70 font-mono leading-tight">
                        {pace}/km
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {hasMore && (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-3"
          onClick={() => setVisibleCount((c) => c + 6)}
        >
          Show more
        </button>
      )}

      <ActivityDetailModal
        activityId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}
