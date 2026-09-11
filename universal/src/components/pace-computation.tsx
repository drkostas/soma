import { useState } from "react";
import { View, Pressable } from "react-native";
import Svg, { Polyline, Circle } from "react-native-svg";
import { Text, Card, Modal } from "soma-style";
import type { GraphNode, GraphEdge } from "../lib/api";
import { paceStr } from "banister";

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
const COLUMNS: { key: string; label: string }[] = [
  { key: "raw", label: "Signals" }, { key: "zscore", label: "Streams" }, { key: "pmc", label: "Fatigue" },
  { key: "merge", label: "Factors" }, { key: "output", label: "Output" },
];
function fmtNodeValue(n: GraphNode): string {
  if (n.value == null || !isFinite(Number(n.value))) return "no data";
  const v = Number(n.value);
  if (n.id === "adjusted_pace" || n.unit === "s/km") return `${paceStr(v)}/km`;
  if (n.unit === "×") return `×${v.toFixed(3)}`;
  const s = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  return n.unit && n.unit !== "×" ? `${s} ${n.unit}` : s;
}

export function PaceComputation({ nodes, edges = [], sliderFactor = 1 }: { nodes: Record<string, GraphNode>; edges?: GraphEdge[]; sliderFactor?: number }) {
  // Web's DAG shows a tooltip per node on hover/tap (value, formula, source, inputs) (soma#794).
  const [detail, setDetail] = useState<GraphNode | null>(null);
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

  // Web's shadow graph while the What-if slider moves: adjusted = base × (1 + (rf·ff·wf − 1) × slider).
  const rf = val("readiness_factor") ?? 1, ff = val("fatigue_factor") ?? 1, wf = val("weight_factor") ?? 1, sf = val("slider_factor") ?? 1;
  const basePace = adjusted != null && rf * ff * wf * sf !== 0 ? adjusted / (1 + (rf * ff * wf - 1) * sf) : null;
  const shadow = basePace != null && Math.abs(sliderFactor - 1) > 1e-6 ? basePace * (1 + (rf * ff * wf - 1) * sliderFactor) : null;
  const byColumn = COLUMNS.map((c) => ({ ...c, items: Object.values(nodes).filter((n) => n.column === c.key) })).filter((c) => c.items.length);
  const inputsOf = (n: GraphNode) => edges.filter((e) => e.to === n.id).map((e) => ({ node: nodes[e.from], weight: e.weight })).filter((x) => x.node);

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
      {shadow != null ? (
        <Text variant="caption" className="tabular-nums text-warm" testID="dag-shadow">
          What-if ×{sliderFactor.toFixed(2)} → {paceStr(shadow)}/km ({shadow > (adjusted ?? 0) ? "+" : ""}{Math.round(shadow - (adjusted ?? 0))} s/km)
        </Text>
      ) : null}

      {/* Web's Model Computation DAG as tappable nodes by column (soma#794) */}
      {byColumn.length ? (
        <View className="gap-2 border-t border-border-subtle pt-2.5">
          <Text variant="micro" className="text-text-muted">MODEL COMPUTATION · tap a node</Text>
          {byColumn.map((c) => (
            <View key={c.key} className="gap-1">
              <Text variant="micro" className="text-text-muted">{c.label.toUpperCase()}</Text>
              <View className="flex-row flex-wrap gap-1.5">
                {c.items.map((n) => (
                  <Pressable key={n.id} onPress={() => setDetail(n)} className="rounded-md border border-border-subtle px-2 py-1" testID={`dag-node-${n.id}`} accessibilityRole="button" accessibilityLabel={`${n.label} ${fmtNodeValue(n)}`}>
                    <Text variant="micro" className="text-text-secondary">{n.label}</Text>
                    <Text variant="caption" className="tabular-nums" style={{ color: n.value == null ? "#5a7a8a" : (n.color && n.color.startsWith("#") ? n.color : "#e6f1f5") }}>{fmtNodeValue(n)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : null}
      <Modal visible={!!detail} onClose={() => setDetail(null)} title={detail?.label ?? ""}>
        {detail ? (
          <View className="gap-2" testID="dag-node-detail">
            <Text variant="headline" className="tabular-nums text-teal">{fmtNodeValue(detail)}</Text>
            {detail.tooltip?.short ? <Text variant="caption" className="text-text-secondary">{detail.tooltip.short}</Text> : null}
            {detail.tooltip?.formula ? (
              <View className="rounded-md bg-surface-subtle px-2.5 py-1.5">
                <Text variant="micro" className="text-text-muted">formula</Text>
                <Text variant="micro" className="tabular-nums text-text">{detail.tooltip.formula}</Text>
              </View>
            ) : null}
            {detail.tooltip?.source ? <Text variant="micro" className="text-text-muted">source · {detail.tooltip.source}</Text> : null}
            {inputsOf(detail).length ? (
              <View className="gap-0.5">
                <Text variant="micro" className="text-text-muted">inputs</Text>
                {inputsOf(detail).map(({ node, weight }) => (
                  <View key={node.id} className="flex-row items-center justify-between">
                    <Text variant="micro" className="text-text-secondary">{node.label}</Text>
                    <Text variant="micro" className="tabular-nums text-text-muted">{fmtNodeValue(node)}{Math.abs(weight) !== 1 ? ` · w ${weight.toFixed(2)}` : ""}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </Modal>

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
