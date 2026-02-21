"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from "recharts";

interface FrequencyEntry {
  month: string;
  workouts: number;
}

export function WorkoutFrequencyChart({ data }: { data: FrequencyEntry[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[160px] text-muted-foreground text-sm">
        No data
      </div>
    );
  }

  const chartData = data.map((d) => ({
    month: d.month,
    workouts: Number(d.workouts),
  }));

  const max = Math.max(...chartData.map((d) => d.workouts));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={chartData}>
        <XAxis
          dataKey="month"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(m) => {
            const [year, month] = m.split("-");
            const mo = parseInt(month);
            const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            if (mo === 1) return `Jan '${year.slice(2)}`;
            return months[mo];
          }}
          interval={Math.max(0, Math.floor(chartData.length / 6))}
        />
        <YAxis hide />
        <Tooltip
          formatter={(value: any) => [`${value} workouts`, "Count"]}
          labelFormatter={(m) => {
            const [year, month] = m.split("-");
            const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            return `${months[parseInt(month)]} ${year}`;
          }}
          contentStyle={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            color: "var(--card-foreground)",
          }}
        />
        <Bar dataKey="workouts" radius={[3, 3, 0, 0]}>
          {chartData.map((entry, index) => (
            <Cell
              key={index}
              fill={
                entry.workouts === max
                  ? "var(--primary)"
                  : "color-mix(in oklch, var(--muted-foreground) 30%, transparent)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
