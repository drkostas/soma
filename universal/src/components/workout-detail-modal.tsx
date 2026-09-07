import { useEffect, useMemo, useState } from "react";
import { View, Image, ScrollView, Pressable } from "react-native";
import { Text, Modal, Button, Badge } from "soma-style";
import { LineChart } from "./line-chart";
import { TabStrip } from "./tab-strip";
import { MuscleBodyMap } from "./muscle-body-map";
import { fetchJson, workoutImageSource } from "../lib/api";
import { aggregateWorkoutMuscles, MUSCLE_LABELS, ALL_MUSCLE_GROUPS, type MuscleGroup } from "../lib/muscle-groups";
import { shareImageFile } from "../lib/share-image";

interface WSet { weight_kg: number | null; reps: number | null; type?: string; avg_hr?: number }
interface WExercise { title: string; sets: WSet[]; notes?: string | null; muscle_group?: string | null }
interface HrZone { zone: number; seconds: number; low: number; high: number }
/** Exercise timing overlay the API synthesises from the Hevy sets (web's gantt source). */
interface ExerciseSet { exercise: string | null; start_sec: number; duration_sec: number; reps: number; weight: number; set_type: string }
interface WorkoutDetail {
  id: string; title?: string; start_time?: string; end_time?: string;
  exercises: WExercise[];
  garmin: {
    avg_hr: number | null; max_hr: number | null; min_hr?: number | null; calories: number | null;
    hr_zones?: HrZone[] | null;
    hr_timeline?: { elapsed_sec: number; hr: number }[];
    exercise_sets?: ExerciseSet[] | null;
    activity_id?: string | null;
  } | null;
}

// Zone 1..5 palette (easy → max) and web's zone names.
const ZONE_COLORS = ["#5a7a8a", "#77c8d1", "#6ad4a0", "#e0a458", "#e06060"];
const ZONE_NAMES = ["Warm Up", "Easy", "Aerobic", "Threshold", "Max"];
// Per-exercise block colours (web's exerciseColorMap palette).
const BLOCK_COLORS = ["#3b82f6", "#f97316", "#22c55e", "#ec4899", "#a855f7", "#eab308", "#06b6d4", "#ef4444"];
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
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function durationMin(w: WorkoutDetail): number | null {
  if (!w.start_time || !w.end_time) return null;
  const a = new Date(w.start_time).getTime(), b = new Date(w.end_time).getTime();
  return isFinite(a) && isFinite(b) && b > a ? Math.round((b - a) / 60000) : null;
}
const kvol = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);
const isWorking = (s: WSet) => (s.type ?? "normal") === "normal" && (s.weight_kg ?? 0) > 0 && (s.reps ?? 0) > 0;

function Box({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <View className="min-w-[30%] flex-1">
      <Text variant="eyebrow" className="text-text-muted">{label}</Text>
      <Text variant="title" style={color ? { color } : undefined} className={color ? undefined : "text-text"}>{value}</Text>
      {sub ? <Text variant="micro" className="text-text-muted">{sub}</Text> : null}
    </View>
  );
}

/* ---- HR tab: web's WorkoutHrTimeline (exercise blocks over the HR line + block strip) ---- */
interface Block { exercise: string; color: string; startSec: number; endSec: number; fillEnd: number; sets: ExerciseSet[]; avgHr: number | null }
function groupBlocks(sets: ExerciseSet[], totalSec: number, timeline: { elapsed_sec: number; hr: number }[]): Block[] {
  const names: string[] = [];
  const blocks: Omit<Block, "fillEnd" | "avgHr">[] = [];
  let cur: Omit<Block, "fillEnd" | "avgHr"> | null = null;
  for (const s of sets) {
    if (s.set_type === "REST") continue;
    const name = s.exercise || "Unknown";
    if (!names.includes(name)) names.push(name);
    if (cur && cur.exercise === name) { cur.endSec = s.start_sec + s.duration_sec; cur.sets.push(s); }
    else { if (cur) blocks.push(cur); cur = { exercise: name, color: BLOCK_COLORS[names.indexOf(name) % BLOCK_COLORS.length], startSec: s.start_sec, endSec: s.start_sec + s.duration_sec, sets: [s] }; }
  }
  if (cur) blocks.push(cur);
  return blocks.map((b, i) => {
    const fillEnd = i < blocks.length - 1 ? blocks[i + 1].startSec : totalSec;
    const inside = timeline.filter((p) => p.elapsed_sec >= b.startSec && p.elapsed_sec < fillEnd).map((p) => p.hr);
    return { ...b, fillEnd, avgHr: inside.length ? inside.reduce((a, c) => a + c, 0) / inside.length : null };
  });
}

function HrTab({ g, title }: { g: NonNullable<WorkoutDetail["garmin"]>; title: string }) {
  const tl = g.hr_timeline ?? [];
  const [selected, setSelected] = useState<number | null>(null);
  const total = tl.length ? tl[tl.length - 1].elapsed_sec : 0;
  const blocks = useMemo(() => groupBlocks(g.exercise_sets ?? [], total, tl), [g.exercise_sets, total, tl]);
  const idxAt = (sec: number) => { if (!tl.length) return 0; let best = 0; for (let i = 0; i < tl.length; i++) if (tl[i].elapsed_sec <= sec) best = i; else break; return best; };
  const hrs = tl.map((p) => p.hr);
  const avg = hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null;
  const zones = (g.hr_zones ?? []).filter((z) => z.seconds > 0);
  const zTotal = zones.reduce((a, z) => a + z.seconds, 0);
  if (tl.length < 2) {
    return (
      <View className="items-center gap-1 py-6">
        <Text variant="body" className="text-text-muted">No heart rate data</Text>
        <Text variant="micro" className="text-text-muted">No matching Garmin activity found for {title}.</Text>
      </View>
    );
  }
  const xBands = blocks.map((b, i) => ({ i0: idxAt(b.startSec), i1: idxAt(b.fillEnd), color: b.color, opacity: selected == null ? 0.22 : selected === i ? 0.4 : 0.08 }));
  const xLines = [
    ...blocks.slice(1).map((b) => ({ i: idxAt(b.startSec), color: "#ffffff" })),
    ...blocks.flatMap((b) => b.sets.slice(1).map((s) => ({ i: idxAt(s.start_sec), color: "#ffffff", dashed: true }))),
  ];
  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-3">
        <Box label="Avg HR" value={g.avg_hr != null ? `${Math.round(g.avg_hr)}` : "—"} sub="bpm" color="#e06060" />
        <Box label="Max HR" value={g.max_hr != null ? `${Math.round(g.max_hr)}` : "—"} sub="bpm" />
        <Box label="Min HR" value={g.min_hr != null ? `${Math.round(g.min_hr)}` : "—"} sub="bpm" />
        <Box label="Calories" value={g.calories != null ? `${Math.round(g.calories)}` : "—"} sub="kcal" color="#e0a458" />
      </View>
      <LineChart
        height={170}
        interactive
        xTicks={4}
        labels={tl.map((p) => `${Math.round(p.elapsed_sec / 60)}m`)}
        yFormat={(v) => `${Math.round(v)}`}
        refLine={avg != null ? { y: avg, color: "#9fb3c0", label: "avg" } : undefined}
        xBands={xBands}
        xLines={xLines}
        series={[{ values: hrs, color: "#e6edf3", width: 1.8, label: "HR" }]}
      />
      {blocks.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pr-2">
          {blocks.map((b, i) => (
            <Pressable key={`${b.exercise}-${i}`} onPress={() => setSelected(selected === i ? null : i)} testID={`block-${i}`} accessibilityRole="button" accessibilityLabel={`${b.exercise}, ${b.sets.length} sets`}>
              <View className="rounded-lg px-2 py-1.5" style={{ backgroundColor: selected === i ? "#1c2d3a" : "#0f1c26", borderWidth: 1, borderColor: selected === i ? b.color : "#1a3040", minWidth: 96, opacity: selected == null || selected === i ? 1 : 0.55 }}>
                <View className="flex-row items-center gap-1.5">
                  <View className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
                  <Text variant="micro" className="text-text" numberOfLines={1} style={{ maxWidth: 110 }}>{b.exercise}</Text>
                </View>
                <Text variant="micro" className="text-text-muted">{b.sets.length} sets{b.avgHr != null ? ` · ${Math.round(b.avgHr)} bpm` : ""}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {selected != null && blocks[selected] ? (
        <View className="rounded-md px-2 py-1.5" style={{ backgroundColor: "#0f1c26", borderWidth: 1, borderColor: blocks[selected].color }}>
          <Text variant="micro" className="text-text">{blocks[selected].exercise}</Text>
          <Text variant="micro" className="text-text-muted">
            {blocks[selected].sets.map((s, k) => `Set ${k + 1}/${blocks[selected].sets.length}: ${s.weight > 0 ? `${s.weight} kg × ` : "BW × "}${s.reps}${s.set_type === "WARMUP" ? " (warmup)" : ""}`).join(" · ")}
          </Text>
        </View>
      ) : null}
      {zones.length && zTotal > 0 ? (
        <View className="gap-1.5">
          <Text variant="eyebrow" className="text-text-muted">Time in zones</Text>
          {zones.map((z) => {
            const pct = (z.seconds / zTotal) * 100;
            const color = ZONE_COLORS[Math.min(Math.max(z.zone - 1, 0), 4)];
            return (
              <View key={z.zone} className="flex-row items-center gap-2">
                <Text variant="micro" className="w-24 text-text-secondary" numberOfLines={1}>Z{z.zone} {ZONE_NAMES[z.zone - 1] ?? ""}</Text>
                <View className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: "#142530" }}>
                  <View style={{ width: `${Math.max(pct, 2)}%`, height: "100%", backgroundColor: color }} />
                </View>
                <Text variant="micro" className="w-20 text-right text-text-muted tabular-nums">{Math.round(pct)}% · {z.low}–{z.high}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {g.activity_id ? (
        <View className="flex-row items-center gap-2">
          <Badge label="Garmin" tone="success" />
          <Text variant="micro" className="text-text-muted">Matched from Garmin strength training activity</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Single-workout detail (web parity, #429 / #761): Exercises, Summary (with the
 * per-workout muscle map), HR (exercise blocks over the Garmin HR line) and Image
 * tabs. Fetches /api/workout/[id] on open. Weight unit follows the screen toggle.
 */
export function WorkoutDetailModal({ id, title, unit, onClose }: { id: string | null; title?: string; unit: "kg" | "lb"; onClose: () => void }) {
  const [data, setData] = useState<WorkoutDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<string>("Exercises");
  const [imgState, setImgState] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!id) { setData(null); return; }
    let alive = true;
    setLoading(true); setTab("Exercises"); setImgState("loading");
    fetchJson<WorkoutDetail>(`/api/workout/${encodeURIComponent(id)}`)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [id]);

  // Hooks stay above the early return (a hook after it changes the hook count when `id` flips).
  const exercises = data?.exercises ?? [];
  const muscles = useMemo(() => aggregateWorkoutMuscles(exercises), [exercises]);
  if (!id) return null;
  const w = (kg: number | null | undefined) => (kg == null ? "—" : `${Math.round((unit === "lb" ? kg * KG_TO_LB : kg) * 10) / 10}`);
  // Web's totals: working sets only (normal, with weight and reps).
  let volumeKg = 0, workingSets = 0, totalReps = 0, allSets = 0;
  for (const ex of exercises) for (const s of ex.sets) { allSets++; if (isWorking(s)) { workingSets++; totalReps += s.reps as number; volumeKg += (s.weight_kg as number) * (s.reps as number); } }
  const vol = unit === "lb" ? volumeKg * KG_TO_LB : volumeKg;
  const dur = data ? durationMin(data) : null;
  const muscleRows = ALL_MUSCLE_GROUPS.map((mg) => [mg, muscles[mg]?.total ?? 0] as [MuscleGroup, number]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const muscleMax = muscleRows.length ? muscleRows[0][1] : 1;
  const img = workoutImageSource(id);
  const name = data?.title || title || "Workout";
  const hasHr = (data?.garmin?.hr_timeline?.length ?? 0) > 1;
  const tabs = [{ key: "Exercises" }, { key: "Summary" }, { key: "HR" }, { key: "Image" }];

  return (
    <Modal visible={!!id} onClose={onClose} title={name}>
      <View className="gap-3" style={{ maxHeight: 560 }}>
        {loading && !data ? (
          <Text variant="body" className="text-text-muted">Loading…</Text>
        ) : !data ? (
          <Text variant="body" className="text-text-muted">No detail for this workout.</Text>
        ) : (
          <>
            <Text variant="micro" className="text-text-muted">{longDate(data.start_time)}</Text>
            <TabStrip tabs={tabs} value={tab} onChange={setTab} />
            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              {tab === "Exercises" ? (
                <View className="gap-2">
                  {exercises.map((ex, ei) => {
                    // Top set = heaviest WEIGHT among working sets (web parity); mark every
                    // set at that weight, and suppress when all working sets already match.
                    const workWeights = ex.sets.filter((s) => s.type !== "warmup" && s.weight_kg != null && s.weight_kg > 0).map((s) => s.weight_kg as number);
                    const maxWeight = workWeights.length ? Math.max(...workWeights) : 0;
                    const normalCount = ex.sets.filter((s) => s.type !== "warmup").length;
                    const atMaxCount = ex.sets.filter((s) => s.type !== "warmup" && s.weight_kg === maxWeight).length;
                    const showTop = maxWeight > 0 && atMaxCount < normalCount;
                    let exVol = 0; ex.sets.forEach((s) => { if (isWorking(s)) exVol += (s.weight_kg as number) * (s.reps as number); });
                    const exVolDisp = unit === "lb" ? exVol * KG_TO_LB : exVol;
                    let ordinal = 0;
                    return (
                      <View key={ei} className={`gap-1 ${ei ? "border-t border-border-subtle pt-2" : ""}`}>
                        <View className="flex-row items-center justify-between gap-2">
                          <View className="flex-row items-center gap-1.5 flex-shrink">
                            <Text variant="body" className="text-text flex-shrink" numberOfLines={1}>{ex.title || "Exercise"}</Text>
                            {ex.muscle_group ? <Badge label={ex.muscle_group} tone="neutral" /> : null}
                          </View>
                          {exVol > 0 ? <Text variant="micro" className="text-text-muted tabular-nums">{kvol(exVolDisp)} {unit}</Text> : null}
                        </View>
                        <View className="flex-row flex-wrap gap-1.5">
                          {ex.sets.map((s, si) => {
                            const badge = s.type && s.type !== "normal" ? SET_TYPE[s.type] : undefined;
                            const isTop = showTop && s.weight_kg === maxWeight && s.type !== "warmup";
                            const num = s.type === "warmup" ? "W" : String(++ordinal);
                            return (
                              <View key={si} className="flex-row items-center gap-1 rounded-md bg-surface-subtle px-2 py-1" style={isTop ? { borderWidth: 1, borderColor: "#77c8d1" } : undefined}>
                                <Text variant="micro" className="text-text-muted tabular-nums">{num}</Text>
                                {isTop ? <Text variant="micro" style={{ color: "#77c8d1" }}>▲</Text> : null}
                                {badge && s.type !== "warmup" ? <Text variant="micro" style={{ color: badge.color }}>{badge.label}</Text> : null}
                                <Text variant="micro" className="tabular-nums text-text-secondary">
                                  {s.weight_kg != null && s.weight_kg > 0 ? `${w(s.weight_kg)} × ` : (s.reps != null ? "BW × " : "")}{s.reps ?? "—"}
                                </Text>
                                {s.avg_hr != null ? <Text variant="micro" className="tabular-nums" style={{ color: "#e06060" }}>♥{Math.round(s.avg_hr)}</Text> : null}
                              </View>
                            );
                          })}
                        </View>
                        {ex.notes ? <Text variant="micro" className="text-text-muted" style={{ fontStyle: "italic" }}>{ex.notes}</Text> : null}
                      </View>
                    );
                  })}
                </View>
              ) : tab === "Summary" ? (
                <View className="gap-3">
                  <View className="flex-row flex-wrap gap-3">
                    <Box label="Duration" value={dur != null ? `${dur}` : "—"} sub="min" color="#cbe896" />
                    <Box label="Exercises" value={`${exercises.length}`} sub={`${allSets} sets`} />
                    <Box label="Working sets" value={`${workingSets}`} sub="weight × reps" />
                    <Box label="Total reps" value={`${totalReps}`} />
                    <Box label="Total volume" value={kvol(vol)} sub={unit} color="#77c8d1" />
                    {data.garmin?.calories != null
                      ? <Box label="Calories" value={`${Math.round(data.garmin.calories)}`} sub="kcal · Garmin" color="#e0a458" />
                      : <Box label="Avg volume / set" value={workingSets ? kvol(vol / workingSets) : "—"} sub={unit} />}
                  </View>
                  {muscleRows.length ? (
                    <View className="gap-2 border-t border-border-subtle pt-2">
                      <Text variant="eyebrow" className="text-text-muted">Muscles worked</Text>
                      <MuscleBodyMap volumes={muscles} selected={null} onSelect={() => {}} scale={0.8} />
                      <View className="gap-1" testID="muscle-list">
                        {muscleRows.slice(0, 6).map(([mg, v]) => (
                          <View key={mg} className="flex-row items-center gap-2">
                            <Text variant="micro" className="w-20 text-text-secondary">{MUSCLE_LABELS[mg]}</Text>
                            <View className="h-2 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: "#142530" }}>
                              <View style={{ width: `${Math.max(2, (v / muscleMax) * 100)}%`, height: "100%", backgroundColor: "#77c8d1" }} />
                            </View>
                            <Text variant="micro" className="w-10 text-right text-text-muted tabular-nums">{Math.round((v / (muscleRows.reduce((a, [, x]) => a + x, 0) || 1)) * 100)}%</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}
                  <View className="gap-1 border-t border-border-subtle pt-2">
                    <Text variant="eyebrow" className="text-text-muted">Volume by exercise</Text>
                    {exercises.map((ex, i) => { let v = 0; ex.sets.forEach((s) => { if (isWorking(s)) v += (s.weight_kg as number) * (s.reps as number); }); return v > 0 ? (
                      <View key={i} className="flex-row justify-between gap-3">
                        <Text variant="micro" className="text-text-secondary flex-1" numberOfLines={1}>{ex.title}</Text>
                        <Text variant="micro" className="text-text-muted tabular-nums">{kvol(unit === "lb" ? v * KG_TO_LB : v)} {unit}</Text>
                      </View>) : null; })}
                  </View>
                </View>
              ) : tab === "HR" ? (
                data.garmin && hasHr ? <HrTab g={data.garmin} title={name} /> : (
                  <View className="items-center gap-1 py-6">
                    <Text variant="body" className="text-text-muted">No heart rate data</Text>
                    <Text variant="micro" className="text-text-muted">No matching Garmin activity found.</Text>
                  </View>
                )
              ) : (
                <View className="items-center gap-3">
                  <View style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: "#0e1a22", overflow: "hidden" }}>
                    <Image source={img} style={{ width: "100%", height: "100%" }} resizeMode="contain" onLoadStart={() => setImgState("loading")} onLoad={() => setImgState("ready")} onError={() => setImgState("error")} />
                    {imgState !== "ready" ? (
                      <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
                        <Text variant="caption" className="text-text-muted">{imgState === "error" ? "The card could not be rendered." : "Rendering the card…"}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Button label={saving ? "Preparing…" : "Save / share PNG"} disabled={saving || imgState !== "ready"} onPress={async () => { setSaving(true); try { await shareImageFile(img, `${name.replace(/\s+/g, "-").toLowerCase()}.png`, name); } catch { /* dismissed */ } finally { setSaving(false); } }} />
                  <Text variant="micro" className="text-center text-text-muted">The same summary card web renders.</Text>
                </View>
              )}
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  );
}
