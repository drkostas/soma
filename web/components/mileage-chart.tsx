"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface MileageEntry {
  month: string;
  km: number;
  runs: number;
}

export function MileageChart({ data }: { data: MileageEntry[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
        No data
      </div>
    );
  }

  const chartData = data.map((d) => ({
    month: d.month,
    km: Number(Number(d.km).toFixed(1)),
    runs: Number(d.runs),
  }));

  const max = Math.max(...chartData.map((d) => d.km));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData}>
        <XAxis
          dataKey="month"
          className="text-xs"
          tickFormatter={(m) => {
            const [, month] = m.split("-");
            const months = [
              "",
              "Jan",
              "Feb",
              "Mar",
              "Apr",
              "May",
              "Jun",
              "Jul",
              "Aug",
              "Sep",
              "Oct",
              "Nov",
              "Dec",
            ];
            return months[parseInt(month)] || m;
          }}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          className="text-xs"
          tickFormatter={(v) => `${v}km`}
          tick={{ fontSize: 11 }}
        />
        <Tooltip
          formatter={(value: any, name: any) => {
            if (name === "km") return [`${value} km`, "Distance"];
            return [value, name];
          }}
          labelFormatter={(m) => {
            const [year, month] = m.split("-");
            const months = [
              "",
              "Jan",
              "Feb",
              "Mar",
              "Apr",
              "May",
              "Jun",
              "Jul",
              "Aug",
              "Sep",
              "Oct",
              "Nov",
              "Dec",
            ];
            return `${months[parseInt(month)]} ${year}`;
          }}
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            color: "hsl(var(--card-foreground))",
          }}
        />
        <Bar dataKey="km" radius={[4, 4, 0, 0]}>
          {chartData.map((entry, index) => (
            <Cell
              key={index}
              fill={
                entry.km === max
                  ? "hsl(var(--primary))"
                  : "hsl(var(--muted-foreground) / 0.3)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
