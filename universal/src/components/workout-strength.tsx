import { useEffect, useState } from "react";
import { View, Pressable, ScrollView } from "react-native";
import { Text, Card } from "soma-style";
import { LineChart } from "./line-chart";
import { fetchJson } from "../lib/api";
import type { WorkoutInsights } from "../lib/api";

const KG_TO_LB = 2.20462;
const num = (v: unknown): number => { const n = Number(v); return isFinite(n) ? n : 0; };

interface ProgResp { progression: { date: string; maxWeight: number; estimated1RM: number }[] }

/** Configurable per-exercise strength progression: pick an exercise pill, load
 *  its max-weight-over-time line from /api/workouts/exercise. */
function StrengthProgression({ names, unit }: { names: string[]; unit: "kg" | "lb" }) {
  const [sel, setSel] = useState<string | null>(names[0] ?? null);
  const [prog, setProg] = useState<ProgResp["progression"]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!sel) return;
    let alive = true; setLoading(true);
    fetchJson<ProgResp>(`/api/workouts/exercise?name=${encodeURIComponent(sel)}`)
      .then((d) => alive && setProg(d.progression ?? []))
      .catch(() => alive && setProg([]))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [sel]);
  if (!names.length) return null;
  const vals = prog.map((p) => (unit === "lb" ? p.maxWeight * KG_TO_LB : p.maxWeight));

  return (
    <Card className="gap-2">
      <Text variant="eyebrow">Strength progression</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pr-2">
        {names.map((n) => (
          <Pressable key={n} onPress={() => setSel(n)} className={`rounded-full px-3 py-1 ${sel === n ? "bg-teal" : "bg-surface-subtle"}`}>
            <Text variant="micro" className={sel === n ? "text-base" : "text-text-secondary"}>{n}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {loading && !vals.length ? (
        <Text variant="micro" className="text-text-muted">Loading…</Text>
      ) : vals.length >= 2 ? (
        <LineChart height={140} series={[{ values: vals, color: "#cbe896", width: 2.2 }]} yFormat={(v) => `${Math.round(v)} ${unit}`} />
      ) : (
        <Text variant="micro" className="text-text-muted">Not enough sessions for {sel}.</Text>
      )}
    </Card>
  );
}

/** Strength progression + PR grid + program split (web parity, #427). */
export function WorkoutStrength({ insights, unit }: { insights: WorkoutInsights | null | undefined; unit: "kg" | "lb" }) {
  if (!insights) return null;
  const w = (kg: number) => `${Math.round((unit === "lb" ? kg * KG_TO_LB : kg) * 10) / 10} ${unit}`;
  const names = (insights.topExercises ?? []).map((e) => e.exercise).slice(0, 8);
  const prs = insights.prs ?? [];
  const split = insights.programSplit ?? [];
  const maxSessions = Math.max(1, ...split.map((p) => num(p.sessions)));

  return (
    <View className="gap-4">
      <StrengthProgression names={names} unit={unit} />

      {prs.length ? (
        <Card className="gap-2">
          <Text variant="eyebrow">Personal records</Text>
          <View className="flex-row flex-wrap gap-3">
            {prs.slice(0, 8).map((p) => (
              <View key={p.exercise} className="min-w-[46%] flex-1 gap-0.5">
                <Text variant="micro" className="text-text-secondary" numberOfLines={1}>{p.exercise}</Text>
                <Text variant="title" className="text-lime">{w(num(p.pr_weight))}</Text>
                {p.reps_at_pr != null ? <Text variant="micro" className="text-text-muted">{num(p.reps_at_pr)} reps</Text> : null}
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {split.length ? (
        <Card className="gap-2">
          <Text variant="eyebrow">Program split</Text>
          {split.map((p) => (
            <View key={p.program} className="flex-row items-center gap-2 py-0.5">
              <Text variant="micro" className="text-text-secondary flex-1" numberOfLines={1}>{p.program || "Untitled"}</Text>
              <View className="w-24 h-3 rounded-full bg-surface-subtle overflow-hidden">
                <View className="h-full rounded-full bg-teal" style={{ width: `${Math.max(6, (num(p.sessions) / maxSessions) * 100)}%` }} />
              </View>
              <Text variant="micro" className="tabular-nums text-text-muted w-20 text-right">
                {num(p.sessions)}× · {p.avg_duration != null ? `${num(p.avg_duration)}m` : "—"}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  );
}
