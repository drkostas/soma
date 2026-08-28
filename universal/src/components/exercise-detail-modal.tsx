import { useEffect, useState } from "react";
import { View } from "react-native";
import { Text, Card, Modal, Badge } from "soma-style";
import { LineChart } from "./line-chart";
import { fetchJson } from "../lib/api";

interface Rec { value: number; date: string; reps?: number; weight?: number }
interface ProgPoint {
  date: string; workoutId: string; program: string | null;
  maxWeight: number; totalVolume: number; maxReps: number; estimated1RM: number;
  avgHr: number | null; sets: { weight: number; reps: number; type: string }[];
}
interface ExerciseDetail {
  name: string;
  muscles: { primary: string[]; secondary: string[] };
  totalSessions: number; totalSets: number; totalReps: number;
  records: { maxWeight: Rec; maxReps: Rec; maxVolume: Rec; estimated1RM: Rec };
  progression: ProgPoint[];
}

const KG_TO_LB = 2.20462;
function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

/**
 * Per-exercise detail (web parity, #429): muscles, PRs (max weight / est 1RM /
 * max reps), a weight-progression LineChart, and the most-recent sets. Fetches
 * /api/workouts/exercise?name= on open. Weight unit follows the screen toggle.
 */
export function ExerciseDetailModal({ name, unit, onClose }: { name: string | null; unit: "kg" | "lb"; onClose: () => void }) {
  const [data, setData] = useState<ExerciseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!name) { setData(null); return; }
    let alive = true;
    setLoading(true);
    fetchJson<ExerciseDetail>(`/api/workouts/exercise?name=${encodeURIComponent(name)}`)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [name]);

  if (!name) return null;
  const w = (kg: number | null | undefined) => (kg == null ? "—" : `${Math.round((unit === "lb" ? kg * KG_TO_LB : kg) * 10) / 10} ${unit}`);
  const prog = data?.progression ?? [];
  const wSeries = prog.map((p) => (unit === "lb" ? p.maxWeight * KG_TO_LB : p.maxWeight));
  const last = prog.length ? prog[prog.length - 1] : null;
  const muscles = [...(data?.muscles.primary ?? [])];

  return (
    <Modal visible={!!name} onClose={onClose} title={name}>
      <View className="gap-3">
        {loading && !data ? (
          <Text variant="body" className="text-text-muted">Loading…</Text>
        ) : !data ? (
          <Text variant="body" className="text-text-muted">No data for this exercise.</Text>
        ) : (
          <>
            {muscles.length ? (
              <View className="flex-row flex-wrap gap-1.5">
                {muscles.map((m) => <Badge key={m} label={m} tone="teal" />)}
                {(data.muscles.secondary ?? []).map((m) => <Badge key={m} label={m} tone="neutral" />)}
              </View>
            ) : null}

            <View className="flex-row flex-wrap gap-3">
              <View className="min-w-[46%] flex-1">
                <Text variant="eyebrow" className="text-text-muted">Max weight</Text>
                <Text variant="title" className="text-lime">{w(data.records.maxWeight?.value)}</Text>
                <Text variant="micro" className="text-text-muted">{data.records.maxWeight?.reps ?? "—"} reps · {shortDate(data.records.maxWeight?.date)}</Text>
              </View>
              <View className="min-w-[46%] flex-1">
                <Text variant="eyebrow" className="text-text-muted">Est. 1RM</Text>
                <Text variant="title" className="text-teal">{w(data.records.estimated1RM?.value)}</Text>
                <Text variant="micro" className="text-text-muted">{shortDate(data.records.estimated1RM?.date)}</Text>
              </View>
              <View className="min-w-[46%] flex-1">
                <Text variant="eyebrow" className="text-text-muted">Max reps</Text>
                <Text variant="title" className="text-text">{data.records.maxReps?.value ?? "—"}</Text>
                <Text variant="micro" className="text-text-muted">@ {w(data.records.maxReps?.weight)}</Text>
              </View>
              <View className="min-w-[46%] flex-1">
                <Text variant="eyebrow" className="text-text-muted">Sessions</Text>
                <Text variant="title" className="text-text">{data.totalSessions}</Text>
                <Text variant="micro" className="text-text-muted">{data.totalSets} sets · {data.totalReps} reps</Text>
              </View>
            </View>

            {wSeries.length >= 2 ? (
              <View className="gap-1">
                <Text variant="eyebrow" className="text-text-muted">Max weight · {wSeries.length} sessions</Text>
                <LineChart height={140} series={[{ values: wSeries, color: "#cbe896", width: 2.2 }]} yFormat={(v) => `${Math.round(v)}`} />
              </View>
            ) : null}

            {last?.sets?.length ? (
              <View className="gap-1">
                <Text variant="eyebrow" className="text-text-muted">Last session · {shortDate(last.date)}</Text>
                <View className="flex-row flex-wrap gap-1.5">
                  {last.sets.map((s, i) => (
                    <View key={i} className="rounded-md bg-surface-subtle px-2 py-1">
                      <Text variant="micro" className="tabular-nums text-text">{w(s.weight)} × {s.reps}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </View>
    </Modal>
  );
}
