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
          <View key={m.label} className="min-w-[46%] flex-1 gap-1 rounded-lg border border-border-subtle p-2.5" testID={`ref-${m.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}>
            <Text variant="micro" className="text-text-muted">{m.label}</Text>
            <View className="flex-row items-center justify-between gap-2">
              <Text variant="body" className="tabular-nums shrink-0" style={{ color: m.color }}>{m.value}</Text>
              {/* The sparkline measures its container; give it the remaining width so a wide value
                  ("1:43:44", "73.2 kg") does not push it past the card edge (soma#786). */}
              {m.spark.length >= 2 ? <View className="flex-1 min-w-0 overflow-hidden" style={{ minWidth: 36 }}><Sparkline data={m.spark} color={m.color} height={20} baseline /></View> : null}
            </View>
            {m.note ? <Text variant="micro" className="text-text-muted">{m.note}</Text> : null}
          </View>
        ))}
      </View>
    </Card>
  );
}
