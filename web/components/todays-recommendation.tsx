"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Zap, AlertTriangle, Moon } from "lucide-react";

interface RecommendationProps {
  trafficLight: string;
  runType: string | null;
  runTitle: string | null;
  targetKm: number | null;
  adjustedPace: number | null; // sec/km
  compositeScore: number;
}

function formatPace(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TodaysRecommendation({
  trafficLight, runType, runTitle, targetKm, adjustedPace, compositeScore,
}: RecommendationProps) {
  if (!runType) return null;

  const isRest = runType === "rest";
  const isHard = ["tempo", "intervals", "threshold"].includes(runType);

  let icon = <Zap className="h-5 w-5" style={{ color: "oklch(62% 0.17 142)" }} />;
  let headline = `${runTitle || runType}`;
  let detail = "";
  let bgClass = "bg-green-500/5 border-green-500/20";

  if (isRest) {
    icon = <Moon className="h-5 w-5 text-muted-foreground" />;
    headline = "Rest Day";
    detail = "Recovery. Stretch, foam roll, sleep well.";
    bgClass = "bg-muted/30 border-muted";
  } else if (trafficLight === "red") {
    icon = <Moon className="h-5 w-5" style={{ color: "oklch(60% 0.22 25)" }} />;
    headline = isHard
      ? `Skip ${runTitle || runType} → Rest or easy 4 km`
      : `Reduce to easy 4 km`;
    detail = "Readiness is RED. Your body needs recovery today.";
    bgClass = "bg-red-500/5 border-red-500/20";
  } else if (trafficLight === "yellow" && isHard) {
    icon = <AlertTriangle className="h-5 w-5" style={{ color: "oklch(80% 0.18 87)" }} />;
    headline = `${runTitle || runType} → Easy Run ${Math.round((targetKm || 6) * 0.85)} km`;
    detail = "Readiness is YELLOW. Swap hard session for easy run, or reduce pace by 10-15%.";
    bgClass = "bg-yellow-500/5 border-yellow-500/20";
  } else if (trafficLight === "yellow") {
    detail = `Readiness YELLOW — keep it easy. ${adjustedPace ? `Target ${formatPace(adjustedPace)}/km` : ""}`;
    bgClass = "bg-yellow-500/5 border-yellow-500/20";
  } else {
    // Green
    if (isHard) {
      detail = `Full send. ${adjustedPace ? `Adjusted pace: ${formatPace(adjustedPace)}/km` : ""}`;
    } else {
      detail = adjustedPace ? `Easy pace: ${formatPace(adjustedPace)}/km. Keep HR in Zone 2.` : "Keep it conversational.";
    }
  }

  return (
    <Card className={`border ${bgClass}`}>
      <CardContent className="py-3 flex items-center gap-3">
        {icon}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{headline}</div>
          {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
        </div>
        {targetKm && targetKm > 0 && !isRest && trafficLight !== "red" && (
          <div className="text-sm font-mono tabular-nums text-muted-foreground shrink-0">
            {targetKm.toFixed(1)} km
          </div>
        )}
      </CardContent>
    </Card>
  );
}
