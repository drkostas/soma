import { useState, useMemo } from "react";
import { View, Pressable } from "react-native";
import { Text, Card, SegmentedControl } from "soma-style";
import { LineChart, ChartLegend, chartDateLabel } from "./line-chart";
import type { ForwardSim, TrajectoryData } from "../lib/api";

type Dim = "Fitness" | "Readiness" | "Load";
const DIMS = ["Fitness", "Readiness", "Load"] as const;
const CFG: Record<Dim, { keyA: string; keyB: string; labelA: string; labelB: string; colorA: string; colorB: string; unit: string; fmt: (v: number) => string }> = {
  Fitness: { keyA: "ourVdot", keyB: "garminVo", labelA: "Model VDOT", labelB: "Garmin VO₂max", colorA: "#77c8d1", colorB: "#a9e4ec", unit: "", fmt: (v) => v.toFixed(1) },
  Readiness: { keyA: "ourScore", keyB: "garminScore", labelA: "Our readiness", labelB: "Garmin", colorA: "#6ad4a0", colorB: "#cbe896", unit: "", fmt: (v) => String(Math.round(v)) },
  Load: { keyA: "ctl", keyB: "atl", labelA: "Fitness (CTL)", labelB: "Fatigue (ATL)", colorA: "#77c8d1", colorB: "#e0a458", unit: "", fmt: (v) => String(Math.round(v)) },
};

function shortLabel(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][(m ?? 1) - 1]} ${d}`;
}

/** Fitness trajectory: our-model line vs Garmin's, across Fitness (VDOT),
 *  Readiness, and Load dimensions, with a "You are here" marker on the latest
 *  model value and a toggle to hide the Garmin comparison. Mobile-adapted from
 *  the web trajectory chart — goal-zone/taper/race bands need goal+taper data
 *  absent from the mobile payload, and the rich hover tooltip + 7-line
 *  visibility dropdown are replaced by the dimension + compare toggles. */
export function TrajectoryChart({ comparison, trajectory }: { comparison: ForwardSim["comparison"]; trajectory?: TrajectoryData | null }) {
  const [dim, setDim] = useState<Dim>("Fitness");
  const [compare, setCompare] = useState(true);
  const cfg = CFG[dim];

  // Optimal-vs-actual VDOT trajectory (banister projection to the race date).
  // Replaces the model-vs-Garmin Fitness view when the endpoint has a plan.
  const useTraj = dim === "Fitness" && (trajectory?.trajectory?.length ?? 0) >= 2;
  const traj = useMemo(() => {
    const t = trajectory?.trajectory ?? [];
    const optimal = t.map((p) => (isFinite(p.optimal) && p.optimal > 0 ? p.optimal : null));
    const actual = t.map((p) => (p.actual != null && isFinite(p.actual) && p.actual > 0 ? p.actual : null));
    let hereIdx = -1;
    for (let i = actual.length - 1; i >= 0; i--) if (actual[i] != null) { hereIdx = i; break; }
    return {
      labels: t.map((p) => chartDateLabel(p.date)),
      optimal, actual,
      hereDot: actual.map((v, i) => (i === hereIdx ? v : null)),
      cur: hereIdx >= 0 ? actual[hereIdx] : null,
    };
  }, [trajectory]);
  const src = useMemo(() => {
    if (!comparison) return [];
    return dim === "Fitness" ? comparison.fitness : dim === "Readiness" ? comparison.readiness : comparison.load;
  }, [comparison, dim]);

  const { labels, a, b, cur, hereDot } = useMemo(() => {
    const num = (p: Record<string, unknown>, k: string) => {
      const v = Number(p[k]);
      return isFinite(v) && v > 0 ? v : null;
    };
    const lbls = src.map((p) => shortLabel(String(p.date)));
    const av = src.map((p) => num(p as Record<string, unknown>, cfg.keyA));
    const bv = src.map((p) => num(p as Record<string, unknown>, cfg.keyB));
    // "You are here": a single dot on the most recent model value.
    let hereIdx = -1;
    for (let i = av.length - 1; i >= 0; i--) if (av[i] != null) { hereIdx = i; break; }
    const dot = av.map((v, i) => (i === hereIdx ? v : null));
    const last = hereIdx >= 0 ? av[hereIdx] : null;
    return { labels: lbls, a: av, b: bv, cur: last, hereDot: dot };
  }, [src, cfg]);

  if (!comparison) return null;

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Fitness trajectory</Text>
        {(useTraj ? traj.cur : cur) != null ? <Text variant="body" className="text-teal tabular-nums">{cfg.fmt((useTraj ? traj.cur : cur) as number)}{dim === "Fitness" ? " VDOT" : ""}</Text> : null}
      </View>
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <SegmentedControl options={DIMS} value={dim} onChange={(v) => setDim(v as Dim)} />
        </View>
        {!useTraj ? (
          <Pressable onPress={() => setCompare((c) => !c)} hitSlop={6}>
            <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: compare ? cfg.colorB + "33" : "#142530" }}>
              <Text variant="micro" style={{ color: compare ? cfg.colorB : "#8aa0ac" }}>Garmin</Text>
            </View>
          </Pressable>
        ) : null}
      </View>
      {useTraj ? (
        <>
          <LineChart
            height={175}
            interactive
            xTicks={4}
            labels={traj.labels}
            yFormat={(v) => v.toFixed(1)}
            refLine={trajectory?.goalVdot != null ? { y: trajectory.goalVdot, color: "#e0c458" } : undefined}
            series={[
              { values: traj.optimal, color: "#77c8d1", width: 1.6, dashed: true, label: "Optimal" },
              { values: traj.actual, color: "#6ad4a0", width: 2.4, label: "Actual" },
              { values: traj.hereDot, color: "#ffffff", mode: "dots" as const, width: 3 },
            ]}
          />
          <ChartLegend items={[
            { color: "#6ad4a0", label: "Actual VDOT" },
            { color: "#77c8d1", label: "Optimal (to race)", dashed: true },
            ...(trajectory?.goalVdot != null ? [{ color: "#e0c458", label: `Goal ${trajectory.goalVdot.toFixed(1)}`, dashed: true }] : []),
          ]} />
        </>
      ) : a.some((v) => v != null) || b.some((v) => v != null) ? (
        <>
          <LineChart
            height={170}
            labels={labels}
            yFormat={(v) => cfg.fmt(v)}
            series={[
              ...(compare ? [{ values: b, color: cfg.colorB, width: 1.6, dashed: dim !== "Load" }] : []),
              { values: a, color: cfg.colorA, width: 2.4 },
              { values: hereDot, color: "#ffffff", mode: "dots" as const, width: 3 },
            ]}
          />
          <ChartLegend items={[
            { color: cfg.colorA, label: cfg.labelA },
            ...(compare ? [{ color: cfg.colorB, label: cfg.labelB, dashed: dim !== "Load" }] : []),
            { color: "#ffffff", label: "You are here" },
          ]} />
        </>
      ) : (
        <Text variant="caption" className="text-text-muted">Not enough {dim.toLowerCase()} history yet.</Text>
      )}
    </Card>
  );
}
