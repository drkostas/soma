import { useState } from "react";
import { View, Pressable } from "react-native";
import { Text, Card, SegmentedControl } from "soma-style";
import { MuscleBodyMap, type MuscleVolumes } from "./muscle-body-map";
import { ALL_MUSCLE_GROUPS, MUSCLE_COLORS, MUSCLE_LABELS, type MuscleGroup } from "../lib/muscle-groups";
import type { BodyMapData } from "../lib/api";

const METRICS = ["Volume", "Sets", "Reps", "Sessions"] as const;
type Metric = typeof METRICS[number];
const METRIC_KEY: Record<Metric, keyof BodyMapData> = { Volume: "volume", Sets: "sets", Reps: "reps", Sessions: "exercises" };
const METRIC_UNIT: Record<Metric, string> = { Volume: "kg", Sets: "sets", Reps: "reps", Sessions: "sessions" };

/**
 * Muscle activation map (web /workouts MuscleBodyMapSection parity): a
 * 4-metric toggle (Volume / Sets / Reps / Sessions) over the anatomical body
 * map plus a per-muscle breakdown with primary/secondary split bars, sorted by
 * activation. Selecting a row or a muscle highlights it on the figure and dims
 * the rest. Fed by /api/workouts/bodymap; hides itself when there is no data.
 */
export function MuscleBodyMapSection({ data }: { data: BodyMapData | null | undefined }) {
  const [metric, setMetric] = useState<Metric>("Volume");
  const [selected, setSelected] = useState<MuscleGroup | null>(null);

  const volumes: MuscleVolumes = (data?.[METRIC_KEY[metric]] as MuscleVolumes) ?? {};
  const sorted = ALL_MUSCLE_GROUPS
    .filter((mg) => (volumes[mg]?.total ?? 0) > 0)
    .sort((a, b) => (volumes[b]?.total ?? 0) - (volumes[a]?.total ?? 0));
  if (!data || sorted.length === 0) return null;

  const maxTotal = volumes[sorted[0]]?.total ?? 1;
  const unit = METRIC_UNIT[metric];
  const sel = selected ? volumes[selected] : null;
  const selPct = selected ? Math.round(((volumes[selected]?.total ?? 0) / maxTotal) * 100) : 0;

  return (
    <Card className="gap-3">
      <Text variant="eyebrow">Muscle activation</Text>
      <SegmentedControl options={METRICS} value={metric} onChange={(v) => { setSelected(null); setMetric(v as Metric); }} />

      <MuscleBodyMap volumes={volumes} selected={selected} onSelect={setSelected} scale={0.85} />

      {sel ? (
        <View className="flex-row flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
          <Text variant="caption" style={{ color: MUSCLE_COLORS[selected!] }}>{MUSCLE_LABELS[selected!]}</Text>
          <Text variant="caption" className="text-text-muted tabular-nums">{selPct}%</Text>
          {sel.primary > 0 ? <Text variant="micro" className="text-text-muted tabular-nums">{Math.round(sel.primary).toLocaleString()} primary</Text> : null}
          {sel.secondary > 0 ? <Text variant="micro" className="text-text-muted tabular-nums">+{Math.round(sel.secondary).toLocaleString()} sec</Text> : null}
        </View>
      ) : (
        <Text variant="micro" className="text-text-muted text-center">Tap a muscle or a row to focus it</Text>
      )}

      <View className="gap-1.5">
        {sorted.map((mg) => {
          const d = volumes[mg];
          if (!d) return null;
          const frac = d.total / maxTotal; // 0..1 of the top muscle
          const primaryFrac = d.total > 0 ? d.primary / d.total : 1;
          const isSel = selected === mg;
          const dim = selected !== null && !isSel;
          return (
            <Pressable key={mg} onPress={() => setSelected(isSel ? null : mg)} style={{ opacity: dim ? 0.35 : 1 }}>
              <View className="gap-0.5">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-1.5">
                    <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: MUSCLE_COLORS[mg] }} />
                    <Text variant="caption" className={isSel ? "text-text" : "text-text-secondary"}>{MUSCLE_LABELS[mg]}</Text>
                  </View>
                  <Text variant="caption" className="text-text-secondary tabular-nums">{Math.round(d.total).toLocaleString()} {unit}</Text>
                </View>
                <View className="h-1.5 flex-row overflow-hidden rounded-full" style={{ backgroundColor: "#142530" }}>
                  <View style={{ flex: Math.max(frac * primaryFrac, 0.02), backgroundColor: MUSCLE_COLORS[mg] }} />
                  {d.secondary > 0 ? <View style={{ flex: Math.max(frac * (1 - primaryFrac), 0.01), backgroundColor: MUSCLE_COLORS[mg], opacity: 0.4 }} /> : null}
                  <View style={{ flex: Math.max(1 - frac, 0.001) }} />
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View className="flex-row items-center gap-4 pt-1">
        <View className="flex-row items-center gap-1">
          <View style={{ width: 12, height: 6, borderRadius: 2, backgroundColor: "#10b981" }} />
          <Text variant="micro" className="text-text-muted">Primary</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <View style={{ width: 12, height: 6, borderRadius: 2, backgroundColor: "#10b981", opacity: 0.4 }} />
          <Text variant="micro" className="text-text-muted">Secondary</Text>
        </View>
      </View>
    </Card>
  );
}
