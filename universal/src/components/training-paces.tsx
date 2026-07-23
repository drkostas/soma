import { View } from "react-native";
import { Text, Card } from "soma-style";
import { pacesForVdot, paceStr, timeStr, hmPace } from "../lib/vdot";

/** VDOT → training paces + A/B/C half-marathon goals, matching the web card. */
export function TrainingPaces({ vdot }: { vdot: number | null | undefined }) {
  if (vdot == null || !isFinite(vdot)) return null;
  const p = pacesForVdot(vdot);
  const b = hmPace(p); // predicted HM pace
  const zones: { label: string; pace: string; color: string }[] = [
    { label: "Easy", pace: paceStr(p.easy), color: "#6ad4a0" },
    { label: "Marathon", pace: paceStr(p.marathon), color: "#6aa0e0" },
    { label: "Threshold", pace: paceStr(p.threshold), color: "#e0a458" },
    { label: "Interval", pace: paceStr(p.interval), color: "#e06060" },
    { label: "Repetition", pace: paceStr(p.repetition), color: "#c77dff" },
  ];
  const goals: { tag: string; label: string; pace: number }[] = [
    { tag: "A", label: "Threshold push", pace: p.threshold },
    { tag: "B", label: "Predicted HM", pace: b },
    { tag: "C", label: "Conservative (+3%)", pace: b * 1.03 },
  ];

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Training paces</Text>
        <Text variant="micro" className="tabular-nums text-text-muted">VDOT {vdot.toFixed(1)}</Text>
      </View>

      <View className="gap-2">
        {zones.map((z) => (
          <View key={z.label} className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="h-2 w-2 rounded-full" style={{ backgroundColor: z.color }} />
              <Text variant="body" className="text-text-secondary">{z.label}</Text>
            </View>
            <Text variant="body" className="tabular-nums text-text">{z.pace}<Text variant="micro" className="text-text-muted"> /km</Text></Text>
          </View>
        ))}
      </View>

      <View className="gap-2 border-t border-border-subtle pt-2.5">
        <View className="flex-row items-center justify-between">
          <Text variant="micro" className="text-text-muted">Half-marathon goals</Text>
          <Text variant="micro" className="tabular-nums text-text-muted">pred. {timeStr(p.hmSeconds)}</Text>
        </View>
        {goals.map((g) => (
          <View key={g.tag} className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="h-5 w-5 items-center justify-center rounded-full bg-surface-subtle">
                <Text variant="micro" className="text-teal">{g.tag}</Text>
              </View>
              <Text variant="body" className="text-text-secondary">{g.label}</Text>
            </View>
            <Text variant="body" className="tabular-nums text-text">{paceStr(g.pace)}<Text variant="micro" className="text-text-muted"> /km</Text></Text>
          </View>
        ))}
      </View>
    </Card>
  );
}
