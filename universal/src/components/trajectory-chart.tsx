import { useState, useMemo } from "react";
import { View } from "react-native";
import { Text, Card, SegmentedControl } from "soma-style";
import { LineChart, ChartLegend } from "./line-chart";
import type { ForwardSim } from "../lib/api";

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
 *  Readiness, and Load dimensions. Mobile-adapted from the web trajectory
 *  chart — the goal-zone bands, taper band, and what-if line stay web-only
 *  for now (the what-if belongs with #422). */
export function TrajectoryChart({ comparison }: { comparison: ForwardSim["comparison"] }) {
  const [dim, setDim] = useState<Dim>("Fitness");
  const cfg = CFG[dim];
  const src = useMemo(() => {
    if (!comparison) return [];
    return dim === "Fitness" ? comparison.fitness : dim === "Readiness" ? comparison.readiness : comparison.load;
  }, [comparison, dim]);

  const { labels, a, b, cur } = useMemo(() => {
    const num = (p: Record<string, unknown>, k: string) => {
      const v = Number(p[k]);
      return isFinite(v) && v > 0 ? v : null;
    };
    const lbls = src.map((p) => shortLabel(String(p.date)));
    const av = src.map((p) => num(p as Record<string, unknown>, cfg.keyA));
    const bv = src.map((p) => num(p as Record<string, unknown>, cfg.keyB));
    const last = [...av].reverse().find((v) => v != null) ?? null;
    return { labels: lbls, a: av, b: bv, cur: last };
  }, [src, cfg]);

  if (!comparison) return null;

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Fitness trajectory</Text>
        {cur != null ? <Text variant="body" className="text-teal tabular-nums">{cfg.fmt(cur)}{dim === "Fitness" ? " VDOT" : ""}</Text> : null}
      </View>
      <SegmentedControl options={DIMS} value={dim} onChange={(v) => setDim(v as Dim)} />
      {a.some((v) => v != null) || b.some((v) => v != null) ? (
        <>
          <LineChart
            height={170}
            labels={labels}
            yFormat={(v) => cfg.fmt(v)}
            series={[
              { values: b, color: cfg.colorB, width: 1.6, dashed: dim !== "Load" },
              { values: a, color: cfg.colorA, width: 2.4 },
            ]}
          />
          <ChartLegend items={[
            { color: cfg.colorA, label: cfg.labelA },
            { color: cfg.colorB, label: cfg.labelB, dashed: dim !== "Load" },
          ]} />
        </>
      ) : (
        <Text variant="caption" className="text-text-muted">Not enough {dim.toLowerCase()} history yet.</Text>
      )}
    </Card>
  );
}
