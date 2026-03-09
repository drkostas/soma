"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Loader2, Save, Check, X, AlertTriangle, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ComputationGraphView } from "@/components/computation-graph";
import { TrajectorySection } from "@/components/trajectory-section";
import { ReferencePanel, type ReferenceMetric } from "@/components/reference-panel";
import { TrainingPlanView, type ActivityMatch } from "@/components/training-plan-view";
import { ModelParamsPanel } from "@/components/model-params-panel";
import { TrainingPacesCard } from "@/components/training-paces-card";
import { ComparisonCharts } from "@/components/comparison-charts";
import {
  type GraphApiResponse,
  type ComputationGraph,
  type DeltaWorkout,
  type Override,
  DEFAULT_BASE_PACE,
  recomputeGraphForSlider,
  adjustStepTargets,
} from "@/lib/training-engine";
import { normalizeSteps } from "@/lib/normalize-steps";
import { runForwardSimulation, type ProjectedDay, type SimulationSeeds, type ComparisonData } from "@/lib/forward-simulation";

// ── Types ─────────────────────────────────────────────────────

export interface ReferenceData {
  readinessHistory: {
    date: string;
    composite_score: number | null;
    garmin_readiness_score: number | null;
  }[];
  fitnessHistory: {
    date: string;
    efficiency_factor: number | null;
    decoupling_pct: number | null;
    race_prediction_seconds: number | null;
    vdot_adjusted: number | null;
  }[];
  weightHistory: {
    date: string;
    weight_kg: number | null;
  }[];
}

interface TrainingDashboardProps {
  planDays: any[];
  today: string;
  raceInfo: { race_date: string; goal_time_seconds: number; plan_name: string } | null;
  trajectoryData: { date: string; optimal: number; actual: number | null; projectedVdot?: number | null; ctl: number | null; readiness: number | null; weightEffect: number | null }[];
  currentVdot: number;
  goalVdot: number;
  referenceData: ReferenceData;
}

// ── Helpers ───────────────────────────────────────────────────

function findNode(graph: ComputationGraph, id: string) {
  return graph.nodes.find((n) => n.id === id);
}

/** Format race prediction seconds into H:MM:SS or M:SS display. */
function formatRaceTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Estimate half-marathon time from VDOT using Daniels/Gilbert equations (client-side fallback). */
function estimateHMSeconds(vdot: number): number {
  const HM_M = 21097.5;
  // Binary search: vdot_from_race(HM_M, t) == vdot
  let lo = 60, hi = 86400;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const tMin = mid / 60;
    const vel = HM_M / tMin;
    const vo2 = -4.60 + 0.182258 * vel + 0.000104 * vel * vel;
    const frac = 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
    const computed = vo2 / frac;
    if (computed > vdot) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

/** Build reference metrics from separately-queried external data — signals NOT in the formula graph. */
function buildReferenceMetrics(
  referenceData: ReferenceData,
): ReferenceMetric[] {
  const { readinessHistory, fitnessHistory, weightHistory } = referenceData;

  const latestReadiness = readinessHistory.at(-1);
  const latestFitness = fitnessHistory.at(-1);
  const latestWeight = weightHistory.at(-1);

  // Build race prediction sparkline: use DB values when available, fall back to
  // VDOT-derived estimates so sparklines are never empty when VDOT data exists.
  const racePredSparkline: number[] = [];
  for (const d of fitnessHistory) {
    if (d.race_prediction_seconds != null) {
      racePredSparkline.push(Number(d.race_prediction_seconds));
    } else if (d.vdot_adjusted != null && Number(d.vdot_adjusted) > 0) {
      racePredSparkline.push(estimateHMSeconds(Number(d.vdot_adjusted)));
    }
  }

  // Determine latest race prediction value
  let latestRacePrediction: string = "\u2014";
  if (latestFitness?.race_prediction_seconds != null) {
    latestRacePrediction = formatRaceTime(Number(latestFitness.race_prediction_seconds));
  } else if (latestFitness?.vdot_adjusted != null && Number(latestFitness.vdot_adjusted) > 0) {
    latestRacePrediction = formatRaceTime(estimateHMSeconds(Number(latestFitness.vdot_adjusted)));
  }

  return [
    {
      id: "garmin-readiness",
      label: "Garmin Training Readiness",
      value: latestReadiness?.garmin_readiness_score != null
        ? String(Math.round(Number(latestReadiness.garmin_readiness_score)))
        : "\u2014",
      sparkline: readinessHistory
        .filter((r) => r.garmin_readiness_score != null)
        .map((r) => Number(r.garmin_readiness_score)),
      color: "oklch(65% 0.15 250)",
      tooltip:
        "Garmin\u2019s composite readiness score. Compare with our model\u2019s composite to see if they agree.",
      comparison: {
        ours: latestReadiness?.composite_score != null
          ? Number(latestReadiness.composite_score).toFixed(1)
          : "\u2014",
        garmin: latestReadiness?.garmin_readiness_score != null
          ? String(Math.round(Number(latestReadiness.garmin_readiness_score)))
          : "\u2014",
      },
    },
    {
      id: "race-prediction",
      label: "Race Prediction",
      value: latestRacePrediction,
      sparkline: racePredSparkline,
      color: "oklch(65% 0.15 160)",
      tooltip:
        "Predicted half-marathon time from current VDOT. Based on Daniels/Gilbert VO2 model.",
    },
    {
      id: "decoupling",
      label: "Pace:HR Decoupling",
      value: latestFitness?.decoupling_pct != null
        ? `${Number(latestFitness.decoupling_pct).toFixed(1)}%`
        : "\u2014",
      sparkline: fitnessHistory
        .filter((d) => d.decoupling_pct != null)
        .map((d) => Number(d.decoupling_pct)),
      color: "oklch(65% 0.15 142)",
      tooltip:
        "How much heart rate drifts up during steady runs. <3% = aerobically ready. >5% = not ready for that pace over race distance.",
      thresholds: [
        { label: "<3% good", color: "oklch(65% 0.15 142)" },
        { label: ">5% caution", color: "oklch(65% 0.15 50)" },
      ],
    },
    {
      id: "ef-trend",
      label: "Efficiency Factor",
      value: latestFitness?.efficiency_factor != null
        ? Number(latestFitness.efficiency_factor).toFixed(2)
        : "\u2014",
      sparkline: fitnessHistory
        .filter((d) => d.efficiency_factor != null)
        .map((d) => Number(d.efficiency_factor)),
      color: "oklch(65% 0.15 200)",
      tooltip:
        "Speed / heart rate. Rising = improving running economy. Measures how fast you go per heartbeat.",
    },
    {
      id: "weight-trend",
      label: "Weight Trend",
      value: latestWeight?.weight_kg != null
        ? `${Number(latestWeight.weight_kg).toFixed(1)} kg`
        : "\u2014",
      sparkline: weightHistory
        .filter((w) => w.weight_kg != null)
        .map((w) => Number(w.weight_kg)),
      color: "oklch(65% 0.12 50)",
      tooltip:
        "Recent weight from fitness trajectory. Every 1 kg of fat loss \u2248 1:00\u20131:15 faster HM at your fitness level.",
    },
  ];
}

/** Recompute shadow graph with a different slider value — full forward-pass through all nodes. */
function computeShadowGraph(
  baseGraph: ComputationGraph,
  sliderValue: number,
): ComputationGraph {
  return recomputeGraphForSlider(baseGraph, sliderValue);
}

// ── Component ─────────────────────────────────────────────────

export function TrainingDashboard({
  planDays,
  today,
  raceInfo,
  trajectoryData,
  currentVdot,
  goalVdot,
  referenceData,
}: TrainingDashboardProps) {
  // Client-side state
  const [sliderValue, setSliderValue] = useState(1.0);
  const [graphData, setGraphData] = useState<GraphApiResponse | null>(null);
  const [activityMatches, setActivityMatches] = useState<ActivityMatch[]>([]);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [hoveredGraph, setHoveredGraph] = useState<ComputationGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<"idle" | "success" | "error">("idle");

  // Forward simulation state
  const [forwardSim, setForwardSim] = useState<ProjectedDay[] | null>(null);
  const [forwardSimSeeds, setForwardSimSeeds] = useState<SimulationSeeds | null>(null);

  // Edited workout steps (dayId -> modified steps) from inline editing
  const [editedSteps, setEditedSteps] = useState<Map<number, any[]>>(new Map());

  // Cache of fetched graph data per date (avoids re-fetching on re-hover)
  const graphCacheRef = useRef<Map<string, ComputationGraph>>(new Map());
  const hoverFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeFetchRef = useRef<AbortController | null>(null);

  const isDirty = sliderValue !== 1.0 || editedSteps.size > 0;

  // Refetchable data loader — used on mount and after save
  const refetchData = useCallback(async () => {
    const [graphRes, matchRes, simRes] = await Promise.all([
      fetch(`/api/training/graph?date=${today}`),
      fetch("/api/training/activity-match"),
      fetch("/api/training/forward-sim"),
    ]);
    if (graphRes.ok) setGraphData(await graphRes.json());
    if (matchRes.ok) setActivityMatches(await matchRes.json());
    if (simRes.ok) {
      const simData: SimulationSeeds = await simRes.json();
      setForwardSimSeeds(simData);
      const projected = runForwardSimulation({
        ...simData,
        sliderMultiplier: sliderValue,
      });
      setForwardSim(projected);
    }
  }, [today, sliderValue]);

  // Fetch graph data and activity matches on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        await refetchData();
      } catch {
        // Silently handle errors — graceful degradation
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [refetchData]);

  // Cleanup hover fetch timer and abort controller on unmount
  useEffect(() => {
    return () => {
      if (hoverFetchTimerRef.current) clearTimeout(hoverFetchTimerRef.current);
      if (activeFetchRef.current) activeFetchRef.current.abort();
    };
  }, []);

  // Re-run forward simulation when slider changes (no API call needed)
  useEffect(() => {
    if (!forwardSimSeeds) return;
    const projected = runForwardSimulation({
      ...forwardSimSeeds,
      sliderMultiplier: sliderValue,
    });
    setForwardSim(projected);
  }, [sliderValue, forwardSimSeeds]);

  // Shadow graph recomputed when slider changes
  const shadowGraph = useMemo<ComputationGraph | null>(() => {
    if (!graphData || sliderValue === 1.0) return null;
    return computeShadowGraph(graphData.graph, sliderValue);
  }, [graphData, sliderValue]);

  // Shadow trajectory for delta simulation
  const shadowTrajectory = useMemo(() => {
    if (sliderValue === 1.0 || !trajectoryData.length) return null;
    // Scale the optimal curve by the slider's effect on progression rate
    return trajectoryData.map((entry) => {
      const baseGap = entry.optimal - currentVdot;
      const scaledGap = baseGap * sliderValue;
      return {
        date: entry.date,
        optimal: currentVdot + scaledGap,
        actual: entry.actual,
      };
    });
  }, [trajectoryData, sliderValue, currentVdot]);

  // Delta workouts computed from slider
  const deltaWorkouts = useMemo<DeltaWorkout[]>(() => {
    if (sliderValue === 1.0 || !graphData) return [];
    const rfNode = findNode(graphData.graph, "readiness_factor");
    const ffNode = findNode(graphData.graph, "fatigue_factor");
    const wfNode = findNode(graphData.graph, "weight_factor");
    const rf = rfNode?.value ?? 1.0;
    const ff = ffNode?.value ?? 1.0;
    const wf = wfNode?.value ?? 1.0;
    const combined = rf * ff * wf;
    const delta = combined - 1.0;

    const todayIdx = planDays.findIndex((d: any) => d.day_date >= today);
    const futureDays = todayIdx >= 0 ? planDays.slice(todayIdx) : [];

    const origPace = DEFAULT_BASE_PACE * combined;
    const newPace = DEFAULT_BASE_PACE * (1.0 + delta * sliderValue);

    return futureDays
      .filter((d: any) => d.run_type !== "rest")
      .map((d: any) => {
        const distFactor = sliderValue > 1.0 ? 1.0 + (sliderValue - 1.0) * 0.3 : 1.0 - (1.0 - sliderValue) * 0.3;

        // Adjust per-step targets (pace/HR) using the day-level pace ratio
        let adjustedSteps: import("@/lib/normalize-steps").NormalizedStep[] | undefined;
        if (d.workout_steps && Array.isArray(d.workout_steps) && d.workout_steps.length > 0) {
          const baseSteps = normalizeSteps(d.workout_steps);
          adjustedSteps = adjustStepTargets(baseSteps, sliderValue, newPace, origPace);
        }

        return {
          dayId: d.id,
          dayDate: d.day_date,
          originalPace: Math.round(origPace * 10) / 10,
          newPace: Math.round(newPace * 10) / 10,
          originalDistance: d.target_distance_km,
          newDistance: Math.round(d.target_distance_km * distFactor * 10) / 10,
          originalType: d.run_type,
          newType: d.run_type,
          changed: sliderValue !== 1.0,
          adjustedSteps,
        };
      });
  }, [sliderValue, graphData, planDays, today]);

  // Reference metrics from server-queried external data
  const referenceMetrics = useMemo<ReferenceMetric[]>(() => {
    return buildReferenceMetrics(referenceData);
  }, [referenceData]);

  // Dynamic VDOT: prefer graph node value, fall back to server-provided currentVdot prop
  const dynamicVdot = useMemo(() => {
    if (graphData) {
      const vdotNode = findNode(graphData.graph, "vdot");
      if (vdotNode?.value != null && vdotNode.value > 0) return vdotNode.value;
    }
    return currentVdot;
  }, [graphData, currentVdot]);

  const handleSliderChange = useCallback((value: number) => {
    setSliderValue(value);
  }, []);

  const handleHoverDate = useCallback((date: string | null) => {
    setHoveredDate(date);

    // Clear any pending debounced fetch
    if (hoverFetchTimerRef.current) {
      clearTimeout(hoverFetchTimerRef.current);
      hoverFetchTimerRef.current = null;
    }

    // If hover leaves or date is today, clear hovered graph
    if (!date || date === today) {
      if (activeFetchRef.current) {
        activeFetchRef.current.abort();
        activeFetchRef.current = null;
      }
      setHoveredGraph(null);
      return;
    }

    // Check cache first
    const cached = graphCacheRef.current.get(date);
    if (cached) {
      setHoveredGraph(cached);
      return;
    }

    // Debounced fetch (150ms) to avoid flooding the API on quick sweeps
    hoverFetchTimerRef.current = setTimeout(async () => {
      // Abort any in-flight fetch
      if (activeFetchRef.current) {
        activeFetchRef.current.abort();
      }
      const controller = new AbortController();
      activeFetchRef.current = controller;

      try {
        const res = await fetch(`/api/training/graph?date=${date}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data: GraphApiResponse = await res.json();
          graphCacheRef.current.set(date, data.graph);
          setHoveredGraph(data.graph);
        }
      } catch {
        // Aborted or network error — silently ignore
      } finally {
        if (activeFetchRef.current === controller) {
          activeFetchRef.current = null;
        }
      }
    }, 150);
  }, [today]);

  const handleSave = useCallback(async () => {
    if (deltaWorkouts.length === 0 && editedSteps.size === 0) return;
    setSaving(true);
    setSaveResult("idle");

    try {
      // Merge delta workouts + edited steps into a single payload
      const workoutMap = new Map<number, { dayId: number; newDistance?: number; newType?: string; workoutSteps?: any }>();

      // Add slider-derived delta workouts
      for (const w of deltaWorkouts) {
        workoutMap.set(w.dayId, {
          dayId: w.dayId,
          newDistance: w.newDistance,
          newType: w.newType,
        });
      }

      // Overlay edited steps
      for (const [dayId, steps] of editedSteps) {
        const existing = workoutMap.get(dayId) || { dayId };
        workoutMap.set(dayId, { ...existing, workoutSteps: steps });
      }

      const res = await fetch("/api/training/delta/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sliderFactor: sliderValue,
          updatedWorkouts: Array.from(workoutMap.values()),
        }),
      });

      if (res.ok) {
        setSaveResult("success");
        // Reset slider and edited steps after brief success display
        setTimeout(() => {
          setSliderValue(1.0);
          setEditedSteps(new Map());
          setSaveResult("idle");
          refetchData();
        }, 1500);
      } else {
        setSaveResult("error");
        setTimeout(() => setSaveResult("idle"), 3000);
      }
    } catch {
      setSaveResult("error");
      setTimeout(() => setSaveResult("idle"), 3000);
    } finally {
      setSaving(false);
    }
  }, [deltaWorkouts, sliderValue, editedSteps, refetchData]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading training intelligence...</p>
        </div>
      </div>
    );
  }

  // Extract active overrides for hoisted alerts
  const activeOverrides: Override[] = graphData
    ? graphData.graph.overrides.filter((o) => o.triggered)
    : [];

  return (
    <div className="space-y-6">
      {/* Hoisted override alerts — always visible at top */}
      {activeOverrides.map((ov) => (
        <div
          key={ov.rule}
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
          style={{
            backgroundColor:
              ov.severity === "red"
                ? "oklch(30% 0.08 25 / 0.3)"
                : "oklch(40% 0.1 85 / 0.25)",
            borderColor:
              ov.severity === "red"
                ? "oklch(55% 0.2 25 / 0.5)"
                : "oklch(70% 0.15 85 / 0.5)",
            color:
              ov.severity === "red"
                ? "oklch(80% 0.12 25)"
                : "oklch(85% 0.12 85)",
          }}
        >
          {ov.severity === "red" ? (
            <ShieldAlert className="h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          <span>{ov.message}</span>
        </div>
      ))}

      {/* Computation & Output — single visual unit */}
      <Card className="p-0 overflow-hidden">
        {graphData && (
          <div className="p-4 pb-2">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Model Computation</h3>
            <ComputationGraphView
              graph={hoveredDate && hoveredGraph ? hoveredGraph : graphData.graph}
              shadowGraph={shadowGraph}
              sliderValue={sliderValue}
              onSliderChange={handleSliderChange}
              hoveredDate={hoveredDate}
              hideOverrides
            />
          </div>
        )}

        {/* Model Parameters — identity, Banister params, calibration state */}
        <div className="border-t border-border/50 px-4 py-3">
          <ModelParamsPanel />
        </div>

        {raceInfo && trajectoryData.length > 0 && (
          <div className="border-t border-border/50 p-4 pt-2">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Output: Fitness Trajectory</h3>
            <TrajectorySection
              baseTrajectory={trajectoryData}
              raceDate={raceInfo.race_date}
              today={today}
              goalVdot={goalVdot}
              currentVdot={currentVdot}
              sliderValue={sliderValue}
              onSliderChange={handleSliderChange}
              shadowTrajectory={shadowTrajectory}
              onHoverDate={handleHoverDate}
            />
          </div>
        )}
      </Card>

      {/* Reference Panel + Training Paces — side by side on wide screens */}
      {referenceMetrics.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4">
          <ReferencePanel metrics={referenceMetrics} />
          <TrainingPacesCard vdot={dynamicVdot} />
        </div>
      ) : (
        <TrainingPacesCard vdot={dynamicVdot} />
      )}

      {/* Comparison Charts — our metrics vs Garmin */}
      {forwardSimSeeds?.comparison && (
        <>
          <h3 className="text-sm font-medium text-muted-foreground">Model vs Garmin</h3>
          <ComparisonCharts
            data={forwardSimSeeds.comparison}
            hoveredDate={hoveredDate}
            onHoverDate={handleHoverDate}
          />
        </>
      )}

      {/* Training Plan — full 5-week plan */}
      <h3 className="text-sm font-medium text-muted-foreground">Training Plan</h3>
      <TrainingPlanView
        days={planDays}
        today={today}
        activityMatches={activityMatches}
        deltaWorkouts={deltaWorkouts}
        onStepsEdited={setEditedSteps}
        projectedDays={forwardSim}
      />

      {/* Delta save button */}
      {isDirty && (
        <div className="sticky bottom-4 flex justify-center z-40">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all disabled:opacity-60"
          >
            {saving ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
            ) : saveResult === "success" ? (
              <><Check className="h-4 w-4" /> Saved!</>
            ) : saveResult === "error" ? (
              <><X className="h-4 w-4" /> Error — try again</>
            ) : (
              <><Save className="h-4 w-4" /> Apply Changes ({deltaWorkouts.length + editedSteps.size} workouts)</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
