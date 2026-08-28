import { View } from "react-native";
import { Text, Card } from "soma-style";
import { LineChart } from "./line-chart";

/** Decimal minutes → "M:SS" pace label. */
function paceLabel(mins: number): string {
  const t = Math.round(mins * 60);
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Dedicated Pace Progression + VO2max Trend charts (web parity, #435).
 * Both series come from /api/running/stats `trends` (already fetched by the
 * screen) — the summary cards show these as sparklines; these render them as
 * full LineCharts with axis labels, matching the web's ExpandableChartCards.
 */
export function RunningPaceVo2Charts({
  pace,
  vo2max,
}: {
  pace: number[] | null | undefined;
  vo2max: number[] | null | undefined;
}) {
  const paceVals = (pace ?? []).filter((v) => isFinite(v));
  const vo2Vals = (vo2max ?? []).filter((v) => isFinite(v));
  if (paceVals.length < 2 && vo2Vals.length < 2) return null;

  return (
    <View className="gap-4">
      {paceVals.length >= 2 ? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Pace progression</Text>
            <Text variant="micro" className="text-text-muted">min/km · lower is faster</Text>
          </View>
          <LineChart
            height={140}
            yFormat={(v) => paceLabel(v)}
            series={[{ values: paceVals, color: "#cbe896", width: 2.2 }]}
          />
        </Card>
      ) : null}

      {vo2Vals.length >= 2 ? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">VO₂max trend</Text>
            <Text variant="micro" className="text-text-muted">ml/kg/min</Text>
          </View>
          <LineChart
            height={140}
            yFormat={(v) => v.toFixed(1)}
            series={[{ values: vo2Vals, color: "#e0a458", width: 2.2 }]}
          />
        </Card>
      ) : null}
    </View>
  );
}
