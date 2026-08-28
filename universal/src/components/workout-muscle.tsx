import { useMemo } from "react";
import { View } from "react-native";
import { Text, Card } from "soma-style";
import type { WorkoutInsights } from "../lib/api";

const num = (v: unknown): number => { const n = Number(v); return isFinite(n) ? n : 0; };
const GROUPS = ["Chest", "Back", "Shoulders", "Arms", "Legs", "Core"] as const;
const COLOR: Record<string, string> = {
  Chest: "#e06060", Back: "#77c8d1", Shoulders: "#e0a458",
  Arms: "#c084fc", Legs: "#6ad4a0", Core: "#cbe896",
};
function kvol(v: number): string { return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`; }
function monthLabel(m: string): string { const [, mm] = m.split("-").map(Number); return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][(mm ?? 1) - 1]; }

/**
 * Muscle-group training distribution (web parity, #426): a per-muscle volume
 * bar breakdown (mobile take on the anatomical body map) plus a stacked
 * monthly-volume-by-muscle chart. Fed by /api/workouts/insights.monthlyMuscle.
 */
export function WorkoutMuscle({ insights }: { insights: WorkoutInsights | null | undefined }) {
  const rows = insights?.monthlyMuscle ?? [];
  const { totals, grandTotal, months } = useMemo(() => {
    const t: Record<string, number> = {};
    const monthMap = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const g = r.muscle_group; const v = num(r.volume);
      t[g] = (t[g] ?? 0) + v;
      if (!monthMap.has(r.month)) monthMap.set(r.month, {});
      const mm = monthMap.get(r.month)!; mm[g] = (mm[g] ?? 0) + v;
    }
    const gt = Object.values(t).reduce((a, b) => a + b, 0);
    const ms = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8);
    return { totals: t, grandTotal: gt, months: ms };
  }, [rows]);

  if (!rows.length || grandTotal <= 0) return null;
  const maxGroup = Math.max(...GROUPS.map((g) => totals[g] ?? 0)) || 1;
  const maxMonth = Math.max(...months.map(([, mm]) => Object.values(mm).reduce((a, b) => a + b, 0))) || 1;

  return (
    <View className="gap-4">
      <Card className="gap-2">
        <Text variant="eyebrow">Muscle volume</Text>
        {GROUPS.map((g) => {
          const v = totals[g] ?? 0;
          const pct = grandTotal > 0 ? Math.round((v / grandTotal) * 100) : 0;
          return (
            <View key={g} className="flex-row items-center gap-2 py-0.5">
              <Text variant="micro" className="text-text-secondary w-16">{g}</Text>
              <View className="flex-1 h-3 rounded-full bg-surface-subtle overflow-hidden">
                <View className="h-full rounded-full" style={{ width: `${Math.max(3, (v / maxGroup) * 100)}%`, backgroundColor: COLOR[g] }} />
              </View>
              <Text variant="micro" className="tabular-nums text-text-muted w-20 text-right">{kvol(v)} · {pct}%</Text>
            </View>
          );
        })}
        <Text variant="micro" className="text-text-muted">total volume by muscle group (kg × reps)</Text>
      </Card>

      {months.length >= 2 ? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Monthly volume by muscle</Text>
            <Text variant="micro" className="text-text-muted">last {months.length} mo</Text>
          </View>
          <View className="h-32 flex-row items-end gap-1.5">
            {months.map(([month, mm]) => {
              const monthTotal = Object.values(mm).reduce((a, b) => a + b, 0);
              const colH = monthTotal > 0 ? (monthTotal / maxMonth) * 100 : 0;
              return (
                <View key={month} className="flex-1 justify-end self-stretch">
                  <View className="w-full overflow-hidden rounded-t-sm" style={{ height: `${Math.max(3, colH)}%` }}>
                    {GROUPS.filter((g) => (mm[g] ?? 0) > 0).map((g) => (
                      <View key={g} style={{ height: `${((mm[g] ?? 0) / monthTotal) * 100}%`, backgroundColor: COLOR[g] }} />
                    ))}
                  </View>
                </View>
              );
            })}
          </View>
          <View className="flex-row gap-1.5">
            {months.map(([month]) => (
              <Text key={month} variant="micro" className="flex-1 text-center text-text-muted">{monthLabel(month)}</Text>
            ))}
          </View>
          <View className="flex-row flex-wrap gap-x-3 gap-y-1">
            {GROUPS.map((g) => (
              <View key={g} className="flex-row items-center gap-1">
                <View className="h-2 w-2 rounded-full" style={{ backgroundColor: COLOR[g] }} />
                <Text variant="micro" className="text-text-muted">{g}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
    </View>
  );
}
