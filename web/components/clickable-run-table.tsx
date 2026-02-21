"use client";

import { useState } from "react";
import { ActivityDetailModal } from "./activity-detail-modal";

interface Run {
  activity_id: string;
  date: string;
  name: string;
  distance: number;
  duration_min: number;
  pace: number | null;
  avg_hr: number | null;
  calories: number | null;
}

function formatPace(mins: number) {
  const m = Math.floor(mins);
  const s = Math.round((mins - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ClickableRunTable({ runs }: { runs: Run[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-2 font-medium">Date</th>
              <th className="text-left py-2 font-medium">Name</th>
              <th className="text-right py-2 font-medium">Distance</th>
              <th className="text-right py-2 font-medium">Duration</th>
              <th className="text-right py-2 font-medium">Pace</th>
              <th className="text-right py-2 font-medium">HR</th>
              <th className="text-right py-2 font-medium">Cal</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.activity_id}
                className="border-b border-border/50 cursor-pointer hover:bg-accent/30 transition-colors"
                onClick={() => setSelectedId(run.activity_id)}
              >
                <td className="py-2 text-muted-foreground">
                  {new Date(run.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </td>
                <td className="py-2">{run.name}</td>
                <td className="py-2 text-right">
                  {run.distance.toFixed(1)} km
                </td>
                <td className="py-2 text-right">
                  {Math.round(run.duration_min)} min
                </td>
                <td className="py-2 text-right font-medium">
                  {run.pace ? formatPace(run.pace) : "—"}
                </td>
                <td className="py-2 text-right">
                  {run.avg_hr ? Math.round(run.avg_hr) : "—"}
                </td>
                <td className="py-2 text-right text-muted-foreground">
                  {run.calories ? Math.round(run.calories) : "—"}
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
