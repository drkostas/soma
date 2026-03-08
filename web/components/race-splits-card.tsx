"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Flag } from "lucide-react";

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const GOALS = [
  { tier: "A", total: 5700, pacePerKm: 270 },  // 1:35:00 = 4:30/km
  { tier: "B", total: 6000, pacePerKm: 284 },  // 1:40:00 = 4:44/km
  { tier: "C", total: 6180, pacePerKm: 293 },  // 1:43:00 = 4:53/km
];

const SPLITS = [5, 10, 15, 20, 21.1];

export function RaceSplitsCard() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Flag className="h-4 w-4" style={{ color: "oklch(60% 0.2 300)" }} />
          Race Split Targets
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border/50">
                <th className="text-left py-1 pr-2 font-medium">Split</th>
                {GOALS.map((g) => (
                  <th key={g.tier} className="text-right py-1 px-1 font-medium">
                    {g.tier} ({formatTime(g.total)})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SPLITS.map((km) => (
                <tr key={km} className="border-b border-border/30 last:border-0">
                  <td className="py-1 pr-2 text-muted-foreground">
                    {km === 21.1 ? "Finish" : `${km}K`}
                  </td>
                  {GOALS.map((g) => (
                    <td key={g.tier} className="text-right py-1 px-1 font-mono tabular-nums">
                      {formatTime(Math.round(km * g.pacePerKm))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground/60 mt-2">
          Strategy: Start at B-pace. Evaluate at 5K. If feeling strong at 10K, accelerate toward A.
        </p>
      </CardContent>
    </Card>
  );
}
