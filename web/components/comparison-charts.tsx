"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { estimateHMSeconds } from "@/lib/vdot-utils";

interface ComparisonData {
  load: { date: string; dailyLoad: number; ctl: number; atl: number }[];
  readiness: { date: string; garminScore: number; ourScore: number }[];
  fitness: { date: string; garminVo2max: number; ourVdot: number | null }[];
  racePrediction: { date: string; garminSeconds: number | null; ourVdot: number | null }[];
}

interface ComparisonChartsProps {
  data: ComparisonData;
  hoveredDate: string | null;
  onHoverDate: (date: string | null) => void;
}

export function ComparisonCharts({ data, hoveredDate, onHoverDate }: ComparisonChartsProps) {
  // Normalize z-score (-2..+2) to 0-100 scale to match Garmin readiness
  const readinessNormalized = data.readiness.map(r => ({
    ...r,
    ourScoreNorm: Math.round(50 + r.ourScore * 25), // z=0 → 50, z=2 → 100, z=-2 → 0
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <ChartCard
        title="Training Load"
        subtitle="CTL/ATL vs Garmin Load"
        data={data.load}
        ourKey="ctl"
        garminKey="atl"
        ourLabel="CTL (ours)"
        garminLabel="ATL"
        ourColor="oklch(0.65 0.15 250)"
        hoveredDate={hoveredDate}
        onHoverDate={onHoverDate}
      />
      <ChartCard
        title="Readiness"
        subtitle="Normalized (0-100) vs Garmin"
        data={readinessNormalized}
        ourKey="ourScoreNorm"
        garminKey="garminScore"
        ourLabel="Our readiness"
        garminLabel="Garmin readiness"
        ourColor="oklch(0.65 0.15 142)"
        hoveredDate={hoveredDate}
        onHoverDate={onHoverDate}
      />
      <ChartCard
        title="Fitness"
        subtitle="VDOT vs Garmin VO2max"
        data={data.fitness}
        ourKey="ourVdot"
        garminKey="garminVo2max"
        ourLabel="VDOT (ours)"
        garminLabel="Garmin VO2max"
        ourColor="oklch(0.65 0.15 50)"
        hoveredDate={hoveredDate}
        onHoverDate={onHoverDate}
      />
      <ChartCard
        title="Race Prediction"
        subtitle="Daniels vs Garmin HM prediction"
        data={data.racePrediction.map(r => ({
          ...r,
          ourSeconds: r.ourVdot ? estimateHMSeconds(r.ourVdot) : null,
        }))}
        ourKey="ourSeconds"
        garminKey="garminSeconds"
        ourLabel="Daniels prediction"
        garminLabel="Garmin prediction"
        ourColor="oklch(0.65 0.15 320)"
        hoveredDate={hoveredDate}
        onHoverDate={onHoverDate}
        invertY
      />
    </div>
  );
}

function ChartCard({ title, subtitle, data, ourKey, garminKey, ourLabel, garminLabel, ourColor, hoveredDate, onHoverDate, invertY }: {
  title: string;
  subtitle: string;
  data: any[];
  ourKey: string;
  garminKey: string;
  ourLabel: string;
  garminLabel: string;
  ourColor: string;
  hoveredDate: string | null;
  onHoverDate: (date: string | null) => void;
  invertY?: boolean;
}) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="pt-4 pb-2 px-4">
          <h4 className="text-sm font-medium">{title}</h4>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
          <div className="h-[160px] flex items-center justify-center text-xs text-muted-foreground">
            No data yet
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-2 px-4">
        <div className="mb-2">
          <h4 className="text-sm font-medium">{title}</h4>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data} onMouseMove={(e: any) => {
            if (e?.activeLabel) onHoverDate(e.activeLabel);
          }} onMouseLeave={() => onHoverDate(null)}>
            <XAxis dataKey="date" hide />
            <YAxis hide reversed={invertY} />
            <Tooltip
              contentStyle={{ backgroundColor: "oklch(0.15 0.01 250)", border: "1px solid oklch(0.3 0.01 250)", borderRadius: "6px", fontSize: "11px" }}
              labelStyle={{ color: "oklch(0.7 0 0)" }}
            />
            <Line type="monotone" dataKey={ourKey} stroke={ourColor} dot={false} strokeWidth={2} name={ourLabel} connectNulls />
            <Line type="monotone" dataKey={garminKey} stroke="oklch(0.5 0.02 250)" dot={false} strokeWidth={1.5} strokeDasharray="4 3" name={garminLabel} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

