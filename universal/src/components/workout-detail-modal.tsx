import { useEffect, useState } from "react";
import { View } from "react-native";
import { Text, Card, Modal, Badge } from "soma-style";
import { fetchJson } from "../lib/api";

interface WSet { weight_kg: number | null; reps: number | null; type?: string; avg_hr?: number }
interface WExercise { title: string; sets: WSet[] }
interface WorkoutDetail {
  id: string; title?: string; start_time?: string; end_time?: string;
  exercises: WExercise[];
  garmin: { avg_hr: number | null; max_hr: number | null; calories: number | null } | null;
}

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
                  <Text variant="micro" className="text-text-muted">{data.garmin.max_hr != null ? `max ${Math.round(data.garmin.max_hr)}` : "bpm"}</Text>
                </View>
              ) : null}
            </View>

            <View className="gap-2">
              {exercises.map((ex, ei) => (
                <View key={ei} className="gap-1 border-t border-border-subtle pt-2">
                  <Text variant="body" className="text-text" numberOfLines={1}>{ex.title || "Exercise"}</Text>
                  <View className="flex-row flex-wrap gap-1.5">
                    {ex.sets.map((s, si) => (
                      <View key={si} className="rounded-md bg-surface-subtle px-2 py-1">
                        <Text variant="micro" className="tabular-nums text-text-secondary">
                          {s.weight_kg != null ? `${w(s.weight_kg)} × ` : ""}{s.reps ?? "—"}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}
