import { useEffect, useState, useMemo } from "react";
import { ScrollView, View, RefreshControl } from "react-native";
import { Text, Card, Badge, ProgressBar, SegmentedControl, Sparkline } from "soma-style";
import {
  useTraining,
  useCalibration,
  useForwardSim,
  useTrajectory,
  useTrainingGraph,
  useActivityMatches,
  setDayCompletion,
  toggleCalibration,
  saveWorkoutSteps,
  applyIntensity,
  fetchJson,
  usePullRefresh,
  type PlanDay,
} from "../../lib/api";
import { TrainingSchedule } from "../../components/training-schedule";
import { projectDays } from "../../lib/project-days";
import { RaceHeader } from "../../components/race-header";
import { WhatIfSlider } from "../../components/whatif-slider";
import { TrainingPaces } from "../../components/training-paces";
import { RaceProtocol } from "../../components/race-protocol";
import { TrainingTrends } from "../../components/training-trends";
import { TrajectoryChart } from "../../components/trajectory-chart";
import { StepEditorSheet } from "../../components/step-editor-sheet";
import { ReferencePanel, type RefMetric } from "../../components/reference-panel";
import { PaceComputation } from "../../components/pace-computation";
import { hmSecondsFromVdot } from "banister";

/** VO2max trend (last year, chronological) from the shared stats endpoint. */
function useVo2Trend() {
  const [series, setSeries] = useState<number[]>([]);
  useEffect(() => {
    let alive = true;
    fetchJson<{ current?: { value: number | null }[] }>("/api/stats/vo2max?range=1y")
      .then((d) => {
        if (!alive) return;
        setSeries((d.current ?? []).map((p) => Number(p.value)).filter((v) => isFinite(v)));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return series;
}

/** Today (local), YYYY-MM-DD — training data is computed daily by the Garmin cron. */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TL_TONE: Record<string, "success" | "warm" | "danger" | "teal"> = {
  green: "success",
  amber: "warm",
  yellow: "warm",
  red: "danger",
};

/** TSB (form) runs roughly −30..+30; map to a 0..1 bar centred on 0. */
const tsbPct = (tsb: number) => Math.max(0, Math.min(1, (tsb + 30) / 60));

export default function TrainingScreen() {
  const { data, error, refetch } = useTraining(todayISO());
  const { cal, refetch: refetchCal } = useCalibration(todayISO());
  const { data: sim, refetch: refetchSim } = useForwardSim(todayISO());
  const { data: trajectory } = useTrajectory();
  const { nodes: graphNodes, edges: graphEdges, overrides: graphOverrides } = useTrainingGraph(todayISO());
  const { byDay: matches } = useActivityMatches();
  const { refreshing, onRefresh } = usePullRefresh(() => {
    refetch();
    refetchCal();
    refetchSim();
  });

  // Optimistic completion overrides so the checkbox flips instantly (the
  // forward-sim recompute is heavy — we don't refetch on every tap).
  const [doneOverride, setDoneOverride] = useState<Record<number, boolean>>({});
  const planDays: PlanDay[] = (sim?.planDays ?? []).map((d) =>
    d.id in doneOverride ? { ...d, completed: doneOverride[d.id] } : d,
  );
  async function onToggleComplete(day: PlanDay) {
    const next = !day.completed;
    setDoneOverride((m) => ({ ...m, [day.id]: next }));
    const ok = await setDayCompletion(day.id, next, day.actualDistanceKm);
    if (!ok) setDoneOverride((m) => ({ ...m, [day.id]: day.completed })); // revert on failure
  }
  // breakdown can return null pmc on days the daily cron hasn't filled; the
  // forward-sim always computes it, so fall back to that (same {ctl,atl,tsb} shape).
  const pmc = data?.pmc ?? sim?.pmc ?? null;
  const fit = data?.fitness;
  const readiness = data?.readiness;
  const vdot = fit?.vdot_adjusted ?? sim?.fitness?.vdotAdjusted ?? null;
  const [whatIfFactor, setWhatIfFactor] = useState(1.0);
  const [editDay, setEditDay] = useState<PlanDay | null>(null);
  // Re-run the forward simulation live as the what-if slider moves (no save).
  const projected = useMemo(() => projectDays(sim, whatIfFactor), [sim, whatIfFactor]);
  const vo2Trend = useVo2Trend();

  // External comparison signals (Garmin-side + PMC) with trend sparklines.
  const hms = (sec: number) => { const s = Math.round(sec); const h = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60), se = s % 60; return h > 0 ? `${h}:${String(mi).padStart(2, "0")}:${String(se).padStart(2, "0")}` : `${mi}:${String(se).padStart(2, "0")}`; };
  const refMetrics: RefMetric[] = useMemo(() => {
    const c = sim?.comparison;
    const nums = (arr: { [k: string]: number | string }[] | undefined, key: string) =>
      (arr ?? []).map((p) => Number(p[key])).filter((v) => isFinite(v) && v > 0);
    const last = (a: number[]) => (a.length ? a[a.length - 1] : 0);
    const m: RefMetric[] = [];
    const gv = nums(c?.fitness, "garminVo");
    if (gv.length) m.push({ label: "Garmin VO₂max", value: last(gv).toFixed(1), spark: gv, color: "#a9e4ec" });
    const gs = nums(c?.readiness, "garminScore");
    if (gs.length) m.push({ label: "Garmin readiness", value: String(Math.round(last(gs))), spark: gs, color: "#cbe896" });
    const ctl = nums(c?.load, "ctl");
    if (ctl.length) m.push({ label: "Fitness (CTL)", value: String(Math.round(last(ctl))), spark: ctl, color: "#77c8d1" });
    const atl = nums(c?.load, "atl");
    if (atl.length) m.push({ label: "Fatigue (ATL)", value: String(Math.round(last(atl))), spark: atl, color: "#e0a458" });
    // Web's External Comparison Signals (training-dashboard.tsx): race prediction, decoupling,
    // efficiency factor and weight trend, each with its fitness_trajectory sparkline (soma#786).
    const hist = data?.history ?? [];
    const series = (key: "efficiency_factor" | "decoupling_pct" | "race_prediction_seconds" | "weight_kg", days?: number) => {
      const rows = days ? hist.slice(-days) : hist;
      return rows.map((h) => Number(h[key])).filter((v) => isFinite(v) && v > 0);
    };
    // Web: the HM time from the current VDOT (Daniels), else the day's stored prediction; the
    // sparkline takes each day's stored seconds, else the estimate from that day's VDOT.
    const rpSpark = hist.map((h) => (h.race_prediction_seconds != null && Number(h.race_prediction_seconds) > 0 ? Number(h.race_prediction_seconds) : Number(h.vdot_adjusted) > 0 ? hmSecondsFromVdot(Number(h.vdot_adjusted)) : NaN)).filter((v) => isFinite(v) && v > 0);
    const rp = vdot != null && Number(vdot) > 0 ? hmSecondsFromVdot(Number(vdot)) : fit?.race_prediction_seconds != null ? Number(fit.race_prediction_seconds) : last(rpSpark);
    if (rp > 0) m.push({ label: "Race prediction", value: hms(rp), spark: rpSpark, color: "#6ad4a0", note: "HM from current VDOT" });
    const dec = (fit as { decoupling_pct?: number | null } | undefined)?.decoupling_pct;
    if (dec != null) {
      const dv = Number(dec);
      // Aerobic-decoupling thresholds (web parity): <3% tight, >5% high drift.
      const decColor = dv < 3 ? "#6ad4a0" : dv > 5 ? "#e06060" : "#e0a458";
      const decNote = dv < 3 ? "tight aerobic · <3% good" : dv > 5 ? "high drift · >5% caution" : "moderate drift";
      m.push({ label: "Decoupling", value: `${dv.toFixed(1)}%`, spark: series("decoupling_pct"), color: decColor, note: decNote });
    }
    const ef = fit?.efficiency_factor != null ? Number(fit.efficiency_factor) : last(series("efficiency_factor"));
    if (isFinite(ef) && (ef > 0 || series("efficiency_factor").length)) m.push({ label: "Efficiency factor", value: ef.toFixed(2), spark: series("efficiency_factor"), color: "#77c8d1", note: "speed / heart rate · rising = better economy" });
    const wkg = fit?.weight_kg != null ? Number(fit.weight_kg) : last(series("weight_kg", 14));
    if (wkg > 0) m.push({ label: "Weight trend", value: `${wkg.toFixed(1)} kg`, spark: series("weight_kg", 14), color: "#e0a458", note: "≈ 1:00–1:15 faster HM per kg of fat" });
    return m;
  }, [sim, fit, data, vdot]);

  async function onToggleWeighting(mode: "Adaptive" | "Equal") {
    const ok = await toggleCalibration(mode === "Equal");
    if (ok) refetchCal();
  }

  const tsb = pmc?.tsb ?? 0;
  const load = [
    { label: "Fitness (CTL)", value: pmc?.ctl, color: "#77c8d1", pct: (pmc?.ctl ?? 0) / 100 },
    { label: "Fatigue (ATL)", value: pmc?.atl, color: "#e0a458", pct: (pmc?.atl ?? 0) / 100 },
    { label: "Form (TSB)", value: pmc?.tsb, color: tsb >= 0 ? "#6ad4a0" : "#e06060", pct: tsbPct(tsb) },
  ];

  const zRows = [
    { label: "Resting HR", z: readiness?.rhr_z_score },
    { label: "HRV", z: readiness?.hrv_z_score },
    { label: "Sleep", z: readiness?.sleep_z_score },
    { label: "Body Battery", z: readiness?.body_battery_z_score },
  ].filter((r) => r.z != null);

  const fmt = (v: number | null | undefined, unit = "", dp = 1) =>
    v == null ? "—" : `${v.toFixed(dp)}${unit}`;

  return (
    <ScrollView
      className="flex-1 bg-base"
      contentContainerClassName="items-center px-5 py-6"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#77c8d1" colors={["#77c8d1"]} />}
    >
      <View className="w-full max-w-2xl gap-4">
        <View className="gap-2">
          <View className="flex-row items-center gap-2">
            <Text variant="headline">Training</Text>
            {readiness ? (
              <Badge
                label={`Readiness ${readiness.traffic_light}`}
                tone={TL_TONE[readiness.traffic_light] ?? "teal"}
              />
            ) : null}
          </View>
          <RaceHeader planDays={planDays} today={sim?.today ?? todayISO()} />
        </View>

        {error ? (
          <Card><Text variant="body" className="text-danger">API: {error} — is soma running on :3456?</Text></Card>
        ) : null}

        {/* No live plan is a first-class state (#698/#714). The athlete may train
            without a script and Garmin records every session either way, so
            load, readiness and fitness stay; only the schedule goes. Say why in
            plain words, and label what the projections assume instead. */}
        {sim?.engagement && !sim.engagement.planLive ? (
          <Card className="gap-1" testID="training-no-live-plan">
            <Text variant="eyebrow">Plan</Text>
            <Text variant="body" className="text-text" testID="training-no-live-plan-title">
              {sim.engagement.state === "dormant"
                ? "Plan is dormant"
                : sim.engagement.state === "partial"
                  ? "Plan exists, not being followed"
                  : "No training plan"}
            </Text>
            <Text variant="caption" className="text-text-secondary" testID="training-no-live-plan-basis">
              {sim.engagement.basis}.
            </Text>
            {sim.fallback ? (
              <Text variant="micro" testID="training-fallback-note">
                Everything below is from what you actually did. Projections assume {sim.fallback.label}: about {Math.round(sim.fallback.meanDailyLoad)} load/day.
              </Text>
            ) : null}
          </Card>
        ) : null}

        {/* Safety-rail overrides — hard readiness rules that force RED/YELLOW */}
        {graphOverrides.length ? (
          <View className="gap-2">
            {graphOverrides.map((o) => {
              const red = o.severity === "red";
              return (
                <View
                  key={o.rule}
                  className="flex-row items-start gap-2 rounded-lg border px-3 py-2.5"
                  style={{ backgroundColor: red ? "#3a1e24" : "#33291a", borderColor: red ? "#e06060" : "#e0a458" }}
                >
                  <Text variant="body" style={{ color: red ? "#f2868c" : "#e0a458" }}>{red ? "⛔" : "⚠️"}</Text>
                  <Text variant="caption" className="flex-1" style={{ color: red ? "#f2868c" : "#e0c458" }}>{o.message}</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        <Card className="gap-3">
          <Text variant="eyebrow">Training load (PMC)</Text>
          {load.map((l) => (
            <View key={l.label} className="gap-1">
              <View className="flex-row justify-between">
                <Text variant="caption" className="text-text-secondary">{l.label}</Text>
                <Text variant="caption" className="tabular-nums text-text">
                  {l.value == null ? "…" : l.value.toFixed(1)}
                </Text>
              </View>
              <ProgressBar pct={l.pct} color={l.color} />
            </View>
          ))}
          <Text variant="micro">
            {tsb >= 0 ? "Positive form — fresh and race-ready." : "Negative form — carrying fatigue."}
          </Text>
        </Card>

        {/* Training plan schedule — weeks → days → workout steps (Tier 1 parity) */}
        {planDays.length ? (
          <TrainingSchedule
            planDays={planDays}
            today={sim?.today ?? todayISO()}
            matches={matches}
            vdot={vdot}
            projected={projected}
            onToggleComplete={onToggleComplete}
            onEditSteps={setEditDay}
          />
        ) : null}

        {/* Web's per-step editor: edit a planned day's steps, save through the delta endpoint (soma#794) */}
        <StepEditorSheet day={editDay} onClose={() => setEditDay(null)} onSave={async (dayId, steps) => { const ok = await saveWorkoutSteps(dayId, steps); if (ok) refetchSim(); return ok; }} />

        {/* What-if intensity — preview scaling upcoming workouts + apply */}
        {planDays.length ? (
          <WhatIfSlider
            planDays={planDays}
            onPreview={setWhatIfFactor}
            onApply={async (factor, dayIds) => {
              const ok = await applyIntensity(factor, dayIds);
              if (ok) { setWhatIfFactor(1.0); refetchSim(); }
              return ok;
            }}
          />
        ) : null}

        <View className="flex-row gap-3">
          <Card className="flex-1 gap-1">
            <Text variant="eyebrow">VO2max</Text>
            <Text variant="headline" className="text-teal">{fmt(fit?.vo2max, "", 1)}</Text>
            <Text variant="micro">ml/kg/min</Text>
          </Card>
          <Card className="flex-1 gap-1">
            <Text variant="eyebrow">Drift</Text>
            <Text variant="headline" className="text-lime">{fmt(fit?.decoupling_pct, "%", 1)}</Text>
            <Text variant="micro">aerobic decoupling</Text>
          </Card>
          <Card className="flex-1 gap-1">
            <Text variant="eyebrow">Weight</Text>
            <Text variant="headline" className="text-warm">{fmt(fit?.weight_kg, "", 1)}</Text>
            <Text variant="micro">kg</Text>
          </Card>
        </View>

        {/* Training paces (VDOT → Daniels zones + A/B/C HM goals) */}
        <TrainingPaces vdot={vdot} />

        {/* Pace computation breakdown — mobile replacement for the web DAG */}
        <PaceComputation nodes={graphNodes} edges={graphEdges} sliderFactor={whatIfFactor} />

        {/* Fitness trajectory — the centerpiece: model vs Garmin across
            Fitness (VDOT) / Readiness / Load. Replaces the flat VO2 sparkline. */}
        <TrajectoryChart comparison={sim?.comparison ?? null} trajectory={trajectory} />

        {vo2Trend.length >= 2 ? (
          <Card className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text variant="eyebrow">VO2max trend</Text>
              <Text variant="micro" className="text-text-muted">last 12 months</Text>
            </View>
            <Sparkline data={vo2Trend} color="#77c8d1" height={44} baseline />
          </Card>
        ) : null}

        {/* Compact model-vs-Garmin comparison trends (Tier 2/3 adapted) */}
        <TrainingTrends comparison={sim?.comparison} />

        {/* External comparison signals (reference, with trend sparklines) */}
        <ReferencePanel metrics={refMetrics} />

        {readiness ? (
          <Card className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text variant="eyebrow">Readiness signals</Text>
              <Text variant="caption" className="tabular-nums text-text-muted">
                composite {fmt(readiness.composite_score, "", 2)}
              </Text>
            </View>
            {zRows.length ? (
              zRows.map((r) => (
                <View key={r.label} className="flex-row items-center justify-between border-b border-border-subtle py-2">
                  <Text variant="body" className="text-text-secondary">{r.label}</Text>
                  <Text
                    variant="body"
                    className={`tabular-nums ${(r.z ?? 0) >= 0 ? "text-success" : "text-warning"}`}
                  >
                    {(r.z ?? 0) >= 0 ? "+" : ""}{(r.z ?? 0).toFixed(2)} z
                  </Text>
                </View>
              ))
            ) : (
              <Text variant="micro">No baseline z-scores yet (needs ~14 days of history).</Text>
            )}
          </Card>
        ) : null}

        {cal ? (
          <Card className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text variant="eyebrow">Readiness weighting</Text>
              <Text variant="micro" className="tabular-nums">phase {cal.phase} · {cal.dataDays}d data</Text>
            </View>
            <SegmentedControl
              options={["Adaptive", "Equal"] as const}
              value={cal.forceEqual ? "Equal" : "Adaptive"}
              onChange={onToggleWeighting}
            />
            <View className="flex-row justify-between">
              {([
                ["HRV", cal.weights.hrv],
                ["Sleep", cal.weights.sleep],
                ["RHR", cal.weights.rhr],
                ["Body Batt", cal.weights.bb],
              ] as const).map(([label, w]) => (
                <View key={label} className="items-center gap-0.5">
                  <Text variant="micro" className="text-text-muted">{label}</Text>
                  <Text variant="caption" className="tabular-nums text-text">{Math.round(w * 100)}%</Text>
                </View>
              ))}
            </View>
            <Text variant="micro">
              {cal.forceEqual
                ? "Equal — each signal weighted 25%."
                : "Adaptive — weights learn from your history as data accrues."}
            </Text>
          </Card>
        ) : null}

        {/* Race day protocol */}
        <RaceProtocol />
      </View>
    </ScrollView>
  );
}
