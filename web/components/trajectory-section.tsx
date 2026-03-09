"use client";

import { useState, useMemo } from "react";
import { TrajectoryChart } from "@/components/trajectory-chart";
import { ExpandableChartCard } from "@/components/expandable-chart-card";
import { Target } from "lucide-react";

interface TrajectoryEntry {
  date: string;
  optimal: number;
  actual: number | null;
  ctl?: number | null;
  readiness?: number | null;
  weightEffect?: number | null;
}

interface TrajectorySectionProps {
  baseTrajectory: TrajectoryEntry[];
  raceDate: string;
  today: string;
  goalVdot: number;
  currentVdot: number;
  /** Slider controlled by parent (computation graph). Falls back to internal state when omitted. */
  sliderValue?: number;
  onSliderChange?: (value: number) => void;
  /** Shadow trajectory from delta simulation */
  shadowTrajectory?: TrajectoryEntry[] | null;
  /** Hover sync with computation graph */
  onHoverDate?: (date: string | null) => void;
}

export function TrajectorySection({
  baseTrajectory,
  raceDate,
  today,
  goalVdot,
  currentVdot,
  sliderValue,
  onSliderChange,
  shadowTrajectory,
  onHoverDate,
}: TrajectorySectionProps) {
  // Controlled / uncontrolled pattern: use internal state when parent doesn't provide slider
  const [internalSlider, setInternalSlider] = useState(1.0);
  const slider = sliderValue ?? internalSlider;
  const _onSliderChange = onSliderChange ?? setInternalSlider;
  // _onSliderChange kept for future parent wiring (Task 11)
  void _onSliderChange;

  // Recompute optimal curve based on slider
  const adjustedTrajectory = useMemo(() => {
    return baseTrajectory.map((entry) => {
      const baseGap = entry.optimal - currentVdot;
      const adjustedOptimal = currentVdot + baseGap * slider;
      return {
        ...entry,
        optimal: Number(adjustedOptimal.toFixed(1)),
      };
    });
  }, [baseTrajectory, slider, currentVdot]);

  // Build shadow data array for the chart when shadowTrajectory is provided
  const shadowData = useMemo(() => {
    if (!shadowTrajectory || shadowTrajectory.length === 0) return null;
    return shadowTrajectory.map((entry) => ({
      date: entry.date,
      shadow: Number(entry.optimal.toFixed(1)),
    }));
  }, [shadowTrajectory]);

  return (
    <ExpandableChartCard
      title="Training Trajectory"
      subtitle="Optimal vs Actual"
      icon={<Target className="h-4 w-4" style={{ color: "oklch(60% 0.2 300)" }} />}
    >
      <TrajectoryChart
        data={adjustedTrajectory}
        raceDate={raceDate}
        today={today}
        goalVdot={goalVdot}
        shadowData={shadowData}
        onHoverDate={onHoverDate}
      />
    </ExpandableChartCard>
  );
}
