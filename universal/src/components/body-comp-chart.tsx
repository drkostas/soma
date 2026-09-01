import { View } from "react-native";
import { Text, Card, Badge } from "soma-style";
import { useBodyComp, type BodyComp } from "../lib/api";
import { LineChart, ChartLegend } from "./line-chart";

const C = {
  actual: "#a9e4ec", // light teal — raw weigh-ins (dots)
  smooth: "#77c8d1", // teal — smoothed line
  trend: "#77c8d1", // teal dashed — projection
  goal: "#e0a458", // warm — goal line
  deficit: "#6ad4a0", // green — cumulative deficit
};

const dayMs = 86400000;
function toDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}
function shortLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][(m ?? 1) - 1]} ${d}`;
}

/** Sorted unique union of every date across the given arrays. */
function axisOf(...arrs: { date: string }[][]): string[] {
  const set = new Set<string>();
  for (const a of arrs) for (const p of a) set.add(p.date);
  return [...set].sort();
}
/** Map a keyed series onto the axis; null where the axis date is absent. */
function alignBy(axis: string[], pts: { date: string }[], key: string): (number | null)[] {
  const m = new Map(pts.map((p) => [p.date, (p as Record<string, unknown>)[key] as number]));
  return axis.map((d) => (m.has(d) ? (m.get(d) as number) : null));
}
/** A straight line between the first and last of `pts`, sampled on the axis
 *  (null outside their date span). Used for the 2-point goal line. */
function interpLine(axis: string[], pts: { date: string }[], key: string): (number | null)[] {
  if (pts.length < 2) return axis.map(() => null);
  const a = pts[0], b = pts[pts.length - 1];
  const t0 = toDate(a.date), t1 = toDate(b.date);
  const y0 = (a as Record<string, unknown>)[key] as number;
  const y1 = (b as Record<string, unknown>)[key] as number;
  const span = t1 - t0 || 1;
  return axis.map((d) => {
    const t = toDate(d);
    if (t < t0 || t > t1) return null;
    return y0 + (y1 - y0) * ((t - t0) / span);
  });
}

function kg(v: number | null | undefined): string {
  return v == null ? "–" : `${v.toFixed(1)} kg`;
}

function StatusCard({ p }: { p: BodyComp["profile"] }) {
  const slope = p.trendSlope ?? 0;
  const losing = slope < 0;
  // Trend-based verdict (web parity): actual weekly-loss rate vs goal rate, not
  // the API's deficit-budget onTrack — those can disagree for the same weight data.
  const rateRatio = (p.weeklyRate ?? 0) > 0 ? Math.abs(slope) / (p.weeklyRate as number) : 0;
  const onTrack = slope < 0 && rateRatio >= 0.8;
  const behind = slope < 0 && rateRatio >= 0.3 && rateRatio < 0.8;
  const verdict = p.targetDatePassed ? { label: "Reset goal", tone: "danger" as const }
    : onTrack ? { label: "On track", tone: "success" as const }
    : behind ? { label: "Behind pace", tone: "warm" as const }
    : { label: "Off pace", tone: "danger" as const };
  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Body composition</Text>
        {p.trendSlope != null ? <Badge label={verdict.label} tone={verdict.tone} /> : null}
      </View>
      <View className="flex-row items-end gap-2">
        <Text variant="display" className="tabular-nums">{kg(p.latestActualWeight ?? p.currentWeight)}</Text>
        <Text variant="body" className="text-text-muted mb-1">→ {kg(p.targetWeight)}</Text>
      </View>
      <View className="flex-row flex-wrap gap-x-5 gap-y-1">
        <View>
          <Text variant="micro" className="text-text-muted">Body fat</Text>
          <Text variant="caption" className="tabular-nums">
            {(p.latestActualBf ?? p.currentBf)?.toFixed?.(1) ?? "–"}% → {p.targetBf?.toFixed?.(1) ?? "–"}%
          </Text>
        </View>
        <View>
          <Text variant="micro" className="text-text-muted">Trend</Text>
          <Text variant="caption" className={`tabular-nums ${losing ? "text-success" : "text-warm"}`}>
            {slope > 0 ? "+" : ""}{slope.toFixed(2)} kg/wk
          </Text>
        </View>
        {p.totalActualDeficit != null ? (
          <View>
            <Text variant="micro" className="text-text-muted">Total deficit</Text>
            <Text variant="caption" className="tabular-nums">{Math.round(p.totalActualDeficit).toLocaleString()} kcal</Text>
          </View>
        ) : null}
        {p.daysRemaining != null ? (
          <View>
            <Text variant="micro" className="text-text-muted">Days left</Text>
            <Text variant="caption" className="tabular-nums">{p.daysRemaining}</Text>
          </View>
        ) : null}
        {p.fatToLose != null && p.fatToLose > 0 ? (
          <View>
            <Text variant="micro" className="text-text-muted">Fat to lose</Text>
            <Text variant="caption" className="tabular-nums">{p.fatToLose.toFixed(1)} kg</Text>
          </View>
        ) : null}
        {p.avgActualDeficit != null ? (
          <View>
            <Text variant="micro" className="text-text-muted">Avg deficit</Text>
            <Text variant="caption" className="tabular-nums">{Math.round(p.avgActualDeficit).toLocaleString()}/day</Text>
          </View>
        ) : null}
      </View>
      {p.requiredDeficit != null && p.requiredDeficit > 0 ? (
        <Text variant="micro" className="text-text-muted">
          Need {Math.round(p.requiredDeficit).toLocaleString()} kcal/day{p.targetDate ? ` to hit ${shortLabel(p.targetDate)}` : ""}
          {p.avgActualDeficit != null ? ` · averaging ${Math.round(p.avgActualDeficit).toLocaleString()}` : ""}
        </Text>
      ) : null}
    </Card>
  );
}

/** Full body-composition trajectory for the nutrition Trend tab: a status
 *  card + Weight, Body-Fat%, and Cumulative-Deficit charts. */
export function BodyCompChart({ visible }: { visible: boolean }) {
  const { data, loading } = useBodyComp(visible);
  if (!visible) return null;
  if (loading && !data) return <Card><Text variant="body" className="text-text-secondary">Loading trajectory…</Text></Card>;
  if (!data) return null;

  const { profile, weights, goalLine, trendPrediction, dailyDeficits, goalDeficit } = data;

  // Weight + BF% share one date axis (weigh-ins + goal + projection).
  const wAxis = axisOf(weights, goalLine, trendPrediction);
  const wLabels = wAxis.map(shortLabel);
  const actual = alignBy(wAxis, weights, "weight");
  const smoothed = alignBy(wAxis, weights, "smoothed");
  const wTrend = alignBy(wAxis, trendPrediction, "weight");
  const wGoal = interpLine(wAxis, goalLine, "weight");
  const bfActual = alignBy(wAxis, weights, "bf");
  const bfSmooth = alignBy(wAxis, weights, "smoothedBf");
  const bfTrend = alignBy(wAxis, trendPrediction, "bf");
  const bfGoal = interpLine(wAxis, goalLine, "bf");

  const dAxis = dailyDeficits.map((d) => d.date);
  const dLabels = dAxis.map(shortLabel);
  const cumulative = dailyDeficits.map((d) => d.cumulative);
  const goalPace = dailyDeficits.map((d) => d.goalPace);
  // Burn-vs-eaten: total burn (BMR + steps + runs + gym) against calories eaten;
  // the gap is the day's deficit.
  const burn = dailyDeficits.map((d) => (d.totalBurn != null ? d.totalBurn : null));
  const eaten = dailyDeficits.map((d) => (d.consumed != null ? d.consumed : null));
  const hasBurn = dailyDeficits.some((d) => d.totalBurn != null && d.consumed != null);

  const legend = [
    { color: C.actual, label: "Weigh-in" },
    { color: C.smooth, label: "Smoothed" },
    { color: C.trend, label: "Projected", dashed: true },
    { color: C.goal, label: "Goal", dashed: true },
  ];

  return (
    <View className="gap-4">
      <StatusCard p={profile} />

      <Card className="gap-2">
        <Text variant="eyebrow">Weight</Text>
        <LineChart
          height={140}
          labels={wLabels}
          yFormat={(v) => `${v.toFixed(1)}`}
          series={[
            { values: wGoal, color: C.goal, dashed: true, width: 1.5 },
            { values: wTrend, color: C.trend, dashed: true, width: 1.5 },
            { values: smoothed, color: C.smooth, width: 2.2 },
            { values: actual, color: C.actual, mode: "dots" },
          ]}
        />
        <ChartLegend items={legend} />
      </Card>

      <Card className="gap-2">
        <Text variant="eyebrow">Body fat %</Text>
        <LineChart
          height={140}
          labels={wLabels}
          yFormat={(v) => `${v.toFixed(1)}%`}
          series={[
            { values: bfGoal, color: C.goal, dashed: true, width: 1.5 },
            { values: bfTrend, color: C.trend, dashed: true, width: 1.5 },
            { values: bfSmooth, color: C.smooth, width: 2.2 },
            { values: bfActual, color: C.actual, mode: "dots" },
          ]}
        />
        <ChartLegend items={legend} />
      </Card>

      {dailyDeficits.length >= 2 ? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Cumulative deficit</Text>
            <Text variant="micro" className="text-text-muted tabular-nums">goal {Math.round(goalDeficit)}/day</Text>
          </View>
          <LineChart
            height={130}
            labels={dLabels}
            yFormat={(v) => `${Math.round(v / 1000)}k`}
            series={[
              { values: goalPace, color: "#3a5563", dashed: true, width: 1.5 },
              { values: cumulative, color: C.deficit, width: 2.2 },
            ]}
          />
          <ChartLegend items={[
            { color: C.deficit, label: "Actual" },
            { color: "#3a5563", label: "Goal pace", dashed: true },
          ]} />
        </Card>
      ) : null}

      {hasBurn && dailyDeficits.length >= 2 ? (
        <Card className="gap-2">
          <Text variant="eyebrow">Burn vs eaten</Text>
          <LineChart
            height={140}
            labels={dLabels}
            yFormat={(v) => `${Math.round(v).toLocaleString()}`}
            series={[
              { values: burn, color: C.goal, width: 2.2, label: "Burn" },
              { values: eaten, color: C.smooth, mode: "dots", width: 3, label: "Eaten" },
            ]}
          />
          <ChartLegend items={[
            { color: C.goal, label: "Total burn" },
            { color: C.smooth, label: "Eaten" },
          ]} />
          <Text variant="micro" className="text-text-muted">The gap is the day&apos;s deficit — burn from BMR + steps + runs + gym.</Text>
        </Card>
      ) : null}
    </View>
  );
}
