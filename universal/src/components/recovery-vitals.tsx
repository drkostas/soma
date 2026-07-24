import { View } from "react-native";
import { Text, Card, Badge, Sparkline } from "soma-style";
import type { RecoverySummary } from "../lib/api";

const HRV_TONE: Record<string, "success" | "warm" | "danger" | "teal"> = {
  BALANCED: "success",
  UNBALANCED: "warm",
  LOW: "danger",
};
const RDY_TONE = (level: string | null): "success" | "warm" | "danger" | "teal" => {
  const l = (level ?? "").toUpperCase();
  if (l.includes("PRIME") || l.includes("HIGH") || l.includes("READY")) return "success";
  if (l.includes("LOW") || l.includes("POOR")) return "danger";
  return "warm";
};

/** HRV + training-readiness cards (recovery vitals), fed by /api/recovery/summary. */
export function RecoveryVitals({ summary }: { summary: RecoverySummary | null | undefined }) {
  if (!summary) return null;
  const hrv = summary.hrv.latest;
  const rdy = summary.readiness.latest;
  const hrvSeries = summary.hrv.trend.map((p) => p.weekly_avg).filter((v): v is number => v != null);

  const factors: { label: string; v: number | null; color: string }[] = rdy
    ? [
        { label: "HRV", v: rdy.hrv_pct, color: "#6ad4a0" },
        { label: "Stress", v: rdy.stress_pct, color: "#e0a458" },
        { label: "ACWR", v: rdy.acwr_pct, color: "#6aa0e0" },
        { label: "Recovery", v: rdy.recovery_pct, color: "#c084fc" },
        { label: "Sleep hist.", v: rdy.sleep_history_pct, color: "#a5b4fc" },
      ].filter((f) => f.v != null)
    : [];

  if (!hrv && !rdy) return null;

  return (
    <View className="gap-4">
      {hrv ? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Heart rate variability</Text>
            {hrv.status ? <Badge label={hrv.status} tone={HRV_TONE[hrv.status] ?? "teal"} /> : null}
          </View>
          <View className="flex-row items-end gap-2">
            <Text variant="display" className="text-teal">{hrv.weekly_avg ?? "—"}</Text>
            <Text variant="caption" className="text-text-muted mb-1">ms weekly avg</Text>
            {hrv.last_night_avg != null ? (
              <Text variant="micro" className="text-text-muted mb-1">· last night {hrv.last_night_avg}</Text>
            ) : null}
          </View>
          {hrvSeries.length >= 2 ? <Sparkline data={hrvSeries} color="#77c8d1" height={36} baseline /> : null}
        </Card>
      ) : null}

      {rdy ? (
        <Card className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Training readiness</Text>
            {rdy.level ? <Badge label={rdy.level} tone={RDY_TONE(rdy.level)} /> : null}
          </View>
          <View className="flex-row items-end gap-2">
            <Text variant="display" className="text-lime">{rdy.score ?? "—"}</Text>
            <Text variant="caption" className="text-text-muted mb-1">/ 100</Text>
          </View>
          {factors.length ? (
            <View className="gap-2">
              {factors.map((f) => (
                <View key={f.label} className="gap-1">
                  <View className="flex-row justify-between">
                    <Text variant="micro" className="text-text-secondary">{f.label}</Text>
                    <Text variant="micro" className="tabular-nums text-text-muted">{f.v}%</Text>
                  </View>
                  <View className="h-1.5 rounded-full bg-surface-subtle overflow-hidden">
                    <View className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, f.v as number))}%`, backgroundColor: f.color }} />
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}
