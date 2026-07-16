"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calculator } from "lucide-react";

interface PaceAdjustmentData {
  base_pace: number;
  readiness_factor: number;
  fatigue_factor: number;
  weight_factor: number;
  adjusted_pace: number | null;
  traffic_light: string;
}

function formatPace(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function FactorRow({ label, value, description }: { label: string; value: number; description: string }) {
  const color = value < 1.0 ? "oklch(62% 0.17 142)" : value > 1.0 ? "oklch(60% 0.22 25)" : "var(--muted-foreground)";
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground/60">{description}</span>
        <span className="font-mono font-medium tabular-nums" style={{ color }}>
          x{value.toFixed(3)}
        </span>
      </div>
    </div>
  );
}

export function PaceAdjustmentCard({ data }: { data: PaceAdjustmentData | null }) {
  if (!data || data.adjusted_pace === null) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Calculator className="h-4 w-4" style={{ color: "oklch(65% 0.2 55)" }} />
          Pace Adjustment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-muted-foreground">Base</span>
          <span className="text-sm font-mono">{formatPace(data.base_pace)}/km</span>
          <span className="text-muted-foreground mx-1">&rarr;</span>
          <span className="text-lg font-bold font-mono" style={{ color: "oklch(65% 0.2 55)" }}>
            {formatPace(data.adjusted_pace)}/km
          </span>
        </div>
        <div className="space-y-1 pt-1 border-t border-border/50">
          <FactorRow
            label="Readiness"
            value={data.readiness_factor}
            description={data.readiness_factor < 1 ? "fresh" : data.readiness_factor > 1 ? "tired" : "normal"}
          />
          <FactorRow
            label="Fatigue"
            value={data.fatigue_factor}
            description={data.fatigue_factor < 1 ? "rested" : data.fatigue_factor > 1 ? "fatigued" : "balanced"}
          />
          <FactorRow
            label="Weight"
            value={data.weight_factor}
            description={data.weight_factor < 1 ? "lighter" : data.weight_factor > 1 ? "heavier" : "baseline"}
          />
        </div>
      </CardContent>
    </Card>
  );
}
