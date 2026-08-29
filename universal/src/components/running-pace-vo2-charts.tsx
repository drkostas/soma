import { View } from "react-native";
import { Text, Card } from "soma-style";
import { LineChart, ExpandableChart, ChartLegend, chartDateLabel } from "./line-chart";

interface PacePoint { date: string; pace: number; distance: number }

/** Decimal minutes → "M:SS" pace label. */
function paceLabel(mins: number): string {
  const t = Math.round(mins * 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** Trailing moving average over a numeric series. */
function movingAvg(vals: number[], window: number): (number | null)[] {
  return vals.map((_, i) => {
    const lo = Math.max(0, i - window + 1);
    const slice = vals.slice(lo, i + 1);
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

/**
 * Dedicated Pace Progression + VO2max Trend charts (web parity). When the dated
 * pace detail is available the pace chart is a per-run scatter (dots sized by
 * distance) over a dated axis with a moving-average line; otherwise a value-only
 * line. Both tap-to-read and fullscreen-expandable.
 */
export function RunningPaceVo2Charts({
  pace,
  vo2max,
  paceDetail,
}: {
  pace: number[] | null | undefined;
  vo2max: number[] | null | undefined;
  paceDetail?: PacePoint[] | null;
}) {
  const paceVals = (pace ?? []).filter((v) => isFinite(v));
  const vo2Vals = (vo2max ?? []).filter((v) => isFinite(v));
  if (paceVals.length < 2 && vo2Vals.length < 2) return null;
  const vo2Avg = vo2Vals.length ? vo2Vals.reduce((a, b) => a + b, 0) / vo2Vals.length : 0;

  const detail = (paceDetail ?? []).filter((p) => isFinite(p.pace));
  const useScatter = detail.length >= 3;
  const labels = detail.map((p) => chartDateLabel(p.date));
  const paceSeries = detail.map((p) => p.pace);
  const maxD = Math.max(...detail.map((p) => p.distance || 0), 1);
  const sizes = detail.map((p) => 2 + ((p.distance || 0) / maxD) * 4);
  const ma = movingAvg(paceSeries, Math.max(2, Math.round(detail.length / 5)));
  const scatterSeries = [
    { values: paceSeries, color: "#cbe896", mode: "dots" as const, sizes },
    { values: ma, color: "#e0a458", width: 1.8 },
  ];

  return (
    <View className="gap-4">
      {useScatter ? (
        <Card className="gap-2">
          <ExpandableChart title="Pace progression" chart={{ series: scatterSeries, labels, yFormat: paceLabel }}>
            <LineChart height={150} interactive xTicks={4} labels={labels} yFormat={paceLabel} series={scatterSeries} />
          </ExpandableChart>
          <ChartLegend items={[{ color: "#cbe896", label: "per run (dot = distance)" }, { color: "#e0a458", label: "moving avg" }]} />
          <Text variant="micro" className="text-text-muted">min/km · lower is faster · tap to read</Text>
        </Card>
      ) : paceVals.length >= 2 ? (
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
