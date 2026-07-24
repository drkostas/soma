import { View } from "react-native";
import { Text, Card, Badge } from "soma-style";
import type { SleepScheduleData } from "../lib/api";

/** Decimal hour (may be >24 for after-midnight bedtimes) → "H:MM AM/PM". */
function fmtHour(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  const whole = Math.floor(hh);
  const mins = Math.round((hh - whole) * 60);
  const ampm = whole < 12 ? "AM" : "PM";
  const h12 = whole % 12 === 0 ? 12 : whole % 12;
  return `${h12}:${String(mins).padStart(2, "0")} ${ampm}`;
}
function scoreLabel(s: number): { label: string; tone: "success" | "warm" | "danger" } {
  if (s >= 80) return { label: "Consistent", tone: "success" };
  if (s >= 60) return { label: "Moderate", tone: "warm" };
  return { label: "Irregular", tone: "danger" };
}

/** Sleep regularity card (bedtime/wake consistency), fed by /api/sleep/schedule. */
export function SleepRegularity({ data }: { data: SleepScheduleData | null | undefined }) {
  const r = data?.regularity;
  if (!r || r.regularity_score == null) return null;
  const sl = scoreLabel(r.regularity_score);
  const rows: { label: string; value: string; varMin: number }[] = [
    { label: "Avg bedtime", value: fmtHour(r.avg_bedtime), varMin: Math.round(r.bedtime_stddev * 60) },
    { label: "Avg wake", value: fmtHour(r.avg_waketime), varMin: Math.round(r.waketime_stddev * 60) },
    { label: "Avg duration", value: `${r.avg_duration.toFixed(1)}h`, varMin: Math.round(r.duration_stddev * 60) },
  ];

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Sleep regularity</Text>
        <Badge label={sl.label} tone={sl.tone} />
      </View>
      <View className="flex-row items-end gap-2">
        <Text variant="display" className="text-teal">{r.regularity_score}</Text>
        <Text variant="caption" className="text-text-muted mb-1">/ 100 consistency</Text>
      </View>
      <View className="gap-2">
        {rows.map((row) => (
          <View key={row.label} className="flex-row items-center justify-between border-b border-border-subtle py-1.5">
            <Text variant="body" className="text-text-secondary">{row.label}</Text>
            <View className="flex-row items-baseline gap-2">
              <Text variant="body" className="tabular-nums text-text">{row.value}</Text>
              <Text variant="micro" className="text-text-muted">±{row.varMin}m</Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}
