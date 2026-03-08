"use client";

import { useState, useMemo } from "react";
import { DeltaSimulator } from "@/components/delta-simulator";
import { TrajectoryChart } from "@/components/trajectory-chart";
import { ExpandableChartCard } from "@/components/expandable-chart-card";
import { Target } from "lucide-react";

interface TrajectoryEntry {
  date: string;
  optimal: number;
  actual: number | null;
}

interface TrajectorySectionProps {
  baseTrajectory: TrajectoryEntry[];
  raceDate: string;
  today: string;
  goalVdot: number;
  currentVdot: number;
  basePace: number;
  optimalPace: number;
}

export function TrajectorySection({
  baseTrajectory, raceDate, today, goalVdot, currentVdot,
  basePace, optimalPace,
}: TrajectorySectionProps) {
  const [slider, setSlider] = useState(1.0);

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

  return (
    <div className="space-y-4">
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
        />
      </ExpandableChartCard>
      <DeltaSimulator
        basePace={basePace}
        optimalPace={optimalPace}
        currentVdot={currentVdot}
        goalVdot={goalVdot}
        slider={slider}
        onSliderChange={setSlider}
      />
    </div>
  );
}
