import { View } from "react-native";
import { Text, Card } from "soma-style";
import { ExpandableChart } from "./line-chart";

interface MileageMonth { month: string; km: number; runs: number }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(ym: string): string {
  const [, m] = ym.split("-").map(Number);
  return MONTHS[(m ?? 1) - 1] ?? ym;
}

/** Monthly mileage bar chart (last N months), peak month highlighted. When the
    dated detail is available each bar is labelled with its month + run count
    (web parity); otherwise it falls back to the value-only series. Expands
    into a taller copy like web's ExpandableChartCard (soma#756). */
function MileageBars({ values, maxIdx, height }: { values: number[]; maxIdx: number; height: number }) {
  const max = Math.max(...values) || 1;
  return (
    <View className="flex-row items-end gap-1" style={{ height }}>
      {values.map((m, i) => (
        <View key={i} className="flex-1 items-center justify-end self-stretch">
          <View
            className="w-full rounded-t-sm"
            style={{ height: `${Math.max(3, (m / max) * 100)}%`, backgroundColor: i === maxIdx ? "#77c8d1" : "#2f4a58" }}
          />
        </View>
      ))}
    </View>
  );
}

export function RunningMileage({ mileage, months }: { mileage?: number[] | null; months?: MileageMonth[] | null }) {
  const detail = (months ?? []).filter((m) => isFinite(m.km));
  const useDetail = detail.length >= 2;
  const values = useDetail ? detail.map((m) => m.km) : (mileage ?? []).filter((v) => isFinite(v));
  if (values.length < 2) return null;
  const max = Math.max(...values) || 1;
  const maxIdx = values.indexOf(max);
  const total = values.reduce((a, b) => a + b, 0);
  const labelsRow = useDetail ? (
    <View className="flex-row gap-1">
      {detail.map((m, i) => (
        <View key={i} className="flex-1 items-center">
          <Text variant="micro" className="text-text-muted">{monthLabel(m.month)}</Text>
          <Text variant="micro" className="tabular-nums text-text-muted">{Math.round(m.km)}·{m.runs}</Text>
        </View>
      ))}
    </View>
  ) : null;

  return (
    <Card className="gap-2">
      <ExpandableChart title="Monthly mileage" renderExpanded={() => <View className="gap-2"><MileageBars values={values} maxIdx={maxIdx} height={220} />{labelsRow}</View>}>
        <MileageBars values={values} maxIdx={maxIdx} height={96} />
      </ExpandableChart>
      {labelsRow}
      <View className="flex-row justify-between">
        <Text variant="micro" className="text-text-muted">
          peak {Math.round(max)} km{useDetail ? ` · ${MONTHS.length && detail[maxIdx] ? monthLabel(detail[maxIdx].month) : ""}` : ""} · last {values.length} mo
        </Text>
        <Text variant="micro" className="tabular-nums text-text-muted">
          {Math.round(total)} km{useDetail ? ` · ${detail.reduce((a, b) => a + b.runs, 0)} runs` : " total"}
        </Text>
      </View>
    </Card>
  );
}
