"use client";

import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface CadenceStrideEntry {
  date: string;
  cadence: number;
  stride: number;
}

export function CadenceStrideChart({
  data,
}: {
  data: CadenceStrideEntry[];
}) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
        No data
      </div>
    );
  }

  const spanDays = data.length > 1
    ? (new Date(data[data.length - 1].date).getTime() - new Date(data[0].date).getTime()) / 86400000
    : 0;
  const longRange = spanDays > 60;

  const tickDates = longRange ? (() => {
    const seen = new Set<string>();
    const unique = data
      .filter((d) => {
        const key = new Date(d.date).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((d) => d.date);
    if (unique.length > 8) {
      const step = Math.ceil(unique.length / 8);
      return unique.filter((_, i) => i % step === 0 || i === unique.length - 1);
    }
    return unique;
  })() : undefined;

  return (
    <ResponsiveContainer width="100%" height={250}>
      <ComposedChart data={data} margin={{ bottom: 10, left: 0, right: 10 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(v) => {
            const d = new Date(v);
            return longRange
              ? d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
              : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(0, Math.floor(data.length / 6)) })}
        />
        <YAxis
          yAxisId="cadence"
          className="text-[10px]"
          tickLine={false}
          domain={["dataMin - 5", "dataMax + 5"]}
        />
        <YAxis
          yAxisId="stride"
          orientation="right"
          className="text-[10px]"
          tickLine={false}
          domain={["dataMin - 5", "dataMax + 5"]}
          width={35}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div className="bg-card text-card-foreground border border-border rounded-lg p-2 text-xs shadow-lg">
                <div className="font-medium">
                  {new Date(d.date).toLocaleDateString()}
                </div>
                <div className="mt-1">Cadence: {d.cadence} spm</div>
                <div>Stride: {d.stride} cm</div>
              </div>
            );
          }}
        />
        <Bar
          yAxisId="cadence"
          dataKey="cadence"
          fill="var(--primary)"
          fillOpacity={0.3}
          radius={[2, 2, 0, 0]}
        />
        <Line
          yAxisId="stride"
          type="monotone"
          dataKey="stride"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
