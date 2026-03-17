"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ComposedChart, Area,
} from "recharts";

interface BodyCompData {
  profile: {
    currentWeight: number;
    latestActualWeight: number;
    latestActualBf?: number;
    currentBf: number;
    targetWeight: number;
    targetBf: number;
    targetDate: string;
    deficit: number;
    ffm: number;
    fatToLose: number;
    weeklyRate: number;
    daysRemaining: number;
    requiredDeficit: number;
    onTrack: boolean;
    targetDatePassed: boolean;
    realisticDate: string;
  };
  weights: { date: string; weight: number; smoothed: number; bf: number }[];
  projection: { date: string; weight: number; bf: number }[];
  calPredicted: { date: string; weight: number; closed: boolean }[];
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

  const { profile, weights, projection, calPredicted } = data;

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
  for (const cp of calPredicted) {
    if (dateSet.has(cp.date)) {
      const existing = chartData.find((d: any) => d.date === cp.date);
      if (existing) { existing.calPredicted = cp.weight; existing.calPredictedClosed = cp.closed; }
    } else {
      chartData.push({ date: cp.date, calPredicted: cp.weight, calPredictedClosed: cp.closed });
      dateSet.add(cp.date);
    }
  }
  // Ensure projection connects to smoothed line: overlap first projection point with last actual
  if (recentWeights.length > 0 && projection.length > 0) {
    const lastActual = recentWeights[recentWeights.length - 1];
    const firstProj = projection[0];
    const overlap = chartData.find((d: any) => d.date === lastActual.date);
    if (overlap && firstProj) {
      overlap.projected = firstProj.weight;
      overlap.projBf = firstProj.bf;
    }
  }

  chartData.sort((a, b) => a.date.localeCompare(b.date));

  const showCalPredicted = (calPredicted?.length ?? 0) >= 7;

  // Format date for X axis
  const formatDate = (date: string) => {
    const d = new Date(date + "T12:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const fmtDate = (d: string) => {
    const s = String(d).slice(0, 10);
    return new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const statusColor = profile.targetDatePassed
    ? "text-rose-500"
    : profile.onTrack ? "text-green-500" : "text-amber-500";

  const statusText = profile.targetDatePassed
    ? "Target date passed \u2014 adjust goal"
    : profile.onTrack
      ? `On track \u00b7 ${fmtDate(profile.targetDate)} (${profile.daysRemaining}d)`
      : `Behind \u00b7 ${fmtDate(profile.realisticDate)} at current pace`;

  return (
    <div className="space-y-4">
      {/* Status card */}
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold tabular-nums">{profile.latestActualWeight}kg</div>
              <div className="text-[10px] text-muted-foreground">avg {profile.currentWeight}kg &middot; &rarr; {profile.targetWeight}kg</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{profile.latestActualBf || profile.currentBf}%</div>
              <div className="text-[10px] text-muted-foreground">&rarr; {profile.targetBf}% BF</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-3 text-xs">
            <span className="text-muted-foreground">{profile.deficit} kcal/day deficit</span>
            <span className="text-muted-foreground">&middot;</span>
            <span className="text-muted-foreground">{profile.fatToLose}kg to lose</span>
            <span className="text-muted-foreground">&middot;</span>
            <span className="text-muted-foreground">{profile.weeklyRate}kg/week</span>
            <span className="text-muted-foreground">&middot;</span>
            <span className={`font-medium ${statusColor}`}>{statusText}</span>
          </div>
          {profile.targetDatePassed && (
            <div className="text-[10px] text-center text-rose-500 mt-1">
              Consider extending your target date or adjusting your goal
            </div>
          )}
          {!profile.onTrack && !profile.targetDatePassed && (
            <div className="text-[10px] text-center text-amber-500 mt-1">
              Need {profile.requiredDeficit} kcal/day deficit to hit {fmtDate(profile.targetDate)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Weight chart */}
      <Card>
        <CardContent className="py-4">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Weight Trajectory</div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-2">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#3b82f6]" />actual</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-[#3b82f6]" />smoothed</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-[#3b82f6] opacity-50" style={{borderTop: "2px dashed #3b82f6"}} />projected</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5" style={{borderTop: "2px dashed #22c55e"}} />target</span>
            {showCalPredicted && <span className="flex items-center gap-1"><span className="w-4 h-0.5" style={{borderTop: "2px dashed #06b6d4"}} />from cal</span>}
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" opacity={0.3} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  tick={{ fontSize: 12, fill: "rgba(255,255,255,0.6)" }}
                  interval={Math.max(1, Math.floor(chartData.length / 6))}
                  angle={0}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "rgba(255,255,255,0.6)" }}
                  domain={[Math.floor(profile.targetWeight - 2), Math.ceil(profile.currentWeight + 2)]}
                  tickCount={6}
                  tickFormatter={(v: number) => `${v}kg`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(10,10,12,0.95)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  labelFormatter={(label: any) => formatDate(String(label))}
                  formatter={(value: any, name: any) => {
                    const labels: Record<string, string> = {
                      actual: "Weigh-in",
                      smoothed: "Smoothed",
                      projected: "Projected",
                      calPredicted: "From calories",
                    };
                    return [`${value} kg`, labels[name] || name];
                  }}
                />
                <ReferenceLine y={profile.targetWeight} stroke="#22c55e" strokeDasharray="5 5" opacity={0.5} label={{ value: `${profile.targetWeight}kg`, position: "right", fontSize: 10, fill: "#22c55e" }} />
                <Area type="monotone" dataKey="projected" stroke="none" fill="#3b82f6" fillOpacity={0.03} connectNulls={false} tooltipType="none" />
                <Line type="monotone" dataKey="actual" stroke="#3b82f6" dot={{ r: 3, fill: "#3b82f6" }} strokeWidth={0} connectNulls={false} />
                <Line type="monotone" dataKey="smoothed" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls={true} />
                <Line type="monotone" dataKey="projected" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="6 3" dot={false} connectNulls={true} opacity={0.6} />
                {showCalPredicted && <Line type="monotone" dataKey="calPredicted" stroke="#06b6d4" strokeWidth={1.5} strokeDasharray="4 4" dot={(props: any) => {
                  const { cx, cy, payload } = props;
                  if (payload.calPredicted == null) return <></>;
                  if (!payload.calPredictedClosed) {
                    return <circle cx={cx} cy={cy} r={3} fill="none" stroke="#06b6d4" strokeWidth={1.5} strokeDasharray="2 2" />;
                  }
                  return <circle cx={cx} cy={cy} r={2} fill="#06b6d4" />;
                }} connectNulls={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* BF% chart */}
      <Card>
        <CardContent className="py-4">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Body Fat % Trajectory</div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-2">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#f97316]" />actual</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-[#f97316] opacity-50" style={{borderTop: "2px dashed #f97316"}} />projected</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5" style={{borderTop: "2px dashed #22c55e"}} />target</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" opacity={0.3} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  tick={{ fontSize: 12, fill: "rgba(255,255,255,0.6)" }}
                  interval={Math.max(1, Math.floor(chartData.length / 6))}
                  angle={0}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "rgba(255,255,255,0.6)" }}
                  domain={[Math.floor(profile.targetBf - 2), Math.ceil(profile.currentBf + 2)]}
                  tickCount={5}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(10,10,12,0.95)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  labelFormatter={(label: any) => formatDate(String(label))}
                  formatter={(value: any, name: any) => {
                    const labels: Record<string, string> = {
                      bf: "Estimated BF%",
                      projBf: "Projected BF%",
                    };
                    return [`${value}%`, labels[name] || name];
                  }}
                />
                <ReferenceLine y={profile.targetBf} stroke="#22c55e" strokeDasharray="5 5" opacity={0.5} label={{ value: `${profile.targetBf}%`, position: "right", fontSize: 10, fill: "#22c55e" }} />
                <Line type="monotone" dataKey="bf" stroke="#f97316" strokeWidth={2} dot={{ r: 3, fill: "#f97316" }} connectNulls={true} />
                <Line type="monotone" dataKey="projBf" stroke="#f97316" strokeWidth={1.5} strokeDasharray="6 3" dot={false} connectNulls={true} opacity={0.5} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
