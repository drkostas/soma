import { View } from "react-native";
import { Text, Card } from "soma-style";
import type { WorkoutSummary } from "../lib/api";

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

/** Weekly training-volume bars, peak highlighted. */
function VolumeChart({ weeks }: { weeks: WorkoutSummary["weeklyVolume"] }) {
  const data = weeks.map((w) => num(w.total_volume)).filter((v) => v > 0).slice(-16);
  if (data.length < 2) return null;
  const max = Math.max(...data) || 1;
  const maxIdx = data.indexOf(max);
  return (
    <View className="h-24 flex-row items-end gap-1">
      {data.map((v, i) => (
        <View key={i} className="flex-1 items-center justify-end self-stretch">
          <View className="w-full rounded-t-sm" style={{ height: `${Math.max(3, (v / max) * 100)}%`, backgroundColor: i === maxIdx ? "#77c8d1" : "#2f4a58" }} />
        </View>
      ))}
    </View>
  );
}

/** Workouts dashboard: summary stats + weekly volume + top exercises + recent list. */
export function WorkoutsDashboard({ summary }: { summary: WorkoutSummary | null | undefined }) {
  if (!summary) return null;
  const s = summary.stats;
  const stats: { label: string; value: string; sub: string }[] = s
    ? [
        { label: "Workouts", value: `${num(s.total_workouts)}`, sub: `${num(s.training_days)} days` },
        { label: "Avg duration", value: `${Math.round(num(s.avg_duration_min))}`, sub: "min" },
        { label: "Avg exercises", value: num(s.avg_exercises).toFixed(1), sub: "per session" },
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
          {summary.topExercises.map((e) => (
            <View key={e.name} className="flex-row items-center justify-between border-b border-border-subtle py-1.5">
              <Text variant="body" className="text-text-secondary flex-1" numberOfLines={1}>{e.name}</Text>
              <Text variant="caption" className="tabular-nums text-text-muted ml-2">{e.sessions}×</Text>
            </View>
          ))}
        </Card>
      ) : null}

      {summary.recent.length ? (
        <Card className="gap-2">
          <Text variant="eyebrow">Recent workouts</Text>
          {summary.recent.slice(0, 10).map((w) => (
            <View key={w.id} className="border-b border-border-subtle py-2">
              <View className="flex-row items-center justify-between">
                <Text variant="body" className="text-text flex-1" numberOfLines={1}>{w.title || "Workout"}</Text>
                <Text variant="micro" className="text-text-muted ml-2">{shortDate(w.start_time)}</Text>
              </View>
              <Text variant="micro" className="text-text-muted">
                {w.exercise_count} exercises{w.duration_min ? ` · ${w.duration_min} min` : ""}{w.volume > 0 ? ` · ${kvol(w.volume)} kg` : ""}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  );
}
