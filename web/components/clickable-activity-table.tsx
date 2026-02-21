"use client";

import { useState } from "react";
import { ActivityDetailModal } from "./activity-detail-modal";
import {
  Wind,
  Snowflake,
  Mountain,
  Bike,
  Waves,
} from "lucide-react";

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  kiteboarding_v2: <Wind className="h-4 w-4 text-cyan-400" />,
  wind_kite_surfing: <Wind className="h-4 w-4 text-cyan-400" />,
  resort_snowboarding: <Snowflake className="h-4 w-4 text-blue-300" />,
  resort_skiing_snowboarding_ws: <Snowflake className="h-4 w-4 text-blue-300" />,
  hiking: <Mountain className="h-4 w-4 text-green-400" />,
  e_bike_fitness: <Bike className="h-4 w-4 text-yellow-400" />,
  lap_swimming: <Waves className="h-4 w-4 text-blue-400" />,
};

const ACTIVITY_LABELS: Record<string, string> = {
  kiteboarding_v2: "Kiteboarding",
  wind_kite_surfing: "Kite Surfing",
  resort_snowboarding: "Snowboarding",
  resort_skiing_snowboarding_ws: "Snowboarding",
  hiking: "Hiking",
  e_bike_fitness: "E-Bike",
  lap_swimming: "Swimming",
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

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function ClickableActivityTable({ activities }: { activities: Activity[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <>
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
            {activities.map((a) => (
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
      <ActivityDetailModal activityId={selectedId} onClose={() => setSelectedId(null)} />
    </>
  );
}
