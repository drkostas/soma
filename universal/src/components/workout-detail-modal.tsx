import { useEffect, useState } from "react";
import { View, Image, Share } from "react-native";
import { Text, Modal, Button } from "soma-style";
import { LineChart } from "./line-chart";
import { fetchJson, workoutImageSource } from "../lib/api";

interface WSet { weight_kg: number | null; reps: number | null; type?: string; avg_hr?: number }
interface WExercise { title: string; sets: WSet[] }
interface HrZone { zone: number; seconds: number; low: number; high: number }
interface WorkoutDetail {
  id: string; title?: string; start_time?: string; end_time?: string;
  exercises: WExercise[];
  garmin: {
    avg_hr: number | null; max_hr: number | null; min_hr?: number | null; calories: number | null;
    hr_zones?: HrZone[] | null;
    hr_timeline?: { elapsed_sec: number; hr: number }[];
  } | null;
}

// Zone 1..5 palette (easy → max).
const ZONE_COLORS = ["#5a7a8a", "#77c8d1", "#6ad4a0", "#e0a458", "#e06060"];
// Distinct set types get a badge; "normal" is left plain.
const SET_TYPE: Record<string, { label: string; color: string }> = {
  warmup: { label: "W", color: "#8aa0ac" },
  failure: { label: "F", color: "#e06060" },
  dropset: { label: "D", color: "#e0a458" },
};

const KG_TO_LB = 2.20462;
function longDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function durationMin(w: WorkoutDetail): number | null {
  if (!w.start_time || !w.end_time) return null;
  const a = new Date(w.start_time).getTime(), b = new Date(w.end_time).getTime();
  return isFinite(a) && isFinite(b) && b > a ? Math.round((b - a) / 60000) : null;
}

/**
 * Single-workout detail (web parity, #429): per-exercise sets (weight × reps),
 * total volume + set count, and the Garmin HR / calories overlay. Fetches
 * /api/workout/[id] on open. Weight unit follows the screen toggle.
 */
export function WorkoutDetailModal({ id, title, unit, onClose }: { id: string | null; title?: string; unit: "kg" | "lb"; onClose: () => void }) {
  const [data, setData] = useState<WorkoutDetail | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!id) { setData(null); return; }
    let alive = true;
    setLoading(true);
    fetchJson<WorkoutDetail>(`/api/workout/${encodeURIComponent(id)}`)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [id]);

  if (!id) return null;
  const w = (kg: number | null | undefined) => (kg == null ? "—" : `${Math.round((unit === "lb" ? kg * KG_TO_LB : kg) * 10) / 10}`);
  const exercises = data?.exercises ?? [];
  let volumeKg = 0, setCount = 0;
  for (const ex of exercises) for (const s of ex.sets) {
    if (s.weight_kg != null && s.reps != null) volumeKg += s.weight_kg * s.reps;
    setCount++;
  }
  const vol = unit === "lb" ? volumeKg * KG_TO_LB : volumeKg;
  const dur = data ? durationMin(data) : null;

  return (
    <Modal visible={!!id} onClose={onClose} title={data?.title || title || "Workout"}>
      <View className="gap-3">
        {loading && !data ? (
          <Text variant="body" className="text-text-muted">Loading…</Text>
        ) : !data ? (
          <Text variant="body" className="text-text-muted">No detail for this workout.</Text>
        ) : (
          <>
            <Text variant="micro" className="text-text-muted">{longDate(data.start_time)}</Text>
            <View className="flex-row flex-wrap gap-3">
              <View className="min-w-[30%] flex-1">
                <Text variant="eyebrow" className="text-text-muted">Volume</Text>
                <Text variant="title" className="text-teal">{vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : Math.round(vol)}</Text>
                <Text variant="micro" className="text-text-muted">{unit} · {setCount} sets</Text>
              </View>
              {dur != null ? (
                <View className="min-w-[30%] flex-1">
                  <Text variant="eyebrow" className="text-text-muted">Duration</Text>
                  <Text variant="title" className="text-lime">{dur}</Text>
                  <Text variant="micro" className="text-text-muted">min</Text>
                </View>
              ) : null}
              {data.garmin?.calories != null ? (
                <View className="min-w-[30%] flex-1">
                  <Text variant="eyebrow" className="text-text-muted">Calories</Text>
                  <Text variant="title" className="text-warm">{Math.round(data.garmin.calories)}</Text>
                  <Text variant="micro" className="text-text-muted">kcal · Garmin</Text>
                </View>
              ) : null}
              {data.garmin?.avg_hr != null ? (
                <View className="min-w-[30%] flex-1">
                  <Text variant="eyebrow" className="text-text-muted">Avg HR</Text>
                  <Text variant="title" className="text-danger">{Math.round(data.garmin.avg_hr)}</Text>
                  <Text variant="micro" className="text-text-muted">
                    {data.garmin.min_hr != null ? `${Math.round(data.garmin.min_hr)}–` : ""}{data.garmin.max_hr != null ? `${Math.round(data.garmin.max_hr)} bpm` : "bpm"}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Garmin HR over the session (from enrichment hr_samples) */}
            {(() => {
              const tl = data.garmin?.hr_timeline ?? [];
              if (tl.length < 2) return null;
              const hrs = tl.map((p) => p.hr);
              const labels = tl.map((p) => `${Math.round(p.elapsed_sec / 60)}m`);
              return (
                <View className="gap-1">
                  <Text variant="eyebrow" className="text-text-muted">Heart rate</Text>
                  <LineChart height={130} interactive xTicks={4} labels={labels}
                    yFormat={(v) => `${Math.round(v)}`}
                    series={[{ values: hrs, color: "#e06060", width: 2 }]} />
                </View>
              );
            })()}

            {/* Time in HR zones (only for workouts matched to a Garmin cardio activity) */}
            {data.garmin?.hr_zones && data.garmin.hr_zones.length > 0 ? (() => {
              const zones = data.garmin!.hr_zones!;
              const maxSec = Math.max(...zones.map((z) => z.seconds), 1);
              return (
                <View className="gap-1.5">
                  <Text variant="eyebrow" className="text-text-muted">Time in zones</Text>
                  {zones.map((z) => {
                    const mins = z.seconds / 60;
                    const color = ZONE_COLORS[Math.min(Math.max(z.zone - 1, 0), 4)];
                    return (
                      <View key={z.zone} className="flex-row items-center gap-2">
                        <Text variant="micro" className="w-14 text-text-secondary tabular-nums">Z{z.zone} · {z.low}+</Text>
                        <View className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: "#142530" }}>
                          <View style={{ width: `${Math.max((z.seconds / maxSec) * 100, 2)}%`, height: "100%", backgroundColor: color }} />
                        </View>
                        <Text variant="micro" className="w-12 text-right text-text-muted tabular-nums">{mins >= 1 ? `${Math.round(mins)}m` : `${Math.round(z.seconds)}s`}</Text>
                      </View>
                    );
                  })}
                </View>
              );
            })() : null}

            <View className="gap-2">
              {exercises.map((ex, ei) => {
                let exVol = 0, topIdx = -1, topVol = 0;
                ex.sets.forEach((s, i) => {
                  if (s.weight_kg != null && s.reps != null) {
                    const v = s.weight_kg * s.reps;
                    exVol += v;
                    if (v > topVol) { topVol = v; topIdx = i; }
                  }
                });
                const exVolDisp = unit === "lb" ? exVol * KG_TO_LB : exVol;
                return (
                  <View key={ei} className="gap-1 border-t border-border-subtle pt-2">
                    <View className="flex-row items-center justify-between">
                      <Text variant="body" className="flex-shrink text-text" numberOfLines={1}>{ex.title || "Exercise"}</Text>
                      {exVol > 0 ? (
                        <Text variant="micro" className="text-text-muted tabular-nums">
                          {exVolDisp >= 1000 ? `${(exVolDisp / 1000).toFixed(1)}k` : Math.round(exVolDisp)} {unit}
                        </Text>
                      ) : null}
                    </View>
                    <View className="flex-row flex-wrap gap-1.5">
                      {ex.sets.map((s, si) => {
                        const badge = s.type && s.type !== "normal" ? SET_TYPE[s.type] : undefined;
                        const isTop = si === topIdx && topVol > 0;
                        return (
                          <View key={si} className="flex-row items-center gap-1 rounded-md bg-surface-subtle px-2 py-1" style={isTop ? { borderWidth: 1, borderColor: "#77c8d1" } : undefined}>
                            {isTop ? <Text variant="micro" style={{ color: "#77c8d1" }}>▲</Text> : null}
                            {badge ? <Text variant="micro" style={{ color: badge.color }}>{badge.label}</Text> : null}
                            <Text variant="micro" className="tabular-nums text-text-secondary">
                              {s.weight_kg != null ? `${w(s.weight_kg)} × ` : ""}{s.reps ?? "—"}
                            </Text>
                            {s.avg_hr != null ? <Text variant="micro" className="tabular-nums" style={{ color: "#e06060" }}>♥{Math.round(s.avg_hr)}</Text> : null}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Shareable summary image */}
            <View className="items-center gap-2 border-t border-border-subtle pt-3">
              <Image source={workoutImageSource(id)} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: "#0e1a22" }} resizeMode="contain" />
              <Button label="Share workout" variant="secondary" size="sm" onPress={() => { Share.share({ url: workoutImageSource(id).uri, message: data.title || title || "Workout" }).catch(() => {}); }} />
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}
