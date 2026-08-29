import { useEffect, useState } from "react";
import { View, ScrollView } from "react-native";
import { Text, Modal, Badge, SegmentedControl } from "soma-style";
import { LineChart } from "./line-chart";
import { fetchJson } from "../lib/api";

const PROG_METRICS = ["Weight", "Volume", "1RM", "Reps"] as const;
type ProgMetric = typeof PROG_METRICS[number];

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
  const [metric, setMetric] = useState<ProgMetric>("Weight");
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
  const uw = (kg: number) => (unit === "lb" ? kg * KG_TO_LB : kg);
  const prog = data?.progression ?? [];
  const muscles = [...(data?.muscles.primary ?? [])];

  const METRIC_CFG: Record<ProgMetric, { get: (p: ProgPoint) => number; color: string; fmt: (v: number) => string }> = {
    Weight: { get: (p) => uw(p.maxWeight), color: "#cbe896", fmt: (v) => `${Math.round(v)}` },
    Volume: { get: (p) => uw(p.totalVolume), color: "#77c8d1", fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`) },
    "1RM": { get: (p) => uw(p.estimated1RM), color: "#6ad4a0", fmt: (v) => `${Math.round(v)}` },
    Reps: { get: (p) => p.maxReps, color: "#e0a458", fmt: (v) => `${Math.round(v)}` },
  };
  const mcfg = METRIC_CFG[metric];
  const series = prog.map((p) => mcfg.get(p));
  // Recent sessions, newest first (bounded for the modal).
  const sessions = [...prog].reverse().slice(0, 8);

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
              {data.records.maxVolume?.value ? (
                <View className="min-w-[46%] flex-1">
                  <Text variant="eyebrow" className="text-text-muted">Best set volume</Text>
                  <Text variant="title" className="text-warm">{Math.round(uw(data.records.maxVolume.value)).toLocaleString()}</Text>
                  <Text variant="micro" className="text-text-muted">
                    {data.records.maxVolume.weight != null ? `${w(data.records.maxVolume.weight)} × ${data.records.maxVolume.reps ?? "—"} · ` : ""}{shortDate(data.records.maxVolume.date)}
                  </Text>
                </View>
              ) : null}
            </View>

            {series.length >= 2 ? (
              <View className="gap-2">
                <Text variant="eyebrow" className="text-text-muted">Progression · {series.length} sessions</Text>
                <SegmentedControl options={PROG_METRICS} value={metric} onChange={(v) => setMetric(v as ProgMetric)} />
                <LineChart height={150} interactive series={[{ values: series, color: mcfg.color, width: 2.2 }]} yFormat={mcfg.fmt} />
              </View>
            ) : null}

            {sessions.length ? (
              <View className="gap-1.5">
                <Text variant="eyebrow" className="text-text-muted">Session history</Text>
                <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                  {sessions.map((sess, si) => (
                    <View key={si} className="gap-1 border-t border-border-subtle py-2">
                      <View className="flex-row items-center justify-between">
                        <Text variant="caption" className="text-text">{shortDate(sess.date)}{sess.program ? ` · ${sess.program}` : ""}</Text>
                        <Text variant="micro" className="text-text-muted tabular-nums">
                          {Math.round(uw(sess.totalVolume)).toLocaleString()} {unit}{sess.avgHr != null ? ` · ♥${Math.round(sess.avgHr)}` : ""}
                        </Text>
                      </View>
                      <View className="flex-row flex-wrap gap-1.5">
                        {sess.sets.map((s, i) => (
                          <View key={i} className="rounded-md bg-surface-subtle px-2 py-1">
                            <Text variant="micro" className="tabular-nums text-text-secondary">{w(s.weight)} × {s.reps}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </>
        )}
      </View>
    </Modal>
  );
}
