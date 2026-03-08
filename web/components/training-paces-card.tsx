"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Timer } from "lucide-react";

const VDOT_47_PACES = [
  { zone: "E", label: "Easy", pace: "5:22–5:45", perKm: "5:22–5:45/km" },
  { zone: "M", label: "Marathon", pace: "4:46", perKm: "4:46/km" },
  { zone: "T", label: "Threshold", pace: "4:29", perKm: "4:29/km" },
  { zone: "I", label: "Interval", pace: "4:09", perKm: "4:09/km" },
  { zone: "R", label: "Repetition", pace: "3:47–3:53", perKm: "3:47–3:53/km" },
];

const GOAL_PACES = [
  { tier: "A", time: "1:35", pace: "4:30/km" },
  { tier: "B", time: "1:40", pace: "4:44/km" },
  { tier: "C", time: "1:43", pace: "4:53/km" },
];

const zoneColors: Record<string, string> = {
  E: "oklch(62% 0.17 142)",
  M: "oklch(65% 0.15 250)",
  T: "oklch(80% 0.18 87)",
  I: "oklch(65% 0.2 25)",
  R: "oklch(60% 0.22 25)",
};

export function TrainingPacesCard() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Timer className="h-4 w-4" style={{ color: "oklch(65% 0.15 250)" }} />
          Training Paces
          <span className="text-[10px] text-muted-foreground/60 ml-auto">VDOT 47</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          {VDOT_47_PACES.map((p) => (
            <div key={p.zone} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span
                  className="w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center text-white"
                  style={{ backgroundColor: zoneColors[p.zone] }}
                >
                  {p.zone}
                </span>
                <span className="text-muted-foreground">{p.label}</span>
              </div>
              <span className="font-mono tabular-nums">{p.pace}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-border/50 pt-2">
          <div className="text-[10px] text-muted-foreground mb-1">HM Goal Paces</div>
          <div className="flex gap-3">
            {GOAL_PACES.map((g) => (
              <div key={g.tier} className="text-center">
                <div className="text-[10px] text-muted-foreground">
                  {g.tier} ({g.time})
                </div>
                <div className="text-xs font-mono font-medium">{g.pace}</div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
