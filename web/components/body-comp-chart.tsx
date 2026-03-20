"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ComposedChart, Area, Bar, Cell,
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
    trendTargetDate: string | null;
    trendSlope: number;
    avgActualDeficit: number;
    closedDeficitDays: number;
    totalActualDeficit: number;
  };
  weights: { date: string; weight: number; smoothed: number; bf: number; smoothedBf: number }[];
  goalLine: { date: string; weight: number; bf: number }[];
  trendPrediction: { date: string; weight: number; bf: number }[];
  calPredicted: { date: string; weight: number; closed: boolean }[];
  dailyDeficits: {
    date: string; bmr: number; dailyActivity: number; runCal: number; runDistKm: number;
    gymCal: number; gymTitle: string; totalBurn: number; consumed: number;
    deficit: number; cumulative: number; goalPace: number; closed: boolean; isToday: boolean;
  }[];
  goalDeficit: number;
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

  const { profile, weights, goalLine, trendPrediction, calPredicted, dailyDeficits, goalDeficit } = data;

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
    chartData.push({ date: w.date, actual: w.weight, smoothed: w.smoothed, bf: w.bf, smoothedBf: w.smoothedBf });
  }
  // Goal line: straight from first weigh-in to target
  for (const g of (goalLine || [])) {
    const existing = chartData.find((d: any) => d.date === g.date);
    if (existing) { existing.goalWeight = g.weight; existing.goalBf = g.bf; }
    else { chartData.push({ date: g.date, goalWeight: g.weight, goalBf: g.bf }); dateSet.add(g.date); }
  }
  // Trend prediction: regression from last data point
  for (const tp of (trendPrediction || [])) {
    const existing = chartData.find((d: any) => d.date === tp.date);
    if (existing) { existing.trendWeight = tp.weight; existing.trendBf = tp.bf; }
    else { chartData.push({ date: tp.date, trendWeight: tp.weight, trendBf: tp.bf }); dateSet.add(tp.date); }
  }
  // Connect trend to last actual weight (not smoothed — trend is based on raw data)
  if (recentWeights.length > 0 && trendPrediction?.length > 0) {
    const lastActual = recentWeights[recentWeights.length - 1];
    const overlap = chartData.find((d: any) => d.date === lastActual.date);
    if (overlap) {
      overlap.trendWeight = overlap.actual ?? overlap.smoothed;
      overlap.trendBf = overlap.bf ?? overlap.smoothedBf;
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

  // Trend-based "on track" assessment: compare actual rate to goal rate
  const actualRate = Math.abs(profile.trendSlope || 0);
  const goalRate = profile.weeklyRate;
  const rateRatio = goalRate > 0 ? actualRate / goalRate : 0;
  const trendOnTrack = profile.trendSlope < 0 && rateRatio >= 0.8; // losing at >=80% of goal rate
  const trendBehind = profile.trendSlope < 0 && rateRatio >= 0.3 && rateRatio < 0.8;
  // Predicted target date at current pace
  const predictedWeeks = actualRate > 0 ? profile.fatToLose / actualRate : Infinity;
  const predictedDate = actualRate > 0 ? (() => {
    const d = new Date();
    d.setDate(d.getDate() + Math.round(predictedWeeks * 7));
    return d.toISOString().slice(0, 10);
  })() : null;

  const statusColor = profile.targetDatePassed ? "text-rose-500"
    : trendOnTrack ? "text-green-500"
    : trendBehind ? "text-amber-500"
    : "text-rose-500";

  const statusText = profile.targetDatePassed
    ? "Target date passed \u2014 adjust goal"
    : trendOnTrack
      ? `On track \u00b7 goal ${fmtDate(profile.targetDate)} (${profile.daysRemaining}d)`
      : predictedDate
        ? `Behind pace \u00b7 goal ${fmtDate(profile.targetDate)} \u00b7 at current rate: ${fmtDate(predictedDate)}`
        : `Behind pace \u00b7 goal ${fmtDate(profile.targetDate)} (${profile.daysRemaining}d)`;

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
            <span className="text-muted-foreground">
              deficit: {profile.deficit}/day goal
              {profile.closedDeficitDays > 0 && (
                <span className={profile.avgActualDeficit >= profile.deficit * 0.9 ? "text-green-500" : "text-amber-500"}>
                  {" · "}{profile.avgActualDeficit}/day avg ({profile.closedDeficitDays}d)
                </span>
              )}
            </span>
            <span className="text-muted-foreground">&middot;</span>
            <span className="text-muted-foreground">{profile.fatToLose}kg to lose</span>
            <span className="text-muted-foreground">&middot;</span>
            <span className="text-muted-foreground">{profile.weeklyRate}kg/wk goal</span>
            {profile.trendSlope !== 0 && (
              <>
                <span className="text-muted-foreground">&middot;</span>
                <span className={profile.trendSlope < 0 && Math.abs(profile.trendSlope) >= profile.weeklyRate * 0.8 ? "text-green-500" : "text-amber-500"}>
                  {profile.trendSlope < 0 ? `${Math.abs(profile.trendSlope)}kg/wk losing` : `+${profile.trendSlope}kg/wk gaining`}
                </span>
              </>
            )}
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
            <span className="flex items-center gap-1"><span className="w-4 h-0.5" style={{borderTop: "2px dashed #3b82f6"}} />predicted</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-[#f97316]" />goal</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5" style={{borderTop: "2px dashed #22c55e"}} />target</span>
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
                      trendWeight: "Predicted",
                      goalWeight: "Goal path",
                    };
                    if (!labels[name as string]) return [null, null];
                    return [`${value} kg`, labels[name as string]];
                  }}
                />
                <ReferenceLine y={profile.targetWeight} stroke="#22c55e" strokeDasharray="5 5" opacity={0.5} label={{ value: `${profile.targetWeight}kg`, position: "right", fontSize: 10, fill: "#22c55e" }} />
                {/* Goal line: orange straight from first weigh-in to target */}
                <Line type="linear" dataKey="goalWeight" stroke="#f97316" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                {/* Actual weigh-in dots */}
                <Line type="monotone" dataKey="actual" stroke="#3b82f6" dot={{ r: 3, fill: "#3b82f6" }} strokeWidth={0} connectNulls={false} />
                {/* Smoothed line */}
                <Line type="monotone" dataKey="smoothed" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls={true} />
                {/* Predicted trend: blue dashed from last data point */}
                <Line type="linear" dataKey="trendWeight" stroke="#3b82f6" strokeWidth={2} strokeDasharray="8 4" dot={false} connectNulls isAnimationActive={false} />
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
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-[#f97316]" />smoothed</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5" style={{borderTop: "2px dashed #f97316"}} />predicted</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-[#eab308]" />goal</span>
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
                      bf: "BF% (weigh-in)",
                      smoothedBf: "BF% (smoothed)",
                      projBf: "BF% (projected)",
                    };
                    return [`${value}%`, labels[name] || name];
                  }}
                />
                <ReferenceLine y={profile.targetBf} stroke="#22c55e" strokeDasharray="5 5" opacity={0.7} label={{ value: `${profile.targetBf}%`, position: "right", fontSize: 10, fill: "#22c55e" }} />
                {/* Goal line BF% — yellow to distinguish from smoothed orange */}
                <Line type="linear" dataKey="goalBf" stroke="#eab308" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                {/* Actual BF% dots */}
                <Line type="monotone" dataKey="bf" stroke="#f97316" dot={{ r: 3, fill: "#f97316" }} strokeWidth={0} connectNulls={false} />
                {/* Smoothed BF% */}
                <Line type="monotone" dataKey="smoothedBf" stroke="#f97316" strokeWidth={2} dot={false} connectNulls={true} />
                {/* Predicted BF% trend */}
                <Line type="linear" dataKey="trendBf" stroke="#f97316" strokeWidth={2} strokeDasharray="8 4" dot={false} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Burn vs Eaten chart */}
      {dailyDeficits && dailyDeficits.length > 0 && (() => {
        // Add goal line per day (burn - 800) and eaten dot color
        const chartData = dailyDeficits.map(d => ({
          ...d,
          goalLine: Math.max(0, d.totalBurn - goalDeficit),
          eatenDot: d.consumed, // separate key for scatter overlay
        }));
        return (
        <Card>
          <CardContent className="py-4">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Burn vs Eaten</div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground mb-2">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-[#94a3b8]" />BMR</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-[#14b8a6]" />activity</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-[#3b82f6]" />run</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-[#f97316]" />gym</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#22c55e]" />eaten</span>
              <span className="flex items-center gap-1"><span className="w-4 h-0.5" style={{borderTop: "2px dashed rgba(255,255,255,0.4)"}} />goal</span>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" opacity={0.3} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(label: any) => formatDate(String(label))}
                    tick={{ fontSize: 11, fill: "rgba(255,255,255,0.6)" }}
                    interval={Math.max(0, Math.floor(dailyDeficits.length / 6))}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "rgba(255,255,255,0.6)" }}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`}
                    domain={[0, 'auto']}
                  />
                  <Tooltip
                    content={({ active, payload, label }: any) => {
                      if (!active || !payload?.length) return null;
                      const day = chartData.find(d => d.date === label);
                      if (!day) return null;
                      const isDeficit = day.deficit < 0;
                      const beatGoal = day.deficit <= -goalDeficit;
                      const dayLabel = new Date(String(label) + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
                      return (
                        <div style={{
                          backgroundColor: "rgba(10,10,12,0.95)",
                          border: "1px solid rgba(255,255,255,0.15)",
                          borderRadius: "8px",
                          padding: "10px 14px",
                          fontSize: "12px",
                          minWidth: 220,
                        }}>
                          <div style={{ fontWeight: "bold", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                            <span>{dayLabel}</span>
                            <span style={{ fontSize: 10, opacity: 0.5 }}>{day.isToday ? "IN PROGRESS" : day.closed ? "CLOSED" : "OPEN"}</span>
                          </div>
                          <div style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: 4, marginBottom: 4 }}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ fontWeight: 600 }}>BURNED</span>
                              <span style={{ fontWeight: 600 }}>{day.totalBurn.toLocaleString()}</span>
                            </div>
                            <div style={{ color: "#94a3b8", display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                              <span>BMR</span><span>{day.bmr.toLocaleString()}</span>
                            </div>
                            <div style={{ color: "#14b8a6", display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                              <span>Daily activity</span><span>+{day.dailyActivity.toLocaleString()}</span>
                            </div>
                            {day.runCal > 0 && (
                              <div style={{ color: "#3b82f6", display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                                <span>Run ({day.runDistKm}km)</span><span>+{day.runCal.toLocaleString()}</span>
                              </div>
                            )}
                            {day.gymCal > 0 && (
                              <div style={{ color: "#f97316", display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                                <span>Gym{day.gymTitle ? ` (${day.gymTitle})` : ""}</span><span>+{day.gymCal.toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: 4, marginBottom: 4 }}>
                            <span style={{ fontWeight: 600 }}>EATEN</span>
                            <span style={{ fontWeight: 600 }}>{day.consumed.toLocaleString()}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold" }}>
                            <span>DEFICIT</span>
                            <span style={{ color: isDeficit ? "#22c55e" : "#ef4444" }}>
                              {day.deficit > 0 ? "+" : ""}{day.deficit.toLocaleString()} / &minus;{goalDeficit}
                            </span>
                          </div>
                          {day.closed && (
                            <div style={{ fontSize: 10, marginTop: 2, color: beatGoal ? "#22c55e" : "#f59e0b" }}>
                              {beatGoal
                                ? `✓ beat goal by ${Math.abs(day.deficit + goalDeficit).toLocaleString()}`
                                : isDeficit
                                  ? `${(goalDeficit + day.deficit).toLocaleString()} short of goal`
                                  : `surplus day`}
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  {/* Stacked burn bars */}
                  <Bar dataKey="bmr" stackId="burn" fill="#94a3b8" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="dailyActivity" stackId="burn" fill="#14b8a6" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="runCal" stackId="burn" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="gymCal" stackId="burn" fill="#f97316" radius={[4, 4, 0, 0]} />
                  {/* Goal line (burn - 800) */}
                  <Line type="stepAfter" dataKey="goalLine" stroke="rgba(255,255,255,0.6)" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={true} />
                  {/* Eaten dots */}
                  <Line type="monotone" dataKey="eatenDot" stroke="none" strokeWidth={0} dot={(props: any) => {
                    const { cx, cy, payload } = props;
                    if (payload.eatenDot == null || payload.eatenDot === 0) return <></>;
                    const deficit = payload.deficit;
                    const fill = deficit <= -goalDeficit ? "#22c55e" : deficit < 0 ? "#f59e0b" : "#ef4444";
                    return <circle cx={cx} cy={cy} r={5} fill={fill} stroke="rgba(0,0,0,0.5)" strokeWidth={1.5} />;
                  }} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* Cumulative deficit mini chart */}
            <div className="mt-3 pt-3 border-t border-border/30">
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-1">
                <span>Cumulative deficit</span>
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-[#3b82f6]" />actual</span>
                <span className="flex items-center gap-1"><span className="w-4 h-0.5" style={{borderTop: "2px dashed #22c55e"}} />goal pace</span>
              </div>
              <div className="h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 2, right: 5, left: 5, bottom: 2 }}>
                    <XAxis dataKey="date" hide />
                    <YAxis
                      tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
                      tickFormatter={(v: number) => Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`}
                      width={35}
                      domain={[(dataMin: number) => Math.min(dataMin, -1000), 500]}
                    />
                    <Line type="monotone" dataKey="goalPace" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="6 4" dot={false} connectNulls={true} />
                    <Line type="monotone" dataKey="cumulative" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2, fill: "#3b82f6" }} connectNulls={true} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </CardContent>
        </Card>
        );
      })()}

    </div>
  );
}
