import { View } from "react-native";
import { Text, Card } from "soma-style";
import { LineChart, ExpandableChart, type LineChartProps } from "./line-chart";

interface MileageMonth { month: string; km: number; runs: number }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(ym: string): string {
  const [, m] = ym.split("-").map(Number);
  return MONTHS[(m ?? 1) - 1] ?? ym;
}

/** Monthly mileage as web's bar chart: km axis, month ticks, tap-to-read, expandable
    (soma#771). With the dated detail each month also lists its run count; without it
    the value-only series is drawn. Peak month highlighted in the footer. */
export function RunningMileage({ mileage, months }: { mileage?: number[] | null; months?: MileageMonth[] | null }) {
  const detail = (months ?? []).filter((m) => isFinite(m.km));
  const useDetail = detail.length >= 2;
  const values = useDetail ? detail.map((m) => m.km) : (mileage ?? []).filter((v) => isFinite(v));
  if (values.length < 2) return null;
  const max = Math.max(...values) || 1;
  const maxIdx = values.indexOf(max);
  const total = values.reduce((a, b) => a + b, 0);
  const labels = useDetail ? detail.map((m) => monthLabel(m.month)) : values.map((_, i) => `${i + 1}`);
  const chart: LineChartProps = {
    labels,
    xTicks: Math.min(values.length, 6),
    yMin: 0,
    yFormat: (v) => `${Math.round(v)}`,
    series: [{ values, color: "#77c8d1", mode: "bars", label: "km" }],
  };

  return (
    <Card className="gap-2">
      <ExpandableChart title="Monthly mileage" chart={chart}>
        <Text variant="micro" className="text-text-muted">km per month</Text>
        <LineChart height={120} interactive {...chart} />
      </ExpandableChart>
      {useDetail ? (
        <View className="flex-row gap-1">
          {detail.map((m, i) => (
            <View key={i} className="flex-1 items-center">
              <Text variant="micro" className="tabular-nums text-text-muted">{Math.round(m.km)}·{m.runs}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View className="flex-row justify-between">
        <Text variant="micro" className="text-text-muted">
          peak {Math.round(max)} km{useDetail && detail[maxIdx] ? ` · ${monthLabel(detail[maxIdx].month)}` : ""} · last {values.length} mo{useDetail ? " · km·runs" : ""}
        </Text>
        <Text variant="micro" className="tabular-nums text-text-muted">
          {Math.round(total)} km{useDetail ? ` · ${detail.reduce((a, b) => a + b.runs, 0)} runs` : " total"}
        </Text>
      </View>
    </Card>
  );
}
