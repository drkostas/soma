"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
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
  temp_c?: number | null;
  weather_desc?: string | null;
}

type SortKey = "date" | "distance" | "pace" | "avg_hr" | "calories";
type SortDir = "asc" | "desc";

function formatPace(mins: number) {
  const m = Math.floor(mins);
  const s = Math.round((mins - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ClickableRunTable({ runs }: { runs: Run[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col)
      return <ChevronsUpDown className="h-3 w-3 opacity-30 inline ml-1" />;
    return sortDir === "asc" ? (
      <ChevronUp className="h-3 w-3 inline ml-1" />
    ) : (
      <ChevronDown className="h-3 w-3 inline ml-1" />
    );
  }

  const sorted = [...runs].sort((a, b) => {
    let av: number, bv: number;
    switch (sortKey) {
      case "date":
        av = new Date(a.date).getTime();
        bv = new Date(b.date).getTime();
        break;
      case "distance":
        av = a.distance;
        bv = b.distance;
        break;
      case "pace":
        av = a.pace ?? 999;
        bv = b.pace ?? 999;
        break;
      case "avg_hr":
        av = a.avg_hr ?? 0;
        bv = b.avg_hr ?? 0;
        break;
      case "calories":
        av = a.calories ?? 0;
        bv = b.calories ?? 0;
        break;
      default:
        av = 0;
        bv = 0;
    }
    return sortDir === "asc" ? av - bv : bv - av;
  });

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th
                className="text-left py-2 font-medium cursor-pointer hover:text-foreground select-none"
                onClick={() => toggleSort("date")}
              >
                Date <SortIcon col="date" />
              </th>
              <th className="text-left py-2 font-medium">Name</th>
              <th
                className="text-right py-2 font-medium cursor-pointer hover:text-foreground select-none"
                onClick={() => toggleSort("distance")}
              >
                Distance <SortIcon col="distance" />
              </th>
              <th className="text-right py-2 font-medium">Duration</th>
              <th
                className="text-right py-2 font-medium cursor-pointer hover:text-foreground select-none"
                onClick={() => toggleSort("pace")}
              >
                Pace <SortIcon col="pace" />
              </th>
              <th
                className="text-right py-2 font-medium cursor-pointer hover:text-foreground select-none"
                onClick={() => toggleSort("avg_hr")}
              >
                HR <SortIcon col="avg_hr" />
              </th>
              <th
                className="text-right py-2 font-medium cursor-pointer hover:text-foreground select-none hidden sm:table-cell"
                onClick={() => toggleSort("calories")}
              >
                Cal <SortIcon col="calories" />
              </th>
              <th className="text-right py-2 font-medium hidden sm:table-cell">Temp</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((run) => (
              <tr
                key={run.activity_id}
                className="border-b border-border/50 cursor-pointer hover:bg-accent/30 active:bg-accent/40 transition-colors"
                onClick={() => setSelectedId(run.activity_id)}
              >
                <td className="py-2.5 text-muted-foreground">
                  {new Date(run.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </td>
                <td className="py-2.5 max-w-[140px] sm:max-w-[200px] truncate" title={run.name}>{run.name}</td>
                <td className="py-2.5 text-right">
                  {run.distance.toFixed(1)} km
                </td>
                <td className="py-2.5 text-right">
                  {Math.round(run.duration_min)} min
                </td>
                <td className="py-2.5 text-right font-medium">
                  {run.pace ? formatPace(run.pace) : "—"}
                </td>
                <td className="py-2.5 text-right">
                  {run.avg_hr ? Math.round(run.avg_hr) : "—"}
                </td>
                <td className="py-2.5 text-right text-muted-foreground hidden sm:table-cell">
                  {run.calories ? Math.round(run.calories) : "—"}
                </td>
                <td className="py-2.5 text-right text-muted-foreground hidden sm:table-cell">
                  {run.temp_c != null ? `${Math.round(run.temp_c)}°C` : "—"}
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
