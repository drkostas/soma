"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ComposedChart,
} from "recharts";

interface BodyCompData {
  profile: {
    currentWeight: number;
    currentBf: number;
    targetWeight: number;
    targetBf: number;
    targetDate: string;
    deficit: number;
    ffm: number;
    fatToLose: number;
    daysRemaining: number;
    requiredDeficit: number;
    onTrack: boolean;
    realisticDate: string;
  };
  weights: { date: string; weight: number; smoothed: number; bf: number }[];
  projection: { date: string; weight: number; bf: number }[];
}

export function BodyCompChart() {
  const [data, setData] = useState<BodyCompData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/nutrition/body-comp")
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center text-muted-foreground py-8 animate-pulse">Loading trajectory...</div>;
  if (!data) return <div className="text-center text-muted-foreground py-8">No data available</div>;

  const { profile, weights, projection } = data;

  // Merge weights and projection into one dataset for the chart
  // Only show weights from last 3 months
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const recentWeights = weights.filter(w => new Date(w.date) >= threeMonthsAgo);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartData: any[] = [];
  const dateSet = new Set<string>();

  for (const w of recentWeights) {
    dateSet.add(w.date);
    chartData.push({ date: w.date, actual: w.weight, smoothed: w.smoothed, bf: w.bf });
  }
  for (const p of projection) {
    if (dateSet.has(p.date)) {
      const existing = chartData.find(d => d.date === p.date);
      if (existing) { existing.projected = p.weight; existing.projBf = p.bf; }
    } else {
      chartData.push({ date: p.date, projected: p.weight, projBf: p.bf });
    }
  }
  chartData.sort((a, b) => a.date.localeCompare(b.date));

  // Format date for X axis
  const formatDate = (date: string) => {
    const d = new Date(date + "T12:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const statusColor = profile.onTrack ? "text-green-500" : "text-amber-500";
  const statusText = profile.onTrack
    ? `On track \u00b7 ${new Date(profile.targetDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : `Behind \u00b7 realistic: ${new Date(profile.realisticDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  return (
    <div className="space-y-4">
      {/* Status card */}
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold tabular-nums">{profile.currentWeight}kg</div>
              <div className="text-xs text-muted-foreground">&rarr; {profile.targetWeight}kg goal</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{profile.currentBf}%</div>
              <div className="text-xs text-muted-foreground">&rarr; {profile.targetBf}% BF</div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 mt-3 text-xs">
            <span className="text-muted-foreground">{profile.deficit} cal/day deficit</span>
            <span className="text-muted-foreground">&middot;</span>
            <span className="text-muted-foreground">{profile.fatToLose}kg to lose</span>
            <span className="text-muted-foreground">&middot;</span>
            <span className={`font-medium ${statusColor}`}>{statusText}</span>
          </div>
          {!profile.onTrack && (
            <div className="text-[10px] text-center text-amber-500 mt-1">
              Need {profile.requiredDeficit} cal/day deficit to hit {new Date(profile.targetDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Weight chart */}
      <Card>
        <CardContent className="py-4">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Weight Trajectory</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  interval="preserveStartEnd"
                  tickCount={6}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  domain={[Math.floor(profile.targetWeight - 2), Math.ceil(profile.currentWeight + 2)]}
                  tickCount={6}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  labelFormatter={formatDate}
                  formatter={(value: number, name: string) => {
                    const labels: Record<string, string> = {
                      actual: "Weigh-in",
                      smoothed: "Smoothed",
                      projected: "Projected",
                    };
                    return [`${value} kg`, labels[name] || name];
                  }}
                />
                <ReferenceLine y={profile.targetWeight} stroke="hsl(var(--primary))" strokeDasharray="5 5" opacity={0.5} label={{ value: `${profile.targetWeight}kg`, position: "right", fontSize: 10, fill: "hsl(var(--primary))" }} />
                <Line type="monotone" dataKey="actual" stroke="hsl(var(--primary))" dot={{ r: 2, fill: "hsl(var(--primary))" }} strokeWidth={0} connectNulls={false} />
                <Line type="monotone" dataKey="smoothed" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="projected" stroke="hsl(var(--primary))" strokeWidth={1.5} strokeDasharray="6 3" dot={false} connectNulls={false} opacity={0.5} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* BF% chart */}
      <Card>
        <CardContent className="py-4">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Body Fat % Trajectory</div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  interval="preserveStartEnd"
                  tickCount={6}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  domain={[Math.floor(profile.targetBf - 2), Math.ceil(profile.currentBf + 2)]}
                  tickCount={5}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  labelFormatter={formatDate}
                  formatter={(value: number, name: string) => {
                    const labels: Record<string, string> = {
                      bf: "Estimated BF%",
                      projBf: "Projected BF%",
                    };
                    return [`${value}%`, labels[name] || name];
                  }}
                />
                <ReferenceLine y={profile.targetBf} stroke="#f97316" strokeDasharray="5 5" opacity={0.5} label={{ value: `${profile.targetBf}%`, position: "right", fontSize: 10, fill: "#f97316" }} />
                <Line type="monotone" dataKey="bf" stroke="#f97316" strokeWidth={2} dot={{ r: 2, fill: "#f97316" }} connectNulls={false} />
                <Line type="monotone" dataKey="projBf" stroke="#f97316" strokeWidth={1.5} strokeDasharray="6 3" dot={false} connectNulls={false} opacity={0.5} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
