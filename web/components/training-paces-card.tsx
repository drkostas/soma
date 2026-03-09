"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Timer } from "lucide-react";

// ── Daniels/Gilbert VDOT equations (ported from sync/src/training_engine/vdot.py) ──

/** Oxygen cost of running at a given velocity (mL/kg/min). */
function vo2Cost(velocityMMin: number): number {
  const v = velocityMMin;
  return -4.60 + 0.182258 * v + 0.000104 * v * v;
}

/** Fraction of VO2max sustainable for a given duration. */
function vo2DemandFraction(timeMin: number): number {
  const t = timeMin;
  return (
    0.8 +
    0.1894393 * Math.exp(-0.012778 * t) +
    0.2989558 * Math.exp(-0.1932605 * t)
  );
}

/** VDOT from a race performance. */
function vdotFromRace(distanceM: number, timeSeconds: number): number {
  const timeMin = timeSeconds / 60.0;
  const velocity = distanceM / timeMin;
  const vo2 = vo2Cost(velocity);
  const fraction = vo2DemandFraction(timeMin);
  return vo2 / fraction;
}

/** Velocity (m/min) at a given fraction of VO2max. */
function velocityAtFraction(vdot: number, fraction: number): number {
  const targetVo2 = vdot * fraction;
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.60 - targetVo2;
  const discriminant = b * b - 4 * a * c;
  return (-b + Math.sqrt(discriminant)) / (2 * a);
}

/** Predict race time from VDOT using binary search. */
function timeFromVdot(vdot: number, distanceM: number): number {
  let lo = 60.0;
  let hi = 86400.0;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2.0;
    const computed = vdotFromRace(distanceM, mid);
    if (computed > vdot) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2.0;
}

// Zone %VO2max fractions calibrated to Daniels' published tables
const ZONE_FRACTIONS: Record<string, [number, number]> = {
  easy: [0.6435, 0.7015],
  marathon: [0.813, 0.813],
  threshold: [0.8772, 0.8772],
  interval: [0.965, 0.965],
  repetition: [1.0474, 1.0817],
};

/** Training pace in sec/km for a zone. Returns [fast, slow] for ranges, [pace, pace] for single. */
function paceForZone(vdot: number, zone: string): [number, number] {
  const [lowFrac, highFrac] = ZONE_FRACTIONS[zone];
  if (zone === "easy" || zone === "repetition") {
    const fastVel = velocityAtFraction(vdot, highFrac);
    const slowVel = velocityAtFraction(vdot, lowFrac);
    return [Math.round((1000.0 / fastVel) * 60.0), Math.round((1000.0 / slowVel) * 60.0)];
  }
  const midFrac = (lowFrac + highFrac) / 2.0;
  const vel = velocityAtFraction(vdot, midFrac);
  const pace = Math.round((1000.0 / vel) * 60.0);
  return [pace, pace];
}

/** Format seconds to M:SS pace string. */
function fmtPace(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Format total seconds to H:MM or M:SS time string. */
function fmtTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface ZonePace {
  zone: string;
  label: string;
  pace: string;
}

interface GoalPace {
  tier: string;
  time: string;
  pace: string;
}

function computeZonePaces(vdot: number): ZonePace[] {
  const zones: { key: string; zone: string; label: string }[] = [
    { key: "easy", zone: "E", label: "Easy" },
    { key: "marathon", zone: "M", label: "Marathon" },
    { key: "threshold", zone: "T", label: "Threshold" },
    { key: "interval", zone: "I", label: "Interval" },
    { key: "repetition", zone: "R", label: "Repetition" },
  ];

  return zones.map(({ key, zone, label }) => {
    const [fast, slow] = paceForZone(vdot, key);
    const pace = fast === slow ? fmtPace(fast) : `${fmtPace(fast)}\u2013${fmtPace(slow)}`;
    return { zone, label, pace };
  });
}

function computeGoalPaces(vdot: number): GoalPace[] {
  // A goal = threshold pace
  const [tPace] = paceForZone(vdot, "threshold");

  // B goal = predicted HM pace
  const hmTime = timeFromVdot(vdot, 21097.5);
  const hmPace = Math.round(hmTime / 21.0975);

  // C goal = B * 1.03 (conservative)
  const cPace = Math.round(hmPace * 1.03);

  return [
    { tier: "A", time: fmtTime(hmTime * (tPace / hmPace)), pace: `${fmtPace(tPace)}/km` },
    { tier: "B", time: fmtTime(hmTime), pace: `${fmtPace(hmPace)}/km` },
    { tier: "C", time: fmtTime(hmTime * 1.03), pace: `${fmtPace(cPace)}/km` },
  ];
}

const zoneColors: Record<string, string> = {
  E: "oklch(62% 0.17 142)",
  M: "oklch(65% 0.15 250)",
  T: "oklch(80% 0.18 87)",
  I: "oklch(65% 0.2 25)",
  R: "oklch(60% 0.22 25)",
};

export function TrainingPacesCard({ vdot = 47 }: { vdot?: number }) {
  const zonePaces = useMemo(() => computeZonePaces(vdot), [vdot]);
  const goalPaces = useMemo(() => computeGoalPaces(vdot), [vdot]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Timer className="h-4 w-4" style={{ color: "oklch(65% 0.15 250)" }} />
          Training Paces
          <span className="text-[10px] text-muted-foreground/60 ml-auto">VDOT {vdot.toFixed(1)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          {zonePaces.map((p) => (
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
            {goalPaces.map((g) => (
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
