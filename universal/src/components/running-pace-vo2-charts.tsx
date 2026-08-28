import { View } from "react-native";
import { Text, Card } from "soma-style";
import { LineChart, ExpandableChart } from "./line-chart";

/** Decimal minutes → "M:SS" pace label. */
function paceLabel(mins: number): string {
  const t = Math.round(mins * 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * Dedicated Pace Progression + VO2max Trend charts (web parity). Both tap-to-
 * read and fullscreen-expandable; VO2max carries an average reference line.
 * Series come from /api/running/stats `trends`.
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
  const vo2Avg = vo2Vals.length ? vo2Vals.reduce((a, b) => a + b, 0) / vo2Vals.length : 0;

  return (
    <View className="gap-4">
      {paceVals.length >= 2 ? (
        <Card className="gap-2">
          <ExpandableChart
            title="Pace progression"
            chart={{ series: [{ values: paceVals, color: "#cbe896", width: 2.2 }], yFormat: paceLabel }}
          >
            <LineChart height={140} interactive yFormat={paceLabel} series={[{ values: paceVals, color: "#cbe896", width: 2.2 }]} />
          </ExpandableChart>
          <Text variant="micro" className="text-text-muted">min/km · lower is faster · tap to read</Text>
        </Card>
      ) : null}

      {vo2Vals.length >= 2 ? (
        <Card className="gap-2">
          <ExpandableChart
            title="VO₂max trend"
            chart={{ series: [{ values: vo2Vals, color: "#e0a458", width: 2.2 }], yFormat: (v) => v.toFixed(1), refLine: { y: vo2Avg, color: "#5a7a8a" } }}
          >
            <LineChart height={140} interactive yFormat={(v) => v.toFixed(1)} refLine={{ y: vo2Avg, color: "#5a7a8a" }} series={[{ values: vo2Vals, color: "#e0a458", width: 2.2 }]} />
          </ExpandableChart>
          <Text variant="micro" className="text-text-muted">ml/kg/min · dashed = average {vo2Avg.toFixed(1)}</Text>
        </Card>
      ) : null}
    </View>
  );
}
