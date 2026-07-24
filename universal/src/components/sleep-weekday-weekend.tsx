import { View } from "react-native";
import { Text, Card } from "soma-style";
import type { WeekdayWeekend } from "../lib/api";

const n = (v: unknown): number => Number(v);

/** Weekday vs weekend sleep comparison card, fed by /api/sleep/weekday-weekend. */
export function SleepWeekdayWeekend({ data }: { data: WeekdayWeekend | null | undefined }) {
  if (!data?.weekday || !data?.weekend) return null;
  const wd = data.weekday, we = data.weekend;
  const rows: { label: string; wd: string; we: string; diff: number; unit: string }[] = [
    { label: "Duration", wd: `${n(wd.avg_hours).toFixed(1)}h`, we: `${n(we.avg_hours).toFixed(1)}h`, diff: n(we.avg_hours) - n(wd.avg_hours), unit: "h" },
    { label: "Score", wd: `${Math.round(n(wd.avg_score))}`, we: `${Math.round(n(we.avg_score))}`, diff: n(we.avg_score) - n(wd.avg_score), unit: "" },
    { label: "Deep %", wd: `${Math.round(n(wd.avg_deep_pct))}%`, we: `${Math.round(n(we.avg_deep_pct))}%`, diff: n(we.avg_deep_pct) - n(wd.avg_deep_pct), unit: "%" },
  ];

  return (
    <Card className="gap-2">
      <Text variant="eyebrow">Weekday vs weekend</Text>
      <View className="flex-row justify-end gap-6 pr-1">
        <Text variant="micro" className="text-text-muted w-12 text-right">Weekday</Text>
        <Text variant="micro" className="text-text-muted w-12 text-right">Weekend</Text>
      </View>
      {rows.map((r) => (
        <View key={r.label} className="flex-row items-center border-b border-border-subtle py-1.5">
          <Text variant="body" className="text-text-secondary flex-1">
            {r.label}
            <Text variant="micro" className={r.diff >= 0 ? "text-success" : "text-warning"}>
              {"  "}{r.diff >= 0 ? "+" : ""}{Math.abs(r.diff) < 0.05 ? "0" : r.diff.toFixed(r.unit === "" ? 0 : 1)}{r.unit} wknd
            </Text>
          </Text>
          <Text variant="body" className="tabular-nums text-text w-12 text-right">{r.wd}</Text>
          <Text variant="body" className="tabular-nums text-text w-12 text-right">{r.we}</Text>
        </View>
      ))}
    </Card>
  );
}
