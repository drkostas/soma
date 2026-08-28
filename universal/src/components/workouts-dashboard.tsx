import { useState } from "react";
import { View, Pressable } from "react-native";
import { Text, Card, Sparkline } from "soma-style";
import type { WorkoutSummary, TopExerciseRich } from "../lib/api";
import { LineChart } from "./line-chart";
import { ExerciseDetailModal } from "./exercise-detail-modal";
import { WorkoutDetailModal } from "./workout-detail-modal";

const KG_TO_LB = 2.20462;

const num = (v: unknown): number => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};
function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function kvol(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`;
}

/** Weekly training-volume as a full trend chart (axes + dated x-labels). */
function VolumeChart({ weeks }: { weeks: WorkoutSummary["weeklyVolume"] }) {
  const recent = weeks.slice(-16);
  const vals = recent.map((w) => num(w.total_volume));
  const nonZero = vals.filter((v) => v > 0);
  if (nonZero.length < 2) return null;
  const labels = recent.map((w) => shortDate(String(w.week)));
  const avg = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
  return (
    <LineChart
      height={130}
      labels={labels}
      yFormat={(v) => kvol(v)}
      refLine={{ y: avg, color: "#5a7a8a" }}
      series={[{ values: vals.map((v) => (v > 0 ? v : null)), color: "#77c8d1", width: 2.4 }]}
    />
  );
}

/** Workouts dashboard: summary stats + weekly volume + top exercises (+ optional
    recent list — hidden on the workouts screen, which has its own sync-status list). */
export function WorkoutsDashboard({ summary, showRecent = true, unit = "kg", topRich }: { summary: WorkoutSummary | null | undefined; showRecent?: boolean; unit?: "kg" | "lb"; topRich?: TopExerciseRich[] }) {
  const [exName, setExName] = useState<string | null>(null);
  const [wkId, setWkId] = useState<{ id: string; title: string } | null>(null);
  if (!summary) return null;
  const richByName = new Map((topRich ?? []).map((t) => [t.exercise, t]));
  const bestW = (kg: number | null) => (kg == null ? null : `${Math.round((unit === "lb" ? kg * KG_TO_LB : kg) * 10) / 10} ${unit}`);
  const s = summary.stats;
  const stats: { label: string; value: string; sub: string }[] = s
    ? [
        { label: "Sessions", value: `${num(s.total_workouts)}`, sub: `${num(s.training_days)} days` },
        { label: "Duration", value: `${Math.round(num(s.avg_duration_min))}`, sub: "min avg" },
        { label: "Exercise", value: num(s.avg_exercises).toFixed(1), sub: "avg / session" },
      ]
    : [];
  const peakVol = Math.max(0, ...summary.weeklyVolume.map((w) => num(w.total_volume)));

  return (
    <View className="gap-4">
      {stats.length ? (
        <View className="flex-row flex-wrap gap-3">
          {stats.map((st) => (
            <Card key={st.label} className="min-w-[30%] flex-1 gap-1">
              <Text variant="eyebrow">{st.label}</Text>
              <Text variant="headline" className="text-teal">{st.value}</Text>
              <Text variant="micro">{st.sub}</Text>
            </Card>
          ))}
        </View>
      ) : null}

      <Text variant="micro" className="text-text-muted">Tap an exercise or workout for detail</Text>

      {summary.weeklyVolume.length >= 2 ? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Weekly volume</Text>
            <Text variant="micro" className="tabular-nums text-text-muted">peak {kvol(peakVol)} kg</Text>
          </View>
          <VolumeChart weeks={summary.weeklyVolume} />
          <Text variant="micro" className="text-text-muted">weight × reps, normal sets</Text>
        </Card>
      ) : null}

      {summary.topExercises.length ? (
        <Card className="gap-2">
          <Text variant="eyebrow">Top exercises</Text>
          {summary.topExercises.map((e, i) => {
            const r = richByName.get(e.name);
            const spark = (r?.recent_weights ?? []).map((x) => Number(x)).filter((x) => isFinite(x));
            const best = r?.best_weight != null ? bestW(Number(r.best_weight)) : null;
            return (
              <Pressable key={e.name} onPress={() => setExName(e.name)} className="border-b border-border-subtle py-1.5">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2 flex-1">
                    <Text variant="micro" className="tabular-nums text-text-muted w-5">{i + 1}</Text>
                    <Text variant="body" className="text-text-secondary flex-1" numberOfLines={1}>{e.name}</Text>
                  </View>
                  <View className="flex-row items-center gap-1.5 ml-2">
                    {best ? <Text variant="micro" className="tabular-nums text-lime">{best}</Text> : null}
                    <Text variant="caption" className="tabular-nums text-text-muted">{e.sessions}×</Text>
                    <Text variant="micro" className="text-text-muted">›</Text>
                  </View>
                </View>
                {spark.length >= 2 ? (
                  <View className="mt-1 pl-7">
                    <Sparkline data={spark} color="#77c8d1" height={18} baseline />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </Card>
      ) : null}

      {showRecent && summary.recent.length ? (
        <Card className="gap-2">
          <Text variant="eyebrow">Recent workouts</Text>
          {summary.recent.slice(0, 10).map((w) => (
            <Pressable key={w.id} onPress={() => setWkId({ id: w.id, title: w.title || "Workout" })} className="border-b border-border-subtle py-2">
              <View className="flex-row items-center justify-between">
                <Text variant="body" className="text-text flex-1" numberOfLines={1}>{w.title || "Workout"}</Text>
                <View className="flex-row items-center gap-1.5 ml-2">
                  <Text variant="micro" className="text-text-muted">{shortDate(w.start_time)}</Text>
                  <Text variant="micro" className="text-text-muted">›</Text>
                </View>
              </View>
              <Text variant="micro" className="text-text-muted">
                {w.exercise_count} exercises{w.duration_min ? ` · ${w.duration_min} min` : ""}{w.volume > 0 ? ` · ${kvol(w.volume)} kg` : ""}
              </Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      <ExerciseDetailModal name={exName} unit={unit} onClose={() => setExName(null)} />
      <WorkoutDetailModal id={wkId?.id ?? null} title={wkId?.title} unit={unit} onClose={() => setWkId(null)} />
    </View>
  );
}
