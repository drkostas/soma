import { View } from "react-native";
import { Text, Card } from "soma-style";
import { LineChart, ChartLegend, ExpandableChart, type LineChartProps } from "./line-chart";
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
  // Whole hours (the axis ticks) stay compact so they fit the axis column; readouts keep minutes.
  return mins === 0 ? `${h12} ${ampm}` : `${h12}:${String(mins).padStart(2, "0")} ${ampm}`;
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

  // Web's domain: whole hours around the data (floor−1 … ceil+1, clamped 0…33, ≥6 h span),
  // on a REVERSED axis so the earlier clock time sits at the top (wake above bedtime).
  const all = [...bedtimes, ...wakes];
  let lo = Math.max(0, Math.floor(Math.min(...all)) - 1);
  let hi = Math.min(33, Math.ceil(Math.max(...all)) + 1);
  if (hi - lo < 6) { const mid = (lo + hi) / 2; lo = Math.floor(mid - 3); hi = Math.ceil(mid + 3); }
  // Five whole-hour ticks: stretch the span to a multiple of 4 h (downwards, the top is the wake side).
  const Y_TICKS = 5;
  lo = hi - Math.ceil((hi - lo) / (Y_TICKS - 1)) * (Y_TICKS - 1);

  // Web draws bedtime and wake as two stacked Areas, so the night reads as one filled band.
  const chart: LineChartProps = {
    labels,
    xTicks: 4,
    yMin: lo,
    yMax: hi,
    yTicks: Y_TICKS,
    invertY: true,
    yFormat: (v) => fmtHour(v),
    bands: [{ a: 0, b: 1, color: BED, opacity: 0.22 }],
    series: [
      { values: bedtimes, color: BED, width: 2.2, label: "Bedtime" },
      { values: wakes, color: WAKE, width: 2.2, label: "Wake" },
    ],
  };
  return (
    <Card className="gap-2">
      <ExpandableChart title="Sleep schedule" chart={chart}>
        <Text variant="micro" className="text-text-muted tabular-nums">{fmtHour(avgBed)} → {fmtHour(avgWake)} · last 7 nights</Text>
        <LineChart height={150} interactive {...chart} />
      </ExpandableChart>
      <ChartLegend items={[{ color: BED, label: "Bedtime" }, { color: WAKE, label: "Wake" }, { color: BED, label: "asleep (band)" }]} />
    </Card>
  );
}
