import { View } from "react-native";
import { Text, Card, Badge } from "soma-style";
import { useBodyComp, type BodyComp } from "../lib/api";
import { LineChart, ChartLegend, ExpandableChart, type LineChartProps } from "./line-chart";
import { goalPaceSeries } from "../lib/body-comp-pace";

const C = {
  actual: "#a9e4ec", // light teal — raw weigh-ins (dots)
  smooth: "#77c8d1", // teal — smoothed line
  trend: "#77c8d1", // teal dashed — projection
  goal: "#e0a458", // warm — goal line
  deficit: "#6ad4a0", // green — cumulative deficit
  pace: "#e0a458", // warm — goal pace (web's orange)
  // Web's burn components (stacked bars): BMR slate, daily activity teal, run blue, gym orange.
  bmr: "#94a3b8",
  activity: "#14b8a6",
  run: "#3b82f6",
  gym: "#f97316",
  eaten: "#77c8d1",
  goalLine: "#ffffff",
};

const dayMs = 86400000;
function toDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}
function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
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

/** Web's trajectory status line (body-comp-chart.tsx statusText): the target-date verdict
 *  with the goal date, or the date the current rate reaches the goal (soma#782). */
function statusLine(p: BodyComp["profile"]): { text: string; tone: "danger" | "success" | "warm"; hint?: string } {
  const slope = p.trendSlope ?? 0;
  const actualRate = Math.abs(slope);
  const rateRatio = (p.weeklyRate ?? 0) > 0 ? actualRate / (p.weeklyRate as number) : 0;
  const onTrack = slope < 0 && rateRatio >= 0.8;
  const behind = slope < 0 && rateRatio >= 0.3 && rateRatio < 0.8;
  const goal = p.targetDate ? shortLabel(p.targetDate) : null;
  if (p.targetDatePassed) {
    return { text: "Target date passed — adjust goal", tone: "danger", hint: "Consider extending your target date or adjusting your goal" };
  }
  if (onTrack) return { text: `On track${goal ? ` · goal ${goal}` : ""}${p.daysRemaining != null ? ` (${p.daysRemaining}d)` : ""}`, tone: "success" };
  if (actualRate > 0 && p.fatToLose != null && p.fatToLose > 0) {
    const predicted = shortLabel(isoOf(Date.now() + Math.round((p.fatToLose / actualRate) * 7) * dayMs));
    return { text: `Behind pace${goal ? ` · goal ${goal}` : ""} · at current rate: ${predicted}`, tone: behind ? "warm" : "danger" };
  }
  return { text: `Behind pace${goal ? ` · goal ${goal}` : ""}${p.daysRemaining != null ? ` (${p.daysRemaining}d)` : ""}`, tone: "danger" };
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
  const status = p.trendSlope != null || p.targetDatePassed ? statusLine(p) : null;
  const toneClass = status?.tone === "success" ? "text-success" : status?.tone === "warm" ? "text-warm" : "text-danger";
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
      {status ? (
        <View testID="bodycomp-status">
          <Text variant="caption" className={toneClass}>{status.text}</Text>
          {status.hint ? <Text variant="micro" className="text-text-muted">{status.hint}</Text> : null}
        </View>
      ) : null}
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
        {p.totalActualDeficit != null && (!p.window || p.window.active) ? (
          <View>
            <Text variant="micro" className="text-text-muted">Total deficit</Text>
            <Text variant="caption" className="tabular-nums">{Math.round(p.totalActualDeficit).toLocaleString()} kcal</Text>
            {p.window ? <Text variant="micro" className="text-text-muted">{p.window.label}</Text> : null}
          </View>
        ) : null}
        {/* Web shows the days-left count only while the target date is still ahead. */}
        {p.daysRemaining != null && !p.targetDatePassed ? (
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
        {p.weeklyRate != null && p.weeklyRate > 0 ? (
          <View>
            <Text variant="micro" className="text-text-muted">Goal rate</Text>
            <Text variant="caption" className="tabular-nums">{p.weeklyRate.toFixed(1)} kg/wk</Text>
          </View>
        ) : null}
        {p.avgActualDeficit != null && (!p.window || p.window.active) ? (
          <View>
            <Text variant="micro" className="text-text-muted">Avg deficit</Text>
            <Text variant="caption" className="tabular-nums">{Math.round(p.avgActualDeficit).toLocaleString()}/day</Text>
          </View>
        ) : null}
      </View>
      {p.window && !p.window.active ? (
        // No counted day inside the gap: there is no current deficit to total or average (#728).
        <Text variant="micro" className="text-text-muted" testID="bodycomp-window-inactive">
          {p.window.label}
          {p.window.start ? ` · last window ${shortLabel(p.window.start)} → ${shortLabel(p.window.end ?? p.window.start)}, ${p.window.countedDays} counted day${p.window.countedDays === 1 ? "" : "s"}` : ""}
        </Text>
      ) : null}
      {p.requiredDeficit != null && p.requiredDeficit > 0 ? (
        <Text variant="micro" className="text-text-muted">
          Need {Math.round(p.requiredDeficit).toLocaleString()} kcal/day{p.targetDate ? ` to hit ${shortLabel(p.targetDate)}` : ""}
          {p.avgActualDeficit != null && (!p.window || p.window.active) ? ` · averaging ${Math.round(p.avgActualDeficit).toLocaleString()}` : ""}
        </Text>
      ) : null}
    </Card>
  );
}

/** Full body-composition trajectory for the nutrition Trend tab: a status
 *  card + Weight, Body-Fat%, Cumulative-Deficit and Burn-vs-Eaten charts. */
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

  // Cumulative deficit on a daily axis extended by web's goal-pace line.
  const dAxis = dailyDeficits.map((d) => d.date);
  const counted = dailyDeficits.filter((d) => d.cumulative != null);
  const firstCounted = counted.length ? counted[0].date : null;
  const { axis: cAxis, pace: goalPace } = goalPaceSeries(dAxis, profile, goalDeficit, firstCounted);
  const cLabels = cAxis.map(shortLabel);
  const cumulative = alignBy(cAxis, dailyDeficits.filter((d) => d.cumulative != null), "cumulative");
  const countedDays = profile.window?.countedDays ?? counted.length;
  // Points estimated from the scale (soma#891) are drawn hollow over the line.
  const srcByDate = new Map(dailyDeficits.map((d) => [d.date, d.source]));
  const estimated = cAxis.map((d, i) => {
    const src = srcByDate.get(d);
    return cumulative[i] != null && (src === "extrapolated" || src === "partial") ? cumulative[i] : null;
  });
  const cumulativeChart: LineChartProps = {
    labels: cLabels,
    xTicks: 4,
    yFormat: (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${Math.round(v)}`),
    series: [
      { values: goalPace, color: C.pace, dashed: true, width: 1.5, label: "Goal pace" },
      { values: cumulative, color: C.deficit, width: 2.2, label: "Actual" },
      { values: estimated, color: C.deficit, mode: "dots", hollow: true, sizes: estimated.map(() => 3) },
    ],
  };

  // Burn vs eaten: web stacks the burn components (BMR + daily activity + run + gym) per day,
  // draws the eaten calories as dots, and a stepped goal line (burn − daily deficit goal).
  // Days outside the current window are faded, not summed.
  const dLabels = dAxis.map(shortLabel);
  const has = (k: "bmr" | "dailyActivity" | "runCal" | "gymCal") => dailyDeficits.some((d) => d[k] != null);
  const comp = (k: "bmr" | "dailyActivity" | "runCal" | "gymCal") => dailyDeficits.map((d) => (d[k] != null ? (d[k] as number) : d.totalBurn != null && k === "bmr" && !has("dailyActivity") ? d.totalBurn : null));
  const eaten = dailyDeficits.map((d) => (d.consumed != null ? d.consumed : null));
  const burnGoal = dailyDeficits.map((d) => (d.totalBurn != null ? Math.max(0, d.totalBurn - goalDeficit) : null));
  const opacities = dailyDeficits.map((d) => (d.inWindow === false ? 0.3 : 0.85));
  const faded = dailyDeficits.filter((d) => d.inWindow === false).length;
  const hasBurn = dailyDeficits.some((d) => d.totalBurn != null && d.consumed != null);
  const burnChart: LineChartProps = {
    labels: dLabels,
    xTicks: 4,
    yMin: 0,
    yFormat: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`),
    series: [
      { values: comp("bmr"), color: C.bmr, mode: "bars", stack: "burn", opacities, label: "BMR" },
      { values: comp("dailyActivity"), color: C.activity, mode: "bars", stack: "burn", opacities, label: "Daily activity" },
      { values: comp("runCal"), color: C.run, mode: "bars", stack: "burn", opacities, label: "Run" },
      { values: comp("gymCal"), color: C.gym, mode: "bars", stack: "burn", opacities, label: "Gym" },
      { values: burnGoal, color: C.goalLine, dashed: true, width: 1.4, label: "Goal" },
      { values: eaten, color: C.eaten, mode: "dots", width: 3, label: "Eaten" },
    ],
  };

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
          <ExpandableChart title="Cumulative deficit" chart={cumulativeChart}>
            <Text variant="micro" className="text-text-muted tabular-nums">goal {Math.round(goalDeficit)}/day</Text>
            {profile.window ? (
              <Text variant="micro" className="text-text-muted" testID="bodycomp-cumulative-window">
                {profile.window.active ? `Summed ${profile.window.label}` : `${profile.window.label} · line ends at the last window`}
              </Text>
            ) : null}
            {countedDays < 2 ? (
              <Text variant="micro" className="text-warm" testID="bodycomp-cumulative-sparse">
                {countedDays === 1 ? "Only one counted day in the last window — a single point, no line yet." : "No counted day yet — nothing to sum."}
              </Text>
            ) : null}
            <LineChart height={130} interactive {...cumulativeChart} />
          </ExpandableChart>
          <ChartLegend items={[
            { color: C.deficit, label: "Actual" },
            { color: C.pace, label: `Goal pace (−${Math.round(goalDeficit)}/day)`, dashed: true },
          ]} />
        </Card>
      ) : null}

      {hasBurn && dailyDeficits.length >= 2 ? (
        <Card className="gap-2">
          <ExpandableChart title="Burn vs eaten" chart={burnChart}>
            {profile.window ? (
              <Text variant="micro" className="text-text-muted">
                {profile.window.active ? `Counted ${profile.window.label}` : profile.window.label}
                {faded > 0 ? ` · ${faded} faded day${faded === 1 ? "" : "s"} outside the current window` : ""}
              </Text>
            ) : null}
            <LineChart height={150} interactive {...burnChart} />
          </ExpandableChart>
          <ChartLegend items={[
            { color: C.bmr, label: "BMR" },
            { color: C.activity, label: "Daily activity" },
            { color: C.run, label: "Run" },
            { color: C.gym, label: "Gym" },
            { color: C.eaten, label: "Eaten" },
            { color: C.goalLine, label: "Goal", dashed: true },
          ]} />
          <Text variant="micro" className="text-text-muted">The gap between the bar and the dot is the day&apos;s deficit; the goal line is burn minus the daily deficit goal.</Text>
        </Card>
      ) : null}
    </View>
  );
}
