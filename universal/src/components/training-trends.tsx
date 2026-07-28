import { View } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { Text, Card } from "soma-style";
import type { ComparisonPoint } from "../lib/api";
import { pacesForVdot, timeStr } from "../lib/vdot";

/** Two lines on a SHARED y-scale (so the comparison is honest), scaled to width. */
function DualLine({
  a,
  b,
  colorA,
  colorB,
  height = 40,
}: {
  a: number[];
  b: number[];
  colorA: string;
  colorB: string;
  height?: number;
}) {
  const A = a.filter((v) => isFinite(v));
  const B = b.filter((v) => isFinite(v));
  const all = [...A, ...B];
  if (all.length < 2) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const W = 100;
  const line = (s: number[]) =>
    s.map((v, i) => `${(i / Math.max(1, s.length - 1)) * W},${height - ((v - min) / range) * height}`).join(" ");
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
      {B.length >= 2 ? <Polyline points={line(B)} fill="none" stroke={colorB} strokeWidth={1} opacity={0.55} /> : null}
      {A.length >= 2 ? <Polyline points={line(A)} fill="none" stroke={colorA} strokeWidth={1.6} /> : null}
    </Svg>
  );
}

interface Comparison {
  fitness: ComparisonPoint[];
  load: ComparisonPoint[];
  readiness: ComparisonPoint[];
  racePrediction: ComparisonPoint[];
}

const n = (v: unknown): number => Number(v);
const last = (a: ComparisonPoint[]): ComparisonPoint | undefined => (a.length ? a[a.length - 1] : undefined);

// Our readiness ourScore is a SIGNED z-composite (roughly -3.5..+2), not a 0-100
// score — multiplying it by 100 produced nonsense like "-123". Map the z to its
// normal-distribution percentile (0-100) so it's on the same honest scale as
// Garmin's 0-100 readiness. z=0 -> 50, z=+2 -> ~98, z=-2 -> ~2.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}
const zToPercentile = (z: number): number => 50 * (1 + erf(z / Math.SQRT2));

/** Compact "model vs Garmin" trend cards (mobile-adapted comparison charts). */
export function TrainingTrends({ comparison }: { comparison: Comparison | null | undefined }) {
  if (!comparison) return null;

  const fit = comparison.fitness ?? [];
  const load = comparison.load ?? [];
  const rd = comparison.readiness ?? [];
  const rp = comparison.racePrediction ?? [];
  const fitL = last(fit);
  const loadL = last(load);
  const rdL = last(rd);
  const rpL = last(rp);

  const cards = [
    {
      key: "fitness",
      title: "Fitness — VDOT vs Garmin VO₂max",
      a: fit.map((p) => n(p.ourVdot)),
      b: fit.map((p) => n(p.garminVo2max)),
      colorB: "#5a7a8a",
      latest: fitL ? `Ours ${n(fitL.ourVdot).toFixed(1)} · Garmin ${n(fitL.garminVo2max).toFixed(1)}` : "",
    },
    {
      key: "load",
      title: "Training load — CTL vs ATL",
      a: load.map((p) => n(p.ctl)),
      b: load.map((p) => n(p.atl)),
      colorB: "#e0a458",
      latest: loadL ? `CTL ${n(loadL.ctl).toFixed(0)} · ATL ${n(loadL.atl).toFixed(0)}` : "",
    },
    {
      key: "readiness",
      title: "Readiness — percentile vs Garmin",
      a: rd.map((p) => zToPercentile(n(p.ourScore))),
      b: rd.map((p) => n(p.garminScore)),
      colorB: "#5a7a8a",
      latest: rdL ? `Ours ${Math.round(zToPercentile(n(rdL.ourScore)))} · Garmin ${Math.round(n(rdL.garminScore))}` : "",
    },
    {
      key: "race",
      title: "Race prediction — HM time",
      a: rp.map((p) => pacesForVdot(n(p.ourVdot)).hmSeconds),
      b: rp.map((p) => n(p.garminSeconds)),
      colorB: "#5a7a8a",
      latest: rpL ? `Ours ${timeStr(pacesForVdot(n(rpL.ourVdot)).hmSeconds)} · Garmin ${timeStr(n(rpL.garminSeconds))}` : "",
    },
  ];

  return (
    <View className="gap-3">
      <Text variant="eyebrow" className="text-text-muted">Model vs Garmin</Text>
      {cards.map((c) => (
        <Card key={c.key} className="gap-1.5">
          <Text variant="micro" className="text-text-secondary">{c.title}</Text>
          <DualLine a={c.a} b={c.b} colorA="#77c8d1" colorB={c.colorB} />
          <Text variant="micro" className="tabular-nums text-text-muted">{c.latest}</Text>
        </Card>
      ))}
    </View>
  );
}
