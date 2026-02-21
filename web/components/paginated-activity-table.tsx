"use client";

import { useState } from "react";
import { ActivityDetailModal } from "./activity-detail-modal";
import {
  Wind,
  Snowflake,
  Mountain,
  Bike,
  Waves,
  PersonStanding,
  Heart,
  Activity,
} from "lucide-react";

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  kiteboarding_v2: <Wind className="h-4 w-4 text-cyan-400" />,
  wind_kite_surfing: <Wind className="h-4 w-4 text-cyan-400" />,
  resort_snowboarding: <Snowflake className="h-4 w-4 text-blue-300" />,
  resort_skiing_snowboarding_ws: <Snowflake className="h-4 w-4 text-blue-300" />,
  hiking: <Mountain className="h-4 w-4 text-green-400" />,
  e_bike_fitness: <Bike className="h-4 w-4 text-yellow-400" />,
  lap_swimming: <Waves className="h-4 w-4 text-blue-400" />,
  walking: <PersonStanding className="h-4 w-4 text-emerald-400" />,
  cycling: <Bike className="h-4 w-4 text-yellow-400" />,
  indoor_cardio: <Heart className="h-4 w-4 text-red-400" />,
  other: <Activity className="h-4 w-4 text-muted-foreground" />,
};

const ACTIVITY_LABELS: Record<string, string> = {
  kiteboarding_v2: "Kiteboarding",
  wind_kite_surfing: "Kite Surfing",
  resort_snowboarding: "Snowboarding",
  resort_skiing_snowboarding_ws: "Snowboarding",
  hiking: "Hiking",
  e_bike_fitness: "E-Bike",
  lap_swimming: "Swimming",
  walking: "Walk",
  indoor_cardio: "Cardio",
  cycling: "Cycling",
  indoor_cycling: "Indoor Cycle",
  stand_up_paddleboarding_v2: "SUP",
  other: "Other",
};

interface Activity {
  activity_id: string;
  type_key: string;
  date: string;
  name: string;
  distance_km: number;
  duration_min: number;
  avg_hr: number | null;
  calories: number | null;
  elev_gain: number;
}

const PAGE_SIZE = 20;

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function PaginatedActivityTable({ activities }: { activities: Activity[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  // Get unique types for filter
  const typeCounts = new Map<string, number>();
  for (const a of activities) {
    const label = ACTIVITY_LABELS[a.type_key] || a.type_key;
    typeCounts.set(label, (typeCounts.get(label) || 0) + 1);
  }
  const typeOptions = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]);

  const filtered = typeFilter
    ? activities.filter((a) => (ACTIVITY_LABELS[a.type_key] || a.type_key) === typeFilter)
    : activities;

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageActivities = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <>
      {/* Type Filter */}
      {typeOptions.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button
            onClick={() => { setTypeFilter(null); setPage(0); }}
            className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
              !typeFilter ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent text-muted-foreground"
            }`}
          >
            All ({activities.length})
          </button>
          {typeOptions.map(([label, count]) => (
            <button
              key={label}
              onClick={() => { setTypeFilter(label); setPage(0); }}
              className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                typeFilter === label ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent text-muted-foreground"
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-2 font-medium">Date</th>
              <th className="text-left py-2 font-medium">Type</th>
              <th className="text-left py-2 font-medium">Name</th>
              <th className="text-right py-2 font-medium">Distance</th>
              <th className="text-right py-2 font-medium">Duration</th>
              <th className="text-right py-2 font-medium">HR</th>
              <th className="text-right py-2 font-medium">Cal</th>
              <th className="text-right py-2 font-medium">Elev</th>
            </tr>
          </thead>
          <tbody>
            {pageActivities.map((a) => (
              <tr
                key={a.activity_id}
                className="border-b border-border/50 cursor-pointer hover:bg-accent/30 transition-colors"
                onClick={() => setSelectedId(a.activity_id)}
              >
                <td className="py-2 text-muted-foreground whitespace-nowrap">
                  {new Date(a.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "2-digit",
                  })}
                </td>
                <td className="py-2">
                  <span className="flex items-center gap-1.5">
                    {ACTIVITY_ICONS[a.type_key] || null}
                    <span className="text-xs">
                      {ACTIVITY_LABELS[a.type_key] || a.type_key}
                    </span>
                  </span>
                </td>
                <td className="py-2 max-w-[200px] truncate">{a.name}</td>
                <td className="py-2 text-right">
                  {a.distance_km.toFixed(1)} km
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {formatDuration(a.duration_min)}
                </td>
                <td className="py-2 text-right">
                  {a.avg_hr ? Math.round(a.avg_hr) : "—"}
                </td>
                <td className="py-2 text-right text-muted-foreground">
                  {a.calories ? Math.round(a.calories) : "—"}
                </td>
                <td className="py-2 text-right text-muted-foreground">
                  {a.elev_gain > 0 ? `${a.elev_gain.toLocaleString()}m` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-muted-foreground">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1 rounded border border-border text-xs hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 7) {
                  pageNum = i;
                } else if (page < 3) {
                  pageNum = i;
                } else if (page > totalPages - 4) {
                  pageNum = totalPages - 7 + i;
                } else {
                  pageNum = page - 3 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`w-7 h-7 rounded text-xs transition-colors ${
                      page === pageNum
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent"
                    }`}
                  >
                    {pageNum + 1}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page === totalPages - 1}
              className="px-3 py-1 rounded border border-border text-xs hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <ActivityDetailModal activityId={selectedId} onClose={() => setSelectedId(null)} />
    </>
  );
}
