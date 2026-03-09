"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface WorkoutStep {
  name?: string;
  type?: string;
  distance_meters?: number;
  duration_minutes?: number;
  target_pace_low?: number;
  target_pace_high?: number;
  target_hr_low?: number;
  target_hr_high?: number;
  notes?: string;
}

function formatPace(s: number): string {
  const min = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function getHRZoneLabel(hrLow: number): { zone: string; color: string; desc: string } {
  if (hrLow < 135) return { zone: "Zone 1", color: "oklch(0.7 0.05 250)", desc: "Recovery (50-60% HRR)" };
  if (hrLow < 145) return { zone: "Zone 2", color: "oklch(0.7 0.12 142)", desc: "Aerobic base (60-70% HRR)" };
  if (hrLow < 160) return { zone: "Zone 3", color: "oklch(0.7 0.12 85)", desc: "Tempo (70-80% HRR)" };
  if (hrLow < 172) return { zone: "Zone 4", color: "oklch(0.7 0.15 50)", desc: "Threshold (80-88% HRR)" };
  return { zone: "Zone 5", color: "oklch(0.7 0.18 25)", desc: "VO2max (88-95% HRR)" };
}

export function StepDetailDrawer({
  step,
  onClose,
}: {
  step: WorkoutStep | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  if (!step) return null;

  const hrZone = step.target_hr_low ? getHRZoneLabel(step.target_hr_low) : null;
  const distKm = step.distance_meters ? step.distance_meters / 1000 : null;
  const estMinutes = step.duration_minutes
    || (distKm && step.target_pace_low
      ? Math.round(distKm * ((step.target_pace_low + (step.target_pace_high || step.target_pace_low)) / 2) / 60)
      : null);

  return (
    <div
      ref={ref}
      className="fixed top-0 right-0 h-full w-[320px] bg-card border-l border-border shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-200"
    >
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold capitalize">
              {step.name || step.type?.replace("_", " ") || "Step"}
            </h3>
            <p className="text-xs text-muted-foreground capitalize">{step.type}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Pace */}
        {(step.target_pace_low || step.target_pace_high) && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Pace Target</div>
            <div className="text-lg font-mono">
              {step.target_pace_low && step.target_pace_high
                ? `${formatPace(step.target_pace_low)} – ${formatPace(step.target_pace_high)}/km`
                : `${formatPace(step.target_pace_low || step.target_pace_high || 0)}/km`
              }
            </div>
          </div>
        )}

        {/* HR Zone */}
        {hrZone && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Heart Rate</div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: hrZone.color }}>{hrZone.zone}</span>
              <span className="text-sm font-mono">{step.target_hr_low}–{step.target_hr_high} bpm</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{hrZone.desc}</p>
          </div>
        )}

        {/* Duration */}
        {estMinutes && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Duration</div>
            <div className="text-sm font-mono">
              {step.duration_minutes ? `${estMinutes} min` : `~${estMinutes} min (estimated)`}
            </div>
          </div>
        )}

        {/* Distance */}
        {distKm && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Distance</div>
            <div className="text-sm font-mono">
              {distKm >= 1 ? `${distKm.toFixed(1)} km` : `${step.distance_meters}m`}
            </div>
          </div>
        )}

        {/* Notes */}
        {step.notes && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Cues</div>
            <p className="text-xs">{step.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
