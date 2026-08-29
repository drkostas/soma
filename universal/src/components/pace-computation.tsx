import { View } from "react-native";
import Svg, { Polyline, Circle } from "react-native-svg";
import { Text, Card } from "soma-style";
import type { GraphNode, GraphEdge } from "../lib/api";
import { paceStr } from "../lib/vdot";

const READINESS_INPUTS = [
  { id: "hrv_z", label: "HRV" },
  { id: "sleep_z", label: "Sleep" },
  { id: "rhr_z", label: "RHR" },
  { id: "bb_z", label: "Body Batt" },
];

/** A transfer-function curve (input → pace factor) with a "you are here" dot.
 *  Static curve points ported from the web graph-tooltip response curves. */
function ResponseCurve({ points, cx, cy, color, label }: {
  points: { x: number; y: number }[]; cx: number; cy: number; color: string; label: string;
}) {
  const xs = points.map((p) => p.x).concat(cx);
  const ys = points.map((p) => p.y).concat(cy);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const W = 100, H = 44, pad = 5;
  const sx = (x: number) => pad + ((x - xMin) / ((xMax - xMin) || 1)) * (W - 2 * pad);
  const sy = (y: number) => pad + (1 - (y - yMin) / ((yMax - yMin) || 1)) * (H - 2 * pad);
  return (
    <View className="gap-0.5">
      <View className="flex-row items-center justify-between">
        <Text variant="micro" className="text-text-secondary">{label}</Text>
        <Text variant="micro" className="tabular-nums text-text-muted">now ×{cy.toFixed(2)}</Text>
      </View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Polyline points={points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")} fill="none" stroke={color} strokeWidth={1.4} />
        <Circle cx={sx(cx)} cy={sy(cy)} r={2.6} fill="#ffffff" stroke={color} strokeWidth={1.2} />
      </Svg>
    </View>
  );
}

/**
 * Mobile-native replacement for the web's draggable computation-graph DAG.
 * Shows the same signals → factors → adjusted-pace flow as a compact breakdown:
 * the multiplicative factors that bend today's pace, then the calibrated
 * readiness drivers (each signal's z-value + its weight into the readiness
 * factor — the graph edges).
 */
export function PaceComputation({ nodes, edges = [] }: { nodes: Record<string, GraphNode>; edges?: GraphEdge[] }) {
  const val = (id: string): number | null => {
    const v = nodes[id]?.value;
    return v == null || !isFinite(Number(v)) ? null : Number(v);
  };

  const adjusted = val("adjusted_pace"); // seconds/km
  const vdot = val("vdot");

  // Readiness drivers: each z-signal's calibrated weight (edge → readiness_factor).
  const drivers = READINESS_INPUTS
    .map((s) => {
      const e = edges.find((ed) => ed.from === s.id && ed.to === "readiness_factor");
      return { ...s, weight: e != null ? Math.abs(e.weight) : null, z: val(s.id) };
    })
    .filter((d) => d.weight != null);
  const totalW = drivers.reduce((sum, d) => sum + (d.weight ?? 0), 0) || 1;

  const factors = [
    { label: "Readiness", v: val("readiness_factor"), color: "#6ad4a0" },
    { label: "Fatigue", v: val("fatigue_factor"), color: "#e0a458" },
    { label: "Weight", v: val("weight_factor"), color: "#b17850" },
    { label: "Intensity", v: val("slider_factor"), color: "#6366b0" },
  ].filter((f) => f.v != null);

  const signals = [
    { label: "HRV", v: val("hrv_z"), z: true },
    { label: "Sleep", v: val("sleep_z"), z: true },
    { label: "RHR", v: val("rhr_z"), z: true },
    { label: "Body Batt", v: val("bb_z"), z: true },
    { label: "TSB", v: val("tsb"), z: false },
  ].filter((s) => s.v != null);

  if (adjusted == null && !factors.length) return null;

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Pace computation</Text>
        {vdot != null ? <Text variant="micro" className="tabular-nums text-text-muted">VDOT {vdot.toFixed(1)}</Text> : null}
      </View>

      {/* adjusted (output) pace */}
      {adjusted != null ? (
        <View className="flex-row items-end gap-2">
          <Text variant="display" className="text-teal">{paceStr(adjusted)}</Text>
          <Text variant="caption" className="text-text-muted mb-1">/km adjusted</Text>
        </View>
      ) : null}

      {/* multiplicative factors that bend the base pace */}
      <View className="gap-2">
        {factors.map((f) => {
          const pct = Math.round(((f.v as number) - 1) * 100); // deviation from neutral
          return (
            <View key={f.label} className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <View className="h-2 w-2 rounded-full" style={{ backgroundColor: f.color }} />
                <Text variant="body" className="text-text-secondary">{f.label}</Text>
              </View>
              <Text variant="body" className="tabular-nums text-text">
                ×{(f.v as number).toFixed(2)}
                <Text variant="micro" className="text-text-muted">{pct === 0 ? " (neutral)" : ` (${pct > 0 ? "+" : ""}${pct}%)`}</Text>
              </Text>
            </View>
          );
        })}
      </View>

      {/* Readiness drivers: each signal's calibrated weight into the readiness factor */}
      {drivers.length ? (
        <View className="gap-1.5 border-t border-border-subtle pt-2.5">
          <Text variant="micro" className="text-text-muted">READINESS DRIVERS · calibrated weights</Text>
          {drivers.map((d) => {
            const wPct = Math.round(((d.weight as number) / totalW) * 100);
            return (
              <View key={d.id} className="gap-0.5">
                <View className="flex-row items-center justify-between">
                  <Text variant="micro" className="text-text-secondary">
                    {d.label}{d.z != null ? ` · ${(d.z as number) >= 0 ? "+" : ""}${(d.z as number).toFixed(2)} z` : ""}
                  </Text>
                  <Text variant="micro" className="tabular-nums text-text-muted">{wPct}%</Text>
                </View>
                <View className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: "#16242c" }}>
                  <View className="h-full rounded-full" style={{ width: `${wPct}%`, backgroundColor: "#6aa0e0" }} />
                </View>
              </View>
            );
          })}
        </View>
      ) : signals.length ? (
        <View className="flex-row flex-wrap gap-2 border-t border-border-subtle pt-2.5">
          {signals.map((s) => (
            <View key={s.label} className="rounded-full bg-surface-subtle px-2.5 py-1">
              <Text variant="micro" className="tabular-nums text-text-secondary">
                {s.label} {(s.v as number) >= 0 ? "+" : ""}{(s.v as number).toFixed(s.z ? 2 : 0)}{s.z ? " z" : ""}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Response curves: how each input bends the pace factor, with a "you are here" dot */}
      {(() => {
        // The graph returns 0 for missing z-signals; a real z-score is virtually
        // never exactly 0, so treat 0 as "no data" (matches the backend's factor).
        const zs = READINESS_INPUTS.map((s) => val(s.id)).filter((v): v is number => v != null && Math.abs(v) > 1e-6);
        const compositeZ = zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : null;
        const rf = val("readiness_factor"), ff = val("fatigue_factor"), wf = val("weight_factor");
        const tsb = val("tsb"), wema = val("weight_ema");
        const CW = 80.5;
        const curves: { key: string; label: string; color: string; cx: number; cy: number; points: { x: number; y: number }[] }[] = [];
        if (compositeZ != null && rf != null)
          curves.push({ key: "r", label: "Readiness · composite z", color: "#6ad4a0", cx: compositeZ, cy: rf, points: [{ x: -2, y: 1.05 }, { x: -1, y: 1.05 }, { x: 0, y: 1.0 }, { x: 1, y: 0.97 }] });
        if (tsb != null && ff != null)
          curves.push({ key: "f", label: "Fatigue · TSB", color: "#e0a458", cx: tsb, cy: ff, points: [{ x: -20, y: 1.03 }, { x: -10, y: 1.015 }, { x: 0, y: 1.0 }, { x: 5, y: 0.99 }, { x: 10, y: 0.98 }] });
        if (wema != null && wf != null)
          curves.push({ key: "w", label: "Weight · kg from calibration", color: "#b17850", cx: wema - CW, cy: wf, points: [-8, -4, 0, 4].map((d) => ({ x: d, y: (CW + d) / CW })) });
        if (!curves.length) return null;
        return (
          <View className="gap-2 border-t border-border-subtle pt-2.5">
            <Text variant="micro" className="text-text-muted">RESPONSE CURVES · input → pace factor</Text>
            {curves.map(({ key, ...c }) => <ResponseCurve key={key} {...c} />)}
          </View>
        );
      })()}

      <Text variant="micro" className="text-text-muted">
        Base VDOT pace bent by readiness, fatigue and weight to today&apos;s target.
      </Text>
    </Card>
  );
}
