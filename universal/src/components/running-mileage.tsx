import { View } from "react-native";
import { Text, Card } from "soma-style";

interface MileageMonth { month: string; km: number; runs: number }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(ym: string): string {
  const [, m] = ym.split("-").map(Number);
  return MONTHS[(m ?? 1) - 1] ?? ym;
}

/** Monthly mileage bar chart (last N months), peak month highlighted. When the
    dated detail is available each bar is labelled with its month + run count
    (web parity); otherwise it falls back to the value-only series. */
export function RunningMileage({ mileage, months }: { mileage?: number[] | null; months?: MileageMonth[] | null }) {
  const detail = (months ?? []).filter((m) => isFinite(m.km));
  const useDetail = detail.length >= 2;
  const values = useDetail ? detail.map((m) => m.km) : (mileage ?? []).filter((v) => isFinite(v));
  if (values.length < 2) return null;
  const max = Math.max(...values) || 1;
  const maxIdx = values.indexOf(max);
  const total = values.reduce((a, b) => a + b, 0);

  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Monthly mileage</Text>
        <Text variant="micro" className="text-text-muted">last {values.length} mo</Text>
      </View>
      <View className="h-24 flex-row items-end gap-1">
        {values.map((m, i) => (
          <View key={i} className="flex-1 items-center justify-end self-stretch">
            <View
              className="w-full rounded-t-sm"
              style={{ height: `${Math.max(3, (m / max) * 100)}%`, backgroundColor: i === maxIdx ? "#77c8d1" : "#2f4a58" }}
            />
          </View>
        ))}
      </View>
      {useDetail ? (
        <View className="flex-row gap-1">
          {detail.map((m, i) => (
            <View key={i} className="flex-1 items-center">
              <Text variant="micro" className="text-text-muted">{monthLabel(m.month)}</Text>
              <Text variant="micro" className="tabular-nums text-text-muted">{Math.round(m.km)}·{m.runs}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View className="flex-row justify-between">
        <Text variant="micro" className="text-text-muted">
          peak {Math.round(max)} km{useDetail ? ` · ${MONTHS.length && detail[maxIdx] ? monthLabel(detail[maxIdx].month) : ""}` : ""}
        </Text>
        <Text variant="micro" className="tabular-nums text-text-muted">
          {Math.round(total)} km{useDetail ? ` · ${detail.reduce((a, b) => a + b.runs, 0)} runs` : " total"}
        </Text>
      </View>
    </Card>
  );
}
