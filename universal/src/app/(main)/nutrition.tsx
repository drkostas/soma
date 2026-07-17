import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Text, Card, Badge, SegmentedControl, ProgressBar, MacroBar, Button, Modal } from "soma-style";
import { useSomaPlan, type MacroSet } from "../../lib/api";

const DATE = "2026-07-16";

const MACROS = [
  { key: "protein", label: "Protein", color: "#b17850", tKey: "target_protein" },
  { key: "carbs", label: "Carbs", color: "#6366b0", tKey: "target_carbs" },
  { key: "fat", label: "Fat", color: "#cbe896", tKey: "target_fat" },
  { key: "fiber", label: "Fiber", color: "#82d0c8", tKey: "target_fiber" },
] as const;

export default function NutritionScreen() {
  const { data, loading, error } = useSomaPlan(DATE);
  const [tab, setTab] = useState<"Day" | "Trajectory">("Day");
  const [refeed, setRefeed] = useState(false);

  const plan = data?.plan;
  const consumed = data?.consumed;
  const remaining = data?.remaining;
  const adaptive = data?.adaptive;
  const adherence = data?.trend7d?.adherence;
  const targetCal = plan?.target_calories ?? 0;

  return (
    <ScrollView className="flex-1 bg-base" contentContainerClassName="items-center px-5 py-6">
      <View className="w-full max-w-2xl gap-4">
        <View className="flex-row items-center gap-2">
          <Text variant="title">Thursday, Jul 16</Text>
          <Badge label="Nutrition" tone="teal" />
        </View>

        {error ? (
          <Card><Text variant="body" className="text-danger">API: {error} — is soma running on :3456?</Text></Card>
        ) : null}

        <Card variant="glow" className="gap-4">
          <SegmentedControl options={["Day", "Trajectory"] as const} value={tab} onChange={setTab} />
          <View className="items-center gap-1">
            <Text variant="display">{loading ? "…" : ((consumed?.calories ?? 0)).toLocaleString()}</Text>
            <Text variant="caption" className="text-text-muted">/ {targetCal.toLocaleString()} kcal · {(remaining?.calories ?? 0).toLocaleString()} remaining</Text>
          </View>

          {/* Macro bars */}
          <View className="gap-2.5">
            {MACROS.map((m) => {
              const target = (plan as Record<string, number> | undefined)?.[m.tKey] ?? 0;
              const eaten = (consumed as Record<string, number> | undefined)?.[m.key] ?? 0;
              return (
                <View key={m.key} className="gap-1">
                  <View className="flex-row justify-between">
                    <Text variant="caption" className="text-text-secondary">{m.label}</Text>
                    <Text variant="caption" className="tabular-nums text-text-muted">{Math.round(eaten)} / {Math.round(target)}g</Text>
                  </View>
                  <ProgressBar pct={target > 0 ? eaten / target : 0} color={m.color} />
                </View>
              );
            })}
          </View>
        </Card>

        {/* Adaptive (the #68 feature, display-only) */}
        {adaptive && (adaptive.driftFlag || adaptive.dietBreakLevel !== "none") ? (
          <Card className="gap-1">
            <Text variant="eyebrow">Adaptive</Text>
            {adaptive.dietBreakLevel !== "none" ? (
              <View className="flex-row justify-between">
                <Text variant="caption" className="font-semibold text-warning">
                  Diet break {adaptive.dietBreakLevel}
                </Text>
                <Text variant="caption" className="text-text-muted tabular-nums">{adaptive.deficitDurationDays}d in deficit</Text>
              </View>
            ) : null}
            {adaptive.driftFlag ? (
              <Text variant="caption" className="text-warning">TDEE drift: ~{Math.round(adaptive.effectiveTdee)} vs {Math.round(adaptive.reportedTdee)}</Text>
            ) : null}
            <Text variant="micro">Informational — your targets are unchanged.</Text>
          </Card>
        ) : null}

        {/* Adherence (the #69 feature) */}
        {adherence ? (
          <Card className="gap-2">
            <Text variant="eyebrow">Weekly adherence</Text>
            <ProgressBar pct={Math.min(adherence.ratio, 1)} color="#6ad4a0" />
            <View className="flex-row justify-between">
              <Text variant="caption" className="text-text-secondary">{adherence.weeklyActual} / {adherence.weeklyGoal} kcal</Text>
              <Text variant="caption" className="text-warning">{adherence.status.replace("_", " ")} · {Math.round(adherence.ratio * 100)}%</Text>
            </View>
          </Card>
        ) : null}

        {/* Meal slots (soma budgets are per-slot kcal) */}
        <Card className="gap-2">
          <Text variant="eyebrow">Per-meal kcal</Text>
          {Object.entries(data?.slotBudgets ?? {})
            .filter(([, v]) => (v?.calories ?? 0) > 0)
            .map(([slot, v]) => (
              <View key={slot} className="flex-row items-center justify-between border-b border-border-subtle py-2">
                <Text variant="body" className="capitalize text-text-secondary">{slot.replace("_", " ")}</Text>
                <Text variant="body" className="tabular-nums text-text">{Math.round(v.calories)} kcal</Text>
              </View>
            ))}
        </Card>

        <Button label="Plan a refeed" variant="primary" onPress={() => setRefeed(true)} />
      </View>

      <Modal visible={refeed} onClose={() => setRefeed(false)} title="Plan a refeed">
        <Text variant="body" className="text-text-secondary">A refeed raises carbs for a day to ease a long deficit.</Text>
        <View className="mt-4 flex-row justify-end gap-2">
          <Button label="Cancel" variant="ghost" onPress={() => setRefeed(false)} />
          <Button label="Add refeed" variant="primary" onPress={() => setRefeed(false)} />
        </View>
      </Modal>
    </ScrollView>
  );
}
