import { View } from "react-native";
import { Text, Card } from "soma-style";
import type { GraphNode } from "../lib/api";
import { paceStr } from "../lib/vdot";

/**
 * Mobile-native replacement for the web's draggable computation-graph DAG.
 * Shows the same signals → factors → adjusted-pace flow as a compact breakdown:
 * raw signals, then the multiplicative factors that bend today's pace.
 */
export function PaceComputation({ nodes }: { nodes: Record<string, GraphNode> }) {
  const val = (id: string): number | null => {
    const v = nodes[id]?.value;
    return v == null || !isFinite(Number(v)) ? null : Number(v);
  };

  const adjusted = val("adjusted_pace"); // seconds/km
  const vdot = val("vdot");

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

      {/* raw readiness signals feeding the factors */}
      {signals.length ? (
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

      <Text variant="micro" className="text-text-muted">
        Base VDOT pace bent by readiness, fatigue and weight to today&apos;s target.
      </Text>
    </Card>
  );
}
