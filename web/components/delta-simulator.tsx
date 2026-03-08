"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SlidersHorizontal, AlertTriangle } from "lucide-react";

interface DeltaSimulatorProps {
  basePace: number;       // sec/km (already adjusted for readiness/fatigue/weight)
  optimalPace: number;    // sec/km target from plan
  currentVdot: number;
  goalVdot: number;
  slider?: number;                    // controlled value (optional)
  onSliderChange?: (v: number) => void;  // controlled callback (optional)
}

function formatPace(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function DeltaSimulator({ basePace, optimalPace, currentVdot, goalVdot, slider: controlledSlider, onSliderChange }: DeltaSimulatorProps) {
  const [localSlider, setLocalSlider] = useState(1.0);
  const currentSlider = controlledSlider ?? localSlider;
  const handleChange = (v: number) => {
    if (onSliderChange) onSliderChange(v);
    else setLocalSlider(v);
  };

  const delta = optimalPace - basePace;
  const scaledPace = basePace + delta * currentSlider;
  const finalPace = Math.max(180, Math.min(600, scaledPace));

  const risk = currentSlider > 1.3 ? "high" : currentSlider > 1.0 ? "moderate" : "low";
  const riskColor = risk === "high" ? "oklch(60% 0.22 25)" : risk === "moderate" ? "oklch(80% 0.18 87)" : "oklch(62% 0.17 142)";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" style={{ color: "oklch(65% 0.2 55)" }} />
          Pace Simulator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground w-6">0</span>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={currentSlider}
            onChange={(e) => handleChange(Number(e.target.value))}
            className="flex-1 h-2 accent-primary cursor-pointer"
          />
          <span className="text-[10px] text-muted-foreground w-6">1.5</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Aggression: <span className="font-mono font-medium">{currentSlider.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {risk !== "low" && <AlertTriangle className="h-3 w-3" style={{ color: riskColor }} />}
            <span className="text-[10px] capitalize" style={{ color: riskColor }}>
              {risk} risk
            </span>
          </div>
        </div>

        <div className="flex items-baseline gap-2 pt-1 border-t border-border/50">
          <span className="text-xs text-muted-foreground">Target pace:</span>
          <span className="text-lg font-bold font-mono" style={{ color: riskColor }}>
            {formatPace(finalPace)}/km
          </span>
          <span className="text-[10px] text-muted-foreground">
            ({currentSlider === 0 ? "conservative" : currentSlider === 1 ? "close gap" : currentSlider > 1 ? "push beyond" : "partial close"})
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
