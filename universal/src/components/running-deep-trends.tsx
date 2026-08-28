import { View } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { Text, Card, Badge } from "soma-style";
import type { RunningTrends } from "../lib/api";
import { LineChart, ChartLegend } from "./line-chart";

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

  // Per-point ACWR (acute / chronic) for the guide-banded ratio line.
  const acwrSeries = load.map((p) =>
    p.acute != null && p.chronic != null && Number(p.chronic) > 0 ? Number(p.acute) / Number(p.chronic) : null,
  );
  const hasAcwr = acwrSeries.filter((v): v is number => v != null).length >= 2;

  const cad = trends.cadenceStride.filter((p) => p.cadence != null);
  const cadLast = cad.length ? cad[cad.length - 1] : null;
  const cadSeries = cad.map((p) => Number(p.cadence)).filter(isFinite);

  return (
    <View className="gap-4">
      {loadLast ? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Training load · acute vs chronic</Text>
            {(() => {
              // Derive ACWR from the plotted acute/chronic so the badge and the
              // chart agree (the raw acwr DB field is computed separately and drifts).
              const ratio =
                loadLast.acute != null && loadLast.chronic != null && loadLast.chronic > 0
                  ? loadLast.acute / loadLast.chronic
                  : loadLast.acwr;
              return ratio != null ? (
                <Badge label={`ACWR ${ratio.toFixed(2)} · ${acwrLabel(ratio)}`} tone={acwrTone(ratio)} />
              ) : null;
            })()}
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

          {hasAcwr ? (
            <View className="gap-1 border-t border-border-subtle pt-2">
              <Text variant="micro" className="text-text-muted">ACWR ratio · sweet spot 0.8–1.3</Text>
              <LineChart
                height={110}
                yFormat={(v) => v.toFixed(2)}
                series={[{ values: acwrSeries, color: "#77c8d1", width: 2 }]}
                refLines={[
                  { y: 0.8, color: "#6ad4a0" },
                  { y: 1.3, color: "#e0c458" },
                  { y: 1.5, color: "#e06060" },
                ]}
              />
              <ChartLegend items={[{ color: "#6ad4a0", label: "0.8", dashed: true }, { color: "#e0c458", label: "1.3", dashed: true }, { color: "#e06060", label: "1.5 high", dashed: true }]} />
            </View>
          ) : null}
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
          <LineChart
            height={110}
            yFormat={(v) => String(Math.round(v))}
            series={[{ values: cadSeries, color: "#cbe896", width: 2.2 }]}
            refLine={{ y: 180, color: "#77c8d1" }}
          />
          <Text variant="micro" className="text-text-muted">Dashed line = 180 spm target.</Text>
        </Card>
      ) : null}
    </View>
  );
}
