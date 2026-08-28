import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Text, Modal, Badge } from "soma-style";
import type { ActivityMatch, PlanDay } from "../lib/api";

const num = (v: number | string | null | undefined): number => (v == null || !isFinite(Number(v)) ? 0 : Number(v));
function paceLabel(secKm: number | null): string {
  if (secKm == null || !isFinite(secKm) || secKm <= 0) return "—";
  const t = Math.round(secKm);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}/km`;
}

/** Circular completion-score ring (0-100). */
function ScoreRing({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(1, score / 100));
  const R = 34, C = 2 * Math.PI * R;
  const color = score >= 85 ? "#6ad4a0" : score >= 65 ? "#e0c458" : "#e0a458";
  return (
    <View style={{ width: 84, height: 84 }} className="items-center justify-center">
      <Svg width={84} height={84} style={{ position: "absolute" }}>
        <Circle cx={42} cy={42} r={R} stroke="#1e2f38" strokeWidth={7} fill="none" />
        <Circle cx={42} cy={42} r={R} stroke={color} strokeWidth={7} fill="none"
          strokeDasharray={`${C}`} strokeDashoffset={C * (1 - pct)} strokeLinecap="round"
          transform="rotate(-90 42 42)" />
      </Svg>
      <Text variant="title" style={{ color }}>{Math.round(score)}</Text>
    </View>
  );
}

function Bar({ label, plan, actual, unit, invert }: { label: string; plan: number; actual: number; unit: string; invert?: boolean }) {
  const ratio = plan > 0 ? actual / plan : 0;
  // compliance: 1.0 = on target; color by closeness
  const off = Math.abs(1 - ratio);
  const color = off <= 0.05 ? "#6ad4a0" : off <= 0.15 ? "#e0c458" : "#e0a458";
  return (
    <View className="gap-1">
      <View className="flex-row justify-between">
        <Text variant="micro" className="text-text-secondary">{label}</Text>
        <Text variant="micro" className="tabular-nums text-text-muted">
          {actual.toFixed(unit === "km" ? 1 : 0)}{unit} / {plan.toFixed(unit === "km" ? 1 : 0)}{unit} plan
        </Text>
      </View>
      <View className="h-2 rounded-full bg-surface-subtle overflow-hidden">
        <View className="h-full rounded-full" style={{ width: `${Math.max(4, Math.min(1, ratio) * 100)}%`, backgroundColor: color }} />
      </View>
    </View>
  );
}

/**
 * Matched-activity compliance panel (web parity, #424): the completion-score
 * ring + plan-vs-actual compliance (distance / pace / HR) for a plan day that
 * matched a Garmin activity. Fed by /api/training/activity-match.
 */
export function MatchedActivityPanel({ match, day, onClose }: { match: ActivityMatch | null; day: PlanDay | null; onClose: () => void }) {
  if (!match || !match.activity) return null;
  const a = match.activity;
  const planKm = num(day?.targetDistanceKm);
  const actKm = num(a.distance_km);
  const rows: [string, string][] = [
    ["Distance", `${actKm.toFixed(2)} km`],
    ["Duration", a.duration_min != null ? `${Math.round(num(a.duration_min))} min` : "—"],
    ["Avg pace", paceLabel(a.avg_pace_sec_km)],
    ["Avg HR", a.avg_hr != null ? `${Math.round(num(a.avg_hr))} bpm` : "—"],
    ["Max HR", a.max_hr != null ? `${Math.round(num(a.max_hr))} bpm` : "—"],
    ["Calories", a.calories != null ? `${Math.round(num(a.calories))} kcal` : "—"],
  ];

  return (
    <Modal visible={!!match} onClose={onClose} title={day?.runTitle || "Matched activity"}>
      <View className="gap-3">
        <View className="flex-row items-center gap-4">
          <ScoreRing score={num(match.completionScore)} />
          <View className="flex-1 gap-1">
            <Text variant="eyebrow" className="text-text-muted">Completion score</Text>
            {a.garmin_id != null ? <Badge label="Garmin matched" tone="success" /> : null}
            <Text variant="micro" className="text-text-muted">{day?.dayDate ?? ""}</Text>
          </View>
        </View>

        {planKm > 0 ? (
          <View className="gap-2 border-t border-border-subtle pt-2">
            <Bar label="Distance compliance" plan={planKm} actual={actKm} unit="km" />
          </View>
        ) : null}

        <View className="gap-2 border-t border-border-subtle pt-2">
          {rows.map(([label, value]) => (
            <View key={label} className="flex-row items-center justify-between border-b border-border-subtle py-1.5">
              <Text variant="body" className="text-text-secondary">{label}</Text>
              <Text variant="body" className="tabular-nums text-text">{value}</Text>
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}
