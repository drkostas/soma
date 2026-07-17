import { ScrollView, View } from "react-native";
import { Text, Card, Badge, ProgressBar } from "soma-style";

/**
 * Training overview. Representative for now — soma's live training data is the
 * banister/PMC trajectory (api/training/graph + forward-sim), a follow-up wire.
 */
export default function TrainingScreen() {
  const load = [
    { label: "Fitness (CTL)", value: 62, color: "#77c8d1", pct: 0.62 },
    { label: "Fatigue (ATL)", value: 48, color: "#e0a458", pct: 0.48 },
    { label: "Form (TSB)", value: 14, color: "#6ad4a0", pct: 0.6 },
  ];

  return (
    <ScrollView className="flex-1 bg-base" contentContainerClassName="items-center px-5 py-6">
      <View className="w-full max-w-2xl gap-4">
        <View className="flex-row items-center gap-2">
          <Text variant="headline">Training</Text>
          <Badge label="Readiness 68" tone="success" />
        </View>

        <Card className="gap-3">
          <Text variant="eyebrow">Training load</Text>
          {load.map((l) => (
            <View key={l.label} className="gap-1">
              <View className="flex-row justify-between">
                <Text variant="caption" className="text-text-secondary">{l.label}</Text>
                <Text variant="caption" className="tabular-nums text-text">{l.value}</Text>
              </View>
              <ProgressBar pct={l.pct} color={l.color} />
            </View>
          ))}
        </Card>

        <View className="flex-row gap-3">
          <Card className="flex-1 gap-1">
            <Text variant="eyebrow">VO2max</Text>
            <Text variant="headline" className="text-teal">54.0</Text>
            <Text variant="micro">ml/kg/min</Text>
          </Card>
          <Card className="flex-1 gap-1">
            <Text variant="eyebrow">Weekly load</Text>
            <Text variant="headline" className="text-lime">Balanced</Text>
            <Text variant="micro">Ramp +4%</Text>
          </Card>
        </View>
      </View>
    </ScrollView>
  );
}
