import { ScrollView, View } from "react-native";
import { Text, Card } from "soma-style";
import { useToday } from "../../lib/api";

export default function OverviewScreen() {
  const { data, error } = useToday();

  const km = data?.total_distance_meters ? (data.total_distance_meters / 1000).toFixed(1) : "—";
  const stats: { label: string; value: string; sub: string; cls: string }[] = [
    { label: "Steps", value: (data?.total_steps ?? 0).toLocaleString(), sub: `${km} km`, cls: "text-teal" },
    { label: "Active Calories", value: `${Math.round(data?.active_kilocalories ?? 0)}`, sub: `${Math.round(data?.total_kilocalories ?? 0)} total`, cls: "text-warm" },
    { label: "Resting HR", value: `${data?.resting_heart_rate ?? "—"}`, sub: `${data?.min_heart_rate ?? "—"}–${data?.max_heart_rate ?? "—"} bpm`, cls: "text-danger" },
    { label: "Avg Stress", value: `${data?.avg_stress_level ?? "—"}`, sub: `Peak ${data?.max_stress_level ?? "—"}`, cls: "text-warning" },
    { label: "Body Battery", value: `${data?.body_battery_max ?? "—"}`, sub: `−${data?.body_battery_drained ?? 0} drained`, cls: "text-lime" },
    { label: "Intensity min", value: `${(data?.moderate_intensity_minutes ?? 0) + (data?.vigorous_intensity_minutes ?? 0)}`, sub: `${data?.vigorous_intensity_minutes ?? 0} vigorous`, cls: "text-indigo" },
  ];

  return (
    <ScrollView className="flex-1 bg-base" contentContainerClassName="items-center px-5 py-6">
      <View className="w-full max-w-3xl gap-4">
        <View className="gap-1">
          <Text variant="headline">Overview</Text>
          <Text variant="caption" className="text-text-secondary">Latest health metrics</Text>
        </View>
        {error ? <Card><Text variant="body" className="text-danger">API: {error}</Text></Card> : null}
        <View className="flex-row flex-wrap gap-3">
          {stats.map((s) => (
            <Card key={s.label} className="min-w-[46%] flex-1 gap-1">
              <Text variant="eyebrow">{s.label}</Text>
              <Text variant="headline" className={s.cls}>{s.value}</Text>
              <Text variant="micro">{s.sub}</Text>
            </Card>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
