import { useState, useMemo } from "react";
import { View, Pressable } from "react-native";
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
 *  Readiness, and Load dimensions, with a "You are here" marker on the latest
 *  model value and a toggle to hide the Garmin comparison. Mobile-adapted from
 *  the web trajectory chart — goal-zone/taper/race bands need goal+taper data
 *  absent from the mobile payload, and the rich hover tooltip + 7-line
 *  visibility dropdown are replaced by the dimension + compare toggles. */
export function TrajectoryChart({ comparison }: { comparison: ForwardSim["comparison"] }) {
  const [dim, setDim] = useState<Dim>("Fitness");
  const [compare, setCompare] = useState(true);
  const cfg = CFG[dim];
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
        {cur != null ? <Text variant="body" className="text-teal tabular-nums">{cfg.fmt(cur)}{dim === "Fitness" ? " VDOT" : ""}</Text> : null}
      </View>
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <SegmentedControl options={DIMS} value={dim} onChange={(v) => setDim(v as Dim)} />
        </View>
        <Pressable onPress={() => setCompare((c) => !c)} hitSlop={6}>
          <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: compare ? cfg.colorB + "33" : "#142530" }}>
            <Text variant="micro" style={{ color: compare ? cfg.colorB : "#8aa0ac" }}>Garmin</Text>
          </View>
        </Pressable>
      </View>
      {a.some((v) => v != null) || b.some((v) => v != null) ? (
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
