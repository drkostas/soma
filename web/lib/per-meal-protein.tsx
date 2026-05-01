/**
 * Per-meal protein quality (V9.1 / Schoenfeld & Aragon 2018; Trommelen 2023).
 * Classifies a single eating event for MPS signaling — NOT a day total.
 *
 * MPS-floor formula: 0.4 × weight_kg per eating event. For a 75 kg user that's
 * exactly 30g (the value commonly cited as a single threshold), but the actual
 * literature scales by body mass — a 60 kg user's MPS floor is ~24g, a 90 kg
 * user's is ~36g. Pass `weightKg` to use the personalised floor; omit it for
 * the legacy 30g default.
 *
 * No upper cap: >~0.55 g/kg per meal isn't incrementally better, not harmful.
 */
import React from "react";

export type PerMealProteinLevel = "red" | "amber" | "yellow" | "green" | "plenty";

const MPS_G_PER_KG = 0.4;
const PLENTY_G_PER_KG = 0.55;
const FALLBACK_MPS_G = 30;

interface Thresholds {
  red: number;       // below this = "low protein"
  amber: number;     // below this = "below MPS"
  yellow: number;    // below this = "near MPS"
  plenty: number;    // above this = "plenty" (hidden)
}

function thresholds(weightKg: number | null | undefined): Thresholds {
  if (!weightKg || weightKg <= 0) {
    return { red: 15, amber: 25, yellow: 30, plenty: 55 };
  }
  const mps = Math.max(20, Math.round(weightKg * MPS_G_PER_KG));
  const plenty = Math.max(40, Math.round(weightKg * PLENTY_G_PER_KG));
  return {
    red: Math.max(10, Math.round(mps * 0.5)),
    amber: Math.max(15, Math.round(mps * 0.83)),
    yellow: mps,
    plenty,
  };
}

export function perMealProteinLevel(g: number, weightKg?: number | null): PerMealProteinLevel {
  const t = thresholds(weightKg);
  if (g < t.red) return "red";
  if (g < t.amber) return "amber";
  if (g < t.yellow) return "yellow";
  if (g <= t.plenty) return "green";
  return "plenty";
}

export function ProteinQualityPill({ grams, weightKg }: { grams: number; weightKg?: number | null }) {
  const level = perMealProteinLevel(grams, weightKg);
  if (level === "green" || level === "plenty") return null;
  const cls =
    level === "red"
      ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
      : level === "amber"
        ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
        : "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  const label =
    level === "red"
      ? "low protein"
      : level === "amber"
        ? "below MPS"
        : "near MPS";
  const mpsFloor = weightKg && weightKg > 0
    ? Math.max(20, Math.round(weightKg * MPS_G_PER_KG))
    : FALLBACK_MPS_G;
  return (
    <span
      className={`text-[9px] ml-1.5 px-1 py-[1px] rounded border ${cls} tabular-nums`}
      title={`Per-meal protein: ${Math.round(grams)}g. MPS optimum is ≥${mpsFloor}g per eating event (0.4 × weight_kg, Schoenfeld & Aragon 2018; Trommelen 2023).`}
    >
      {label}
    </span>
  );
}
