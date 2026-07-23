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
      title: "Readiness — ours vs Garmin",
      a: rd.map((p) => n(p.ourScore) * 100),
      b: rd.map((p) => n(p.garminScore)),
      colorB: "#5a7a8a",
      latest: rdL ? `Ours ${Math.round(n(rdL.ourScore) * 100)} · Garmin ${Math.round(n(rdL.garminScore))}` : "",
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
