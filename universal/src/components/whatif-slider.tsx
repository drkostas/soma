import { useMemo, useState } from "react";
import { View, Pressable } from "react-native";
import { Text, Card, Button } from "soma-style";
import type { PlanDay } from "../lib/api";

const num = (v: number | null | undefined): number => (v == null || !isFinite(Number(v)) ? 0 : Number(v));
const clamp = (v: number) => Math.max(0.5, Math.min(1.5, Math.round(v * 100) / 100));

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * What-if intensity control (web parity, #422). A discrete Easier ↔ Harder
 * stepper (0.5×–1.5×; the web's continuous drag-slider is a documented mobile
 * trim) previews scaling the upcoming plan, then "Apply changes" persists the
 * deltas via onApply. An override banner shows while intensity ≠ 1.0×.
 */
export function WhatIfSlider({ planDays, onApply }: { planDays: PlanDay[]; onApply?: (factor: number, dayIds: number[]) => Promise<boolean> }) {
  const [factor, setFactor] = useState(1.0);
  const [state, setState] = useState<SaveState>("idle");

  const upcoming = useMemo(
    () => (planDays ?? []).filter((d) => !d.completed && d.targetDistanceKm != null && num(d.targetDistanceKm) > 0),
    [planDays],
  );
  const baseKm = upcoming.reduce((s, d) => s + num(d.targetDistanceKm), 0);
  const scaledKm = baseKm * factor;
  const changed = Math.abs(factor - 1) > 0.001;

  const step = (delta: number) => { setFactor((f) => clamp(f + delta)); setState("idle"); };
  const pct = Math.round(factor * 100);
  const label = factor < 0.98 ? "Easier" : factor > 1.02 ? "Harder" : "Normal";
  const labelColor = factor < 0.98 ? "#6ad4a0" : factor > 1.02 ? "#e0a458" : "#8aa0ac";

  async function apply() {
    if (!onApply || !changed || !upcoming.length) return;
    setState("saving");
    const ok = await onApply(factor, upcoming.map((d) => d.id));
    setState(ok ? "saved" : "error");
    if (ok) setFactor(1.0);
  }

  if (!upcoming.length) return null;

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">What-if intensity</Text>
        <Text variant="caption" className="tabular-nums" style={{ color: labelColor }}>{label} · {pct}%</Text>
      </View>

      {/* Discrete stepper: Easier ← [−] value [+] → Harder */}
      <View className="flex-row items-center gap-3">
        <Pressable onPress={() => step(-0.05)} hitSlop={8} className="h-9 w-9 items-center justify-center rounded-lg bg-surface-subtle">
          <Text variant="title" className="text-teal">−</Text>
        </Pressable>
        <View className="flex-1 items-center">
          <View className="h-2 w-full rounded-full bg-surface-subtle overflow-hidden">
            <View className="h-full rounded-full" style={{ width: `${((factor - 0.5) / 1.0) * 100}%`, backgroundColor: labelColor }} />
          </View>
          <Text variant="micro" className="text-text-muted mt-1">0.5× easier — 1.5× harder</Text>
        </View>
        <Pressable onPress={() => step(0.05)} hitSlop={8} className="h-9 w-9 items-center justify-center rounded-lg bg-surface-subtle">
          <Text variant="title" className="text-warm">+</Text>
        </Pressable>
      </View>

      {/* Preview */}
      <View className="flex-row items-center justify-between">
        <Text variant="micro" className="text-text-muted">{upcoming.length} upcoming workouts</Text>
        <Text variant="caption" className="tabular-nums text-text">
          {baseKm.toFixed(0)} → {scaledKm.toFixed(0)} km
          {changed ? <Text className={factor > 1 ? "text-warm" : "text-success"}>{`  (${factor > 1 ? "+" : ""}${(scaledKm - baseKm).toFixed(0)})`}</Text> : null}
        </Text>
      </View>

      {/* Override banner */}
      {changed ? (
        <View className="rounded-lg px-3 py-2" style={{ backgroundColor: (factor > 1 ? "#e0a458" : "#6ad4a0") + "1a" }}>
          <Text variant="micro" style={{ color: factor > 1 ? "#e0a458" : "#6ad4a0" }}>
            Override active — upcoming workouts scaled to {pct}%. Apply to persist.
          </Text>
        </View>
      ) : null}

      <Button
        variant="primary"
        size="sm"
        disabled={!changed || state === "saving"}
        label={state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Retry" : `Apply changes (${upcoming.length} workouts)`}
        onPress={apply}
      />
      {state === "error" ? <Text variant="micro" className="text-danger">Couldn't save — the plan adjust flow may be web-only.</Text> : null}
    </Card>
  );
}
