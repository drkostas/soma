import { View } from "react-native";
import { Text, Card } from "soma-style";
import { LineChart, ChartLegend } from "./line-chart";
import type { SchedulePoint } from "../lib/api";

const BED = "#8b7fe0"; // bedtime line (indigo)
const WAKE = "#e0a458"; // wake line (amber)

/** Decimal hour (may be ≥24 for after-midnight values) → "H:MM AM/PM". */
function fmtHour(h: number): string {
  const actual = h >= 24 ? h - 24 : h;
  const whole = Math.floor(actual);
  const mins = Math.round((actual - whole) * 60);
  const ampm = whole >= 12 ? "PM" : "AM";
  const h12 = whole % 12 === 0 ? 12 : whole % 12;
  return `${h12}:${String(mins).padStart(2, "0")} ${ampm}`;
}

const chartLabel = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(m ?? 1) - 1]} ${d}`;
};

/**
 * Per-night sleep-schedule chart: bedtime + wake time across the range, on a
 * continuous clock axis. Bedtimes before 6 PM are wrapped to the next day
 * (+24) so an overnight window reads as a single band between the two lines.
 * Mirrors the web SleepScheduleChart; fed by /api/sleep/schedule `schedule[]`.
 */
export function SleepScheduleChart({ schedule }: { schedule: SchedulePoint[] | undefined }) {
  const pts = (schedule ?? []).filter(
    (p) => isFinite(p.bedtimeHour) && isFinite(p.wakeHour),
  );
  if (pts.length < 2) return null;
  const recent = pts.slice(-30);

  const norm = (h: number) => (h < 18 ? h + 24 : h); // wrap early-morning bedtimes
  const bedtimes = recent.map((p) => norm(p.bedtimeHour));
  const wakes = recent.map((p) => p.wakeHour);
  const labels = recent.map((p) => chartLabel(p.date));

  // Last-7-night average bedtime → wake, shown in the header (matches web).
  const last7 = recent.slice(-7);
  const avgBed = last7.reduce((s, p) => s + norm(p.bedtimeHour), 0) / last7.length;
  const avgWake = last7.reduce((s, p) => s + p.wakeHour, 0) / last7.length;

  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Sleep schedule</Text>
        <Text variant="micro" className="text-text-muted tabular-nums">
          {fmtHour(avgBed)} → {fmtHour(avgWake)}
        </Text>
      </View>
      <LineChart
        height={150}
        labels={labels}
        yFormat={(v) => fmtHour(v)}
        series={[
          { values: bedtimes, color: BED, width: 2.2 },
          { values: wakes, color: WAKE, width: 2.2 },
        ]}
      />
      <ChartLegend items={[{ color: BED, label: "Bedtime" }, { color: WAKE, label: "Wake" }]} />
    </Card>
  );
}
