/**
 * Per-meal protein quality (V9.1 / Schoenfeld & Aragon 2018; Trommelen 2023).
 * Classifies a single eating event for MPS signaling — NOT a day total.
 * No upper cap: >55g just isn't incrementally better, not harmful.
 */
import React from "react";

export type PerMealProteinLevel = "red" | "amber" | "yellow" | "green" | "plenty";

export function perMealProteinLevel(g: number): PerMealProteinLevel {
  if (g < 15) return "red";
  if (g < 25) return "amber";
  if (g < 30) return "yellow";
  if (g <= 55) return "green";
  return "plenty";
}

export function ProteinQualityPill({ grams }: { grams: number }) {
  const level = perMealProteinLevel(grams);
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
  return (
    <span
      className={`text-[9px] ml-1.5 px-1 py-[1px] rounded border ${cls} tabular-nums`}
      title={`Per-meal protein: ${Math.round(grams)}g. MPS optimum is ≥30g per eating event (Schoenfeld & Aragon 2018; Trommelen 2023).`}
    >
      {label}
    </span>
  );
}
