import { View } from "react-native";
import { Text } from "soma-style";

/* ── Per-meal protein quality (MPS signaling) ──────────────────────────────
 * Schoenfeld & Aragon 2018 / Trommelen 2023: the muscle-protein-synthesis
 * floor is ~0.4 g/kg per eating event (≈30 g at 75 kg, scaling with mass).
 * A pill flags a logged meal that falls below that floor; meals at/above it
 * show nothing. Mirrors web/lib/per-meal-protein.tsx. */
export type PerMealProteinLevel = "red" | "amber" | "yellow" | "green" | "plenty";
const MPS_G_PER_KG = 0.4;
const PLENTY_G_PER_KG = 0.55;
const FALLBACK_MPS_G = 30;

function proteinThresholds(weightKg: number | null | undefined) {
  if (!weightKg || weightKg <= 0) return { red: 15, amber: 25, yellow: 30, plenty: 55 };
  const mps = Math.max(20, Math.round(weightKg * MPS_G_PER_KG));
  const plenty = Math.max(40, Math.round(weightKg * PLENTY_G_PER_KG));
  return { red: Math.max(10, Math.round(mps * 0.5)), amber: Math.max(15, Math.round(mps * 0.83)), yellow: mps, plenty };
}

export function perMealProteinLevel(g: number, weightKg?: number | null): PerMealProteinLevel {
  const t = proteinThresholds(weightKg);
  if (g < t.red) return "red";
  if (g < t.amber) return "amber";
  if (g < t.yellow) return "yellow";
  if (g <= t.plenty) return "green";
  return "plenty";
}

const PILL: Record<"red" | "amber" | "yellow", { fg: string; bg: string; label: string }> = {
  red: { fg: "#f2868c", bg: "#3a1e24", label: "low protein" },
  amber: { fg: "#e0a458", bg: "#33291a", label: "below MPS" },
  yellow: { fg: "#e0d060", bg: "#31311c", label: "near MPS" },
};

/** MPS-floor pill for one logged meal. Renders nothing when the meal's protein
 *  is already at or above the floor (green / plenty). */
export function ProteinQualityPill({ grams, weightKg }: { grams: number; weightKg?: number | null }) {
  const level = perMealProteinLevel(grams, weightKg);
  if (level === "green" || level === "plenty") return null;
  const p = PILL[level];
  return (
    <View className="rounded px-1.5 py-[1px]" style={{ backgroundColor: p.bg }}>
      <Text variant="micro" style={{ color: p.fg }}>{p.label}</Text>
    </View>
  );
}

/** One research-anchored goalpost on a macro bar. Mirrors web's MacroBar. */
export interface MacroMarker {
  value: number;
  label: string;
  /** 'achievement' (default): a tier mark, no overlay past it.
   *  'softCeiling': amber overlay past this value (warning).
   *  'hardCeiling': red overlay + red marker past this value (real ceiling). */
  kind?: "achievement" | "softCeiling" | "hardCeiling";
  /** Optimal hit-this target — renders the marker line green. */
  optimal?: boolean;
  /** Short reason shown under the bar when this is the leading marker. */
  description?: string;
}

const TRACK = "#16242c";
const GREEN = "#6ad4a0";
const RED = "#e06060";
const AMBER = "#e0a458";
const FOREGROUND = "#c9d4de";

/** Multi-goalpost macro progress bar. When `markers` is passed it renders the
 *  research-anchored tier set (crossed dim, ahead bright), an amber overlay past
 *  a soft ceiling and a red overlay past a hard ceiling — the same goalpost
 *  system as the web dashboard. Falls back to a simple floor bar otherwise. */
export function MacroGoalBar({
  label,
  current,
  target,
  color,
  markers,
  unit = "g",
}: {
  label: string;
  current: number;
  target: number;
  color: string;
  markers?: MacroMarker[];
  unit?: string;
}) {
  const useMulti = !!markers && markers.length > 0;
  const highest = useMulti ? Math.max(...markers!.map((m) => m.value)) : 0;
  const softCeiling = useMulti ? markers!.find((m) => m.kind === "softCeiling") : undefined;
  const hardCeiling = useMulti ? markers!.find((m) => m.kind === "hardCeiling") : undefined;

  const axisAnchors = useMulti
    ? [highest * 1.15, current * 1.05, highest + 1]
    : [target * 1.15, current * 1.05, target + 1];
  const maxVal = Math.max(...axisAnchors, 1);
  const fillPct = Math.min(100, (current / maxVal) * 100);

  const pastSoft = !!softCeiling && current > softCeiling.value;
  const pastHard = !!hardCeiling && current > hardCeiling.value;
  const softStartPct = softCeiling ? Math.min(100, (softCeiling.value / maxVal) * 100) : 0;
  const orangeEndValue = hardCeiling ? Math.min(current, hardCeiling.value) : current;
  const orangeEndPct = useMulti ? Math.min(100, (orangeEndValue / maxVal) * 100) : 0;
  const hardStartPct = hardCeiling ? Math.min(100, (hardCeiling.value / maxVal) * 100) : 100;

  const displayRef = useMulti ? (softCeiling?.value ?? hardCeiling?.value ?? highest) : target;
  const floorPct = !useMulti && target > 0 ? Math.min(100, (target / maxVal) * 100) : null;
  const underFloor = current < (useMulti ? (markers!.find((m) => m.optimal)?.value ?? 0) : target);

  const valueTone = pastHard ? "text-danger" : pastSoft ? "text-warm" : "text-text-muted";

  return (
    <View className="gap-1">
      <View className="flex-row justify-between">
        <Text variant="caption" className="text-text-secondary">{label}</Text>
        <Text variant="caption" className={`tabular-nums ${valueTone}`}>
          {Math.round(current)}/{Math.round(displayRef)}{unit}
        </Text>
      </View>
      <View className="relative h-2 overflow-hidden rounded-full" style={{ backgroundColor: TRACK }}>
        {/* Base fill */}
        <View className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${fillPct}%`, backgroundColor: color }} />
        {/* Soft-ceiling amber overlay */}
        {useMulti && pastSoft && orangeEndPct > softStartPct ? (
          <View className="absolute top-0 h-full" style={{ left: `${softStartPct}%`, width: `${orangeEndPct - softStartPct}%`, backgroundColor: AMBER }} />
        ) : null}
        {/* Hard-ceiling red overlay */}
        {useMulti && pastHard && fillPct > hardStartPct ? (
          <View className="absolute top-0 h-full" style={{ left: `${hardStartPct}%`, width: `${fillPct - hardStartPct}%`, backgroundColor: RED }} />
        ) : null}
        {/* Multi-markers */}
        {useMulti
          ? markers!.map((m, i) => {
              const pct = Math.min(99.5, (m.value / maxVal) * 100);
              const crossed = current >= m.value;
              const base = m.kind === "hardCeiling" ? RED : m.optimal ? GREEN : FOREGROUND;
              return (
                <View
                  key={i}
                  className="absolute top-0 h-full"
                  style={{ left: `${pct}%`, width: 2, backgroundColor: base, opacity: crossed ? 0.4 : 1, shadowColor: "#000", shadowOpacity: 0.7, shadowRadius: 0.5, shadowOffset: { width: 0, height: 0 }, elevation: 2 }}
                />
              );
            })
          : floorPct !== null && target > 0
            ? <View className="absolute top-0 h-full" style={{ left: `${Math.min(floorPct, 99.5)}%`, width: 2, backgroundColor: "#77c8d1" }} />
            : null}
      </View>
    </View>
  );
}

const PROTEIN_DESC: Record<string, string> = {
  "1.6": "Hypertrophy minimum",
  "1.8": "Common cutting target",
  "2.0": "Conservative high",
  "2.2": "Best muscle preservation in a deficit",
};
const FAT_DESC: Record<string, string> = {
  "0.6": "Hormone-risk floor",
  "0.8": "Cutting consensus",
  "1.0": "Maintenance / bulk target",
};

/** Build the per-macro goalpost sets from body weight + today's matrix targets,
 *  matching the web dashboard's research anchors (g/kg protein & fat tiers,
 *  100 g carb floor, 60 g fiber ceiling). weightKg=0 falls back to targets. */
export function buildMacroMarkers(
  weightKg: number,
  t: { protein: number; carbs: number; fat: number; fiber: number },
): { protein: MacroMarker[]; carbs: MacroMarker[]; fat: MacroMarker[]; fiber: MacroMarker[] } {
  const w = weightKg > 0 ? weightKg : 0;
  const protein: MacroMarker[] = w > 0
    ? [1.6, 1.8, 2.0, 2.2].map((g) => ({ value: w * g, label: g.toFixed(1), optimal: g === 2.2, description: PROTEIN_DESC[g.toFixed(1)] }))
    : [{ value: t.protein, label: "target", optimal: true }];
  const fat: MacroMarker[] = w > 0
    ? [0.6, 0.8, 1.0].map((g) => ({ value: w * g, label: g.toFixed(1), optimal: g === 0.8, description: FAT_DESC[g.toFixed(1)] }))
    : [{ value: t.fat, label: "target", optimal: true }];
  const carbs: MacroMarker[] = [
    { value: 100, label: "min", description: "Health floor" },
    { value: t.carbs, label: "target", optimal: true, description: "Matrix carb target" },
  ].sort((a, b) => a.value - b.value);
  const fiber: MacroMarker[] = [
    { value: t.fiber || 30, label: "target", optimal: true, description: "Gut health + satiety" },
    { value: 60, label: "ceil", kind: "hardCeiling", description: "GI distress threshold" },
  ];
  return { protein, carbs, fat, fiber };
}
