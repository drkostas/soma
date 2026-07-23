import { View } from "react-native";
import { Text, Card } from "soma-style";

/** Monthly mileage bar chart (last N months), peak month highlighted — the
    web's dedicated monthly-mileage chart, adapted to a compact mobile bar row. */
export function RunningMileage({ mileage }: { mileage: number[] | null | undefined }) {
  const data = (mileage ?? []).filter((v) => isFinite(v));
  if (data.length < 2) return null;
  const max = Math.max(...data) || 1;
  const maxIdx = data.indexOf(max);
  const total = data.reduce((a, b) => a + b, 0);

  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Monthly mileage</Text>
        <Text variant="micro" className="text-text-muted">last {data.length} mo</Text>
      </View>
      <View className="h-24 flex-row items-end gap-1">
        {data.map((m, i) => (
          <View key={i} className="flex-1 items-center justify-end self-stretch">
            <View
              className="w-full rounded-t-sm"
              style={{ height: `${Math.max(3, (m / max) * 100)}%`, backgroundColor: i === maxIdx ? "#77c8d1" : "#2f4a58" }}
            />
          </View>
        ))}
      </View>
      <View className="flex-row justify-between">
        <Text variant="micro" className="text-text-muted">peak {Math.round(max)} km</Text>
        <Text variant="micro" className="tabular-nums text-text-muted">{Math.round(total)} km total</Text>
      </View>
    </Card>
  );
}
