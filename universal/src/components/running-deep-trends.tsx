import { View } from "react-native";
import Svg, { Polyline, Line } from "react-native-svg";
import { Text, Card, Badge, Sparkline } from "soma-style";
import type { RunningTrends } from "../lib/api";

/** Two lines on a shared y-scale (acute vs chronic load). */
function DualLine({ a, b, colorA, colorB, height = 44 }: { a: number[]; b: number[]; colorA: string; colorB: string; height?: number }) {
  const A = a.filter((v) => isFinite(v));
  const B = b.filter((v) => isFinite(v));
  const all = [...A, ...B];
  if (all.length < 2) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const W = 100;
  const line = (s: number[]) => s.map((v, i) => `${(i / Math.max(1, s.length - 1)) * W},${height - ((v - min) / range) * height}`).join(" ");
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
      {B.length >= 2 ? <Polyline points={line(B)} fill="none" stroke={colorB} strokeWidth={1} opacity={0.6} /> : null}
      {A.length >= 2 ? <Polyline points={line(A)} fill="none" stroke={colorA} strokeWidth={1.6} /> : null}
    </Svg>
  );
}

const acwrTone = (v: number): "success" | "warm" | "danger" => (v >= 0.8 && v <= 1.3 ? "success" : v > 1.5 ? "danger" : "warm");
const acwrLabel = (v: number): string => (v >= 0.8 && v <= 1.3 ? "OPTIMAL" : v > 1.5 ? "HIGH" : v > 1.3 ? "ELEVATED" : "LOW");

/** Training load / ACWR + cadence trends for the running screen. */
export function RunningDeepTrends({ trends }: { trends: RunningTrends | null | undefined }) {
  if (!trends) return null;
  const load = trends.loadTrend.filter((p) => p.acute != null || p.chronic != null);
  const loadLast = load.length ? load[load.length - 1] : null;
  const acute = load.map((p) => Number(p.acute)).filter(isFinite);
  const chronic = load.map((p) => Number(p.chronic)).filter(isFinite);

  const cad = trends.cadenceStride.filter((p) => p.cadence != null);
  const cadLast = cad.length ? cad[cad.length - 1] : null;
  const cadSeries = cad.map((p) => Number(p.cadence)).filter(isFinite);

  return (
    <View className="gap-4">
      {loadLast ? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Training load · acute vs chronic</Text>
            {loadLast.acwr != null ? <Badge label={`ACWR ${loadLast.acwr.toFixed(2)} · ${acwrLabel(loadLast.acwr)}`} tone={acwrTone(loadLast.acwr)} /> : null}
          </View>
          <DualLine a={acute} b={chronic} colorA="#77c8d1" colorB="#5a7a8a" />
          <View className="flex-row justify-between">
            <Text variant="micro" className="text-text-muted">acute {loadLast.acute != null ? Math.round(loadLast.acute) : "—"}</Text>
            <Text variant="micro" className="text-text-muted">chronic {loadLast.chronic != null ? Math.round(loadLast.chronic) : "—"}</Text>
          </View>
          <View className="flex-row items-center gap-3">
            <View className="flex-row items-center gap-1"><View className="h-2 w-2 rounded-full bg-teal" /><Text variant="micro" className="text-text-muted">acute (7d)</Text></View>
            <View className="flex-row items-center gap-1"><View className="h-2 w-2 rounded-full" style={{ backgroundColor: "#5a7a8a" }} /><Text variant="micro" className="text-text-muted">chronic (28d)</Text></View>
          </View>
        </Card>
      ) : null}

      {cadLast && cadSeries.length >= 2 ? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Cadence</Text>
            <Text variant="micro" className="tabular-nums text-text-muted">{cadLast.stride != null ? `stride ${cadLast.stride} cm` : ""}</Text>
          </View>
          <View className="flex-row items-end gap-2">
            <Text variant="display" className="text-lime">{cadLast.cadence}</Text>
            <Text variant="caption" className="text-text-muted mb-1">spm</Text>
          </View>
          <Sparkline data={cadSeries} color="#cbe896" height={36} baseline />
        </Card>
      ) : null}
    </View>
  );
}
