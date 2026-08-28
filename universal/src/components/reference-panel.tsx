import { View } from "react-native";
import { Text, Card, Sparkline } from "soma-style";

export interface RefMetric {
  label: string;
  value: string;
  spark: number[];
  color: string;
  note?: string;
}

/** "External comparison signals" — Garmin-side + PMC metrics shown for
 *  reference (not part of the model), each with a trend sparkline.
 *  Mobile-adapted from the web ReferencePanel. */
export function ReferencePanel({ metrics }: { metrics: RefMetric[] }) {
  if (!metrics.length) return null;
  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">External signals</Text>
        <Text variant="micro" className="text-text-muted">reference · not the model</Text>
      </View>
      <View className="flex-row flex-wrap gap-3">
        {metrics.map((m) => (
          <View key={m.label} className="min-w-[46%] flex-1 gap-1 rounded-lg border border-border-subtle p-2.5">
            <Text variant="micro" className="text-text-muted">{m.label}</Text>
            <View className="flex-row items-center justify-between gap-2">
              <Text variant="body" className="tabular-nums" style={{ color: m.color }}>{m.value}</Text>
              {m.spark.length >= 2 ? <Sparkline data={m.spark} color={m.color} height={20} baseline /> : null}
            </View>
            {m.note ? <Text variant="micro" className="text-text-muted">{m.note}</Text> : null}
          </View>
        ))}
      </View>
    </Card>
  );
}
