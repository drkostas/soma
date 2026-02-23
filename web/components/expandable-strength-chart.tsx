"use client";

import { ExpandableChartCard } from "@/components/expandable-chart-card";
import { ConfigurableStrengthChart } from "@/components/configurable-strength-chart";
import { TrendingUp } from "lucide-react";

interface Props {
  data: any[];
  availableExercises: { exercise: string; count: number }[];
}

export function ExpandableStrengthChart({ data, availableExercises }: Props) {
  return (
    <ExpandableChartCard title="Strength Progression" icon={<TrendingUp className="h-4 w-4 text-green-400" />}>
      {({ expanded }) => (
        <ConfigurableStrengthChart
          data={data}
          availableExercises={availableExercises}
          expanded={expanded}
        />
      )}
    </ExpandableChartCard>
  );
}
