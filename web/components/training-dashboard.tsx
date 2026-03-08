"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { ComputationGraphView } from "@/components/computation-graph";
import { TrajectorySection } from "@/components/trajectory-section";
import { ReferencePanel, type ReferenceMetric } from "@/components/reference-panel";
import { TrainingPlanView, type ActivityMatch } from "@/components/training-plan-view";
import {
  type GraphApiResponse,
  type ComputationGraph,
  type DeltaWorkout,
  DEFAULT_BASE_PACE,
  getTooltip,
} from "@/lib/training-engine";

// ── Props ─────────────────────────────────────────────────────

interface TrainingDashboardProps {
  planDays: any[];
  today: string;
  raceInfo: { race_date: string; goal_time_seconds: number; plan_name: string } | null;
  trajectoryData: { date: string; optimal: number; actual: number | null }[];
  currentVdot: number;
  goalVdot: number;
  todayAdaptation: {
    action: string;
    adjustedType: string;
    adjustedKm: number;
    paceFactor: number;
    reason: string;
  } | null;
}

// ── Helpers ───────────────────────────────────────────────────

function findNode(graph: ComputationGraph, id: string) {
  return graph.nodes.find((n) => n.id === id);
}

/** Build reference metrics from graph data — the external signals not in the formula graph. */
function buildReferenceMetrics(graph: ComputationGraph): ReferenceMetric[] {
  const metrics: ReferenceMetric[] = [];

  const ctlNode = findNode(graph, "ctl");
  const atlNode = findNode(graph, "atl");
  const tsbNode = findNode(graph, "tsb");
  const vdotNode = findNode(graph, "vdot");

  if (ctlNode?.value != null) {
    metrics.push({
      id: "ctl",
      label: "Fitness (CTL)",
      value: ctlNode.value.toFixed(1),
      sparkline: [],
      color: ctlNode.color,
      tooltip: getTooltip("ctl").short,
    });
  }

  if (atlNode?.value != null) {
    metrics.push({
      id: "atl",
      label: "Fatigue (ATL)",
      value: atlNode.value.toFixed(1),
      sparkline: [],
      color: atlNode.color,
      tooltip: getTooltip("atl").short,
    });
  }

  if (tsbNode?.value != null) {
    metrics.push({
      id: "tsb",
      label: "Form (TSB)",
      value: tsbNode.value.toFixed(1),
      sparkline: [],
      color: tsbNode.color,
      tooltip: getTooltip("tsb").short,
    });
  }

  if (vdotNode?.value != null) {
    metrics.push({
      id: "vdot",
      label: "VDOT",
      value: vdotNode.value.toFixed(1),
      sparkline: [],
      color: vdotNode.color,
      tooltip: getTooltip("vdot").short,
    });
  }

  // Training Readiness (composite score from the readiness factor's inputs)
  const rfNode = findNode(graph, "readiness_factor");
  if (rfNode?.value != null) {
    const pctAdj = ((rfNode.value - 1.0) * 100).toFixed(1);
    metrics.push({
      id: "readiness_factor",
      label: "Readiness Factor",
      value: `${Number(pctAdj) >= 0 ? "+" : ""}${pctAdj}%`,
      sparkline: [],
      color: rfNode.color,
      tooltip: getTooltip("readiness_factor").short,
    });
  }

  const ffNode = findNode(graph, "fatigue_factor");
  if (ffNode?.value != null) {
    const pctAdj = ((ffNode.value - 1.0) * 100).toFixed(1);
    metrics.push({
      id: "fatigue_factor",
      label: "Fatigue Factor",
      value: `${Number(pctAdj) >= 0 ? "+" : ""}${pctAdj}%`,
      sparkline: [],
      color: ffNode.color,
      tooltip: getTooltip("fatigue_factor").short,
    });
  }

  return metrics;
}

/** Recompute shadow graph with a different slider value. */
function computeShadowGraph(
  baseGraph: ComputationGraph,
  sliderValue: number,
): ComputationGraph {
  // Find the base values we need from the graph
  const rfNode = findNode(baseGraph, "readiness_factor");
  const ffNode = findNode(baseGraph, "fatigue_factor");
  const wfNode = findNode(baseGraph, "weight_factor");

  const rf = rfNode?.value ?? 1.0;
  const ff = ffNode?.value ?? 1.0;
  const wf = wfNode?.value ?? 1.0;

  // Compute adjusted pace with new slider
  const combined = rf * ff * wf;
  const delta = combined - 1.0;
  const adjusted = 1.0 + delta * sliderValue;
  const newPace = DEFAULT_BASE_PACE * adjusted;

  // Clone graph and update slider + output nodes
  const nodes = baseGraph.nodes.map((n) => {
    if (n.id === "slider_factor") {
      return { ...n, value: sliderValue };
    }
    if (n.id === "adjusted_pace") {
      return {
        ...n,
        value: Math.round(newPace * 10) / 10,
        color: newPace > 0 ? "oklch(0.7 0.15 142)" : "oklch(0.6 0.2 25)",
      };
    }
    return n;
  });

  return { ...baseGraph, nodes, edges: baseGraph.edges, overrides: baseGraph.overrides };
}

// ── Component ─────────────────────────────────────────────────

export function TrainingDashboard({
  planDays,
  today,
  raceInfo,
  trajectoryData,
  currentVdot,
  goalVdot,
  todayAdaptation,
}: TrainingDashboardProps) {
  // Client-side state
  const [sliderValue, setSliderValue] = useState(1.0);
  const [graphData, setGraphData] = useState<GraphApiResponse | null>(null);
  const [activityMatches, setActivityMatches] = useState<ActivityMatch[]>([]);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch graph data and activity matches on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const [graphRes, matchRes] = await Promise.all([
          fetch(`/api/training/graph?date=${today}`),
          fetch("/api/training/activity-match"),
        ]);

        if (cancelled) return;

        if (graphRes.ok) {
          const data = await graphRes.json();
          setGraphData(data);
        }

        if (matchRes.ok) {
          const data = await matchRes.json();
          setActivityMatches(data);
        }
      } catch {
        // Silently handle errors — graceful degradation
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [today]);

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

    return futureDays
      .filter((d: any) => d.run_type !== "rest")
      .map((d: any) => {
        const origPace = DEFAULT_BASE_PACE * combined;
        const newPace = DEFAULT_BASE_PACE * (1.0 + delta * sliderValue);
        const distFactor = sliderValue > 1.0 ? 1.0 + (sliderValue - 1.0) * 0.3 : 1.0 - (1.0 - sliderValue) * 0.3;
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
        };
      });
  }, [sliderValue, graphData, planDays, today]);

  // Reference metrics from graph data
  const referenceMetrics = useMemo<ReferenceMetric[]>(() => {
    if (!graphData) return [];
    return buildReferenceMetrics(graphData.graph);
  }, [graphData]);

  const handleSliderChange = useCallback((value: number) => {
    setSliderValue(value);
  }, []);

  const handleHoverDate = useCallback((date: string | null) => {
    setHoveredDate(date);
  }, []);

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

  return (
    <div className="space-y-6">
      {/* Computation Graph — centerpiece */}
      {graphData && (
        <ComputationGraphView
          graph={graphData.graph}
          shadowGraph={shadowGraph}
          sliderValue={sliderValue}
          onSliderChange={handleSliderChange}
        />
      )}

      {/* Trajectory Chart — directly below, visually connected */}
      {raceInfo && trajectoryData.length > 0 && (
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
      )}

      {/* Reference Panel — external metrics cards */}
      {referenceMetrics.length > 0 && (
        <ReferencePanel metrics={referenceMetrics} />
      )}

      {/* Training Plan — full 5-week plan */}
      <TrainingPlanView
        days={planDays}
        today={today}
        todayAdaptation={todayAdaptation}
        activityMatches={activityMatches}
        deltaWorkouts={deltaWorkouts}
      />
    </div>
  );
}
