import { View } from "react-native";
import { Text, Card } from "soma-style";
import { useToday, useTraining, useSleepSummary, todayLocal } from "../lib/api";

const TL_COLOR: Record<string, string> = {
  green: "#6ad4a0", yellow: "#e0c458", red: "#e06060", amber: "#e0a458",
};
const tlColor = (t: string | null | undefined) => TL_COLOR[(t ?? "").toLowerCase()] ?? "#8aa0ac";

function Chip({ icon, label, value, color }: { icon?: string; label: string; value: string; color?: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      {color ? <View className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} /> : icon ? <Text variant="micro">{icon}</Text> : null}
      <Text variant="micro" className="tabular-nums" style={color ? { color } : undefined}>{value}</Text>
      <Text variant="micro" className="text-text-muted">{label}</Text>
    </View>
  );
}

/**
 * Today's training + recovery context on the nutrition screen (web parity):
 * steps, training readiness/form, and last night's sleep — the signals that
 * explain why today's targets look the way they do. Renders only what's
 * present; nothing when no context has loaded.
 */
export function NutritionContextStrip() {
  const { data: today } = useToday();
  const { data: training } = useTraining(todayLocal());
  const { data: sleep } = useSleepSummary("7d");

  const steps = today?.total_steps;
  const tl = training?.readiness?.traffic_light;
  const tsb = training?.pmc?.tsb;
  const ln = sleep?.lastNight;
  const sleepH = ln?.total != null ? ln.total / 3600 : null;

  const chips: React.ReactNode[] = [];
  if (steps != null && steps > 0) chips.push(<Chip key="steps" icon="👟" value={steps.toLocaleString()} label="steps" />);
  if (tl) chips.push(<Chip key="rdy" color={tlColor(tl)} value={tl} label="readiness" />);
  if (tsb != null && isFinite(tsb)) chips.push(<Chip key="form" icon="📈" value={`${tsb > 0 ? "+" : ""}${Math.round(tsb)}`} label="form" />);
  if (sleepH != null && sleepH > 0) chips.push(<Chip key="sleep" icon="💤" value={`${sleepH.toFixed(1)}h${ln?.score != null ? ` · ${ln.score}` : ""}`} label="slept" />);

  if (!chips.length) return null;

  return (
    <Card className="flex-row flex-wrap items-center gap-x-4 gap-y-1.5 py-2.5">
      {chips}
    </Card>
  );
}
