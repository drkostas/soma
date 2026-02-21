"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Line,
  ComposedChart,
  Cell,
} from "recharts";
import {
  Calendar,
  Timer,
  Dumbbell,
  Activity,
  Footprints,
  Wind,
  Snowflake,
  Mountain,
  PersonStanding,
  Waves,
  Bike,
  Heart,
} from "lucide-react";

// --- Types ---

interface InteractiveChartCardsProps {
  dayOfWeekData: { dow: number; count: number }[];
  timeOfDayData: { hour: number; count: number }[];
  activityCounts: { type_key: string; cnt: number }[];
  gymFrequency: { month: string; workouts: number }[];
  workoutStats: { total: number; count_7d: number };
  streak: number;
  totalActivities: number;
  children?: React.ReactNode;
}

type DialogType = "training-days" | "training-time" | "activity-breakdown" | "gym-frequency" | null;

// --- Constants (same as page.tsx) ---

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  running: <Footprints className="h-3.5 w-3.5 text-green-400" />,
  strength_training: <Dumbbell className="h-3.5 w-3.5 text-orange-400" />,
  kiteboarding_v2: <Wind className="h-3.5 w-3.5 text-cyan-400" />,
  wind_kite_surfing: <Wind className="h-3.5 w-3.5 text-cyan-400" />,
  resort_snowboarding: <Snowflake className="h-3.5 w-3.5 text-blue-300" />,
  resort_skiing_snowboarding_ws: <Snowflake className="h-3.5 w-3.5 text-blue-300" />,
  hiking: <Mountain className="h-3.5 w-3.5 text-green-400" />,
  walking: <PersonStanding className="h-3.5 w-3.5 text-emerald-400" />,
  lap_swimming: <Waves className="h-3.5 w-3.5 text-blue-400" />,
  cycling: <Bike className="h-3.5 w-3.5 text-yellow-400" />,
  e_bike_fitness: <Bike className="h-3.5 w-3.5 text-yellow-400" />,
  indoor_cardio: <Heart className="h-3.5 w-3.5 text-red-400" />,
  indoor_cycling: <Bike className="h-3.5 w-3.5 text-yellow-400" />,
  stand_up_paddleboarding_v2: <Waves className="h-3.5 w-3.5 text-cyan-300" />,
};

const ACTIVITY_BAR_COLORS: Record<string, string> = {
  running: "bg-green-500/70",
  strength_training: "bg-orange-500/70",
  kiteboarding_v2: "bg-cyan-500/70",
  resort_snowboarding: "bg-blue-400/70",
  hiking: "bg-emerald-500/70",
  walking: "bg-emerald-400/70",
  lap_swimming: "bg-blue-500/70",
  cycling: "bg-yellow-500/70",
  e_bike_fitness: "bg-yellow-500/70",
  indoor_cardio: "bg-red-400/70",
  indoor_cycling: "bg-yellow-500/70",
  stand_up_paddleboarding_v2: "bg-cyan-400/70",
  other: "bg-violet-400/70",
};

const ACTIVITY_RECHARTS_COLORS: Record<string, string> = {
  running: "#22c55e",
  strength_training: "#f97316",
  kiteboarding_v2: "#06b6d4",
  resort_snowboarding: "#60a5fa",
  hiking: "#10b981",
  walking: "#34d399",
  lap_swimming: "#3b82f6",
  cycling: "#eab308",
  e_bike_fitness: "#eab308",
  indoor_cardio: "#f87171",
  indoor_cycling: "#eab308",
  stand_up_paddleboarding_v2: "#67e8f9",
  other: "#a78bfa",
};

const ACTIVITY_LABELS: Record<string, string> = {
  running: "Run",
  strength_training: "Gym",
  kiteboarding_v2: "Kite",
  wind_kite_surfing: "Kite",
  resort_snowboarding: "Snow",
  resort_skiing_snowboarding_ws: "Snow",
  hiking: "Hike",
  e_bike_fitness: "E-Bike",
  lap_swimming: "Swim",
  walking: "Walk",
  indoor_cardio: "Cardio",
  indoor_rowing: "Row",
  yoga: "Yoga",
  cycling: "Cycle",
  elliptical: "Elliptical",
  stand_up_paddleboarding_v2: "SUP",
  other: "Other",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// --- Tooltip style ---
const tooltipStyle = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  color: "var(--card-foreground)",
  fontSize: "12px",
};

// --- Component ---

export function InteractiveChartCards({
  dayOfWeekData,
  timeOfDayData,
  activityCounts,
  gymFrequency,
  workoutStats,
  streak,
  totalActivities,
  children,
}: InteractiveChartCardsProps) {
  const [openDialog, setOpenDialog] = useState<DialogType>(null);

  // Pre-compute shared data
  const dowCounts = new Array(7).fill(0);
  for (const row of dayOfWeekData) {
    dowCounts[Number(row.dow)] = Number(row.count);
  }
  const dowMax = Math.max(...dowCounts);
  const dowTotal = dowCounts.reduce((s: number, c: number) => s + c, 0);

  const todCounts = new Array(24).fill(0);
  for (const row of timeOfDayData) {
    todCounts[Number(row.hour)] = Number(row.count);
  }
  const todMax = Math.max(...todCounts);

  const sortedDow = [...dayOfWeekData].sort(
    (a, b) => Number(b.count) - Number(a.count)
  );
  const mostActiveDay = sortedDow.length > 0 ? DAY_NAMES[Number(sortedDow[0].dow)] : "";

  const sortedTod = [...timeOfDayData].sort(
    (a, b) => Number(b.count) - Number(a.count)
  );
  const peakHour = (() => {
    if (sortedTod.length === 0) return "";
    const h = Number(sortedTod[0].hour);
    return h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
  })();

  const cardClass = "cursor-pointer transition-colors hover:bg-muted/50";

  return (
    <>
      {/* Training Day & Time Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Day of Week Card */}
        {dayOfWeekData.length > 0 && (
          <Card
            className={cardClass}
            onClick={() => setOpenDialog("training-days")}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Training Days
                <span className="ml-auto text-xs font-normal">
                  Most active: {mostActiveDay}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-3 h-32">
                {dowCounts.map((count, i) => {
                  const pct = dowMax > 0 ? (count / dowMax) * 100 : 0;
                  const isMax = count === dowMax;
                  const sharePct = dowTotal > 0 ? ((count / dowTotal) * 100).toFixed(0) : "0";
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-xs font-semibold">{count}</span>
                      <div className="w-full flex items-end justify-center" style={{ height: "80px" }}>
                        <div
                          className={`w-full max-w-[40px] rounded-t transition-all ${
                            isMax ? "bg-primary" : "bg-primary/40"
                          }`}
                          style={{ height: `${Math.max(pct, 4)}%` }}
                          title={`${DAY_NAMES[i]}: ${count} activities (${sharePct}%)`}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground font-medium">{DAY_NAMES[i]}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Time of Day Card */}
        {timeOfDayData.length > 0 && (
          <Card
            className={cardClass}
            onClick={() => setOpenDialog("training-time")}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Timer className="h-4 w-4" />
                Training Time
                <span className="ml-auto text-xs font-normal">
                  Peak: {peakHour}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-[2px] h-32">
                {todCounts.map((count, h) => {
                  const pct = todMax > 0 ? (count / todMax) * 100 : 0;
                  const isMax = count === todMax;
                  const label = h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;
                  const isMorning = h >= 5 && h < 12;
                  const isAfternoon = h >= 12 && h < 17;
                  const isEvening = h >= 17 && h < 22;
                  const color = isMax ? "bg-primary" :
                    isMorning ? "bg-amber-400/60" :
                    isAfternoon ? "bg-orange-400/60" :
                    isEvening ? "bg-indigo-400/60" : "bg-muted-foreground/20";
                  return (
                    <div key={h} className="flex-1 flex flex-col items-center gap-0.5">
                      {count > 0 && pct > 30 && (
                        <span className="text-[8px] font-medium">{count}</span>
                      )}
                      <div className="w-full flex items-end justify-center" style={{ height: "80px" }}>
                        <div
                          className={`w-full rounded-t-sm transition-all ${color}`}
                          style={{ height: `${Math.max(pct, count > 0 ? 4 : 0)}%` }}
                          title={`${label}: ${count} activities`}
                        />
                      </div>
                      {h % 6 === 0 && (
                        <span className="text-[9px] text-muted-foreground">{label}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground justify-center">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400/60" /> Morning</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-orange-400/60" /> Afternoon</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-indigo-400/60" /> Evening</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Activity Breakdown + Gym Frequency (2 of the 3-col grid) */}
      {/* Note: Last Gym Session stays in page.tsx as the 3rd column */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Activity Breakdown Card */}
        <Card
          className={cardClass}
          onClick={() => setOpenDialog("activity-breakdown")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Activity Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {activityCounts.map((a) => {
              const icon = ACTIVITY_ICONS[a.type_key] || <Activity className="h-3.5 w-3.5" />;
              const label = ACTIVITY_LABELS[a.type_key] || a.type_key.replace(/_/g, " ");
              const pct = totalActivities > 0 ? (a.cnt / activityCounts[0].cnt) * 100 : 0;
              const barColor = ACTIVITY_BAR_COLORS[a.type_key] || "bg-primary/60";
              return (
                <div key={a.type_key} className="flex items-center gap-2 text-sm">
                  {icon}
                  <span className="text-muted-foreground w-14 truncate">{label}</span>
                  <div className="flex-1 h-4 bg-muted rounded-sm overflow-hidden">
                    <div
                      className={`h-full ${barColor} rounded-sm`}
                      style={{ width: `${Math.max(pct, 3)}%` }}
                    />
                  </div>
                  <span className="font-medium w-8 text-right">{a.cnt}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Gym Frequency Card */}
        <Card
          className={cardClass}
          onClick={() => setOpenDialog("gym-frequency")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Gym Frequency
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 mb-3">
              <Dumbbell className="h-5 w-5 text-primary" />
              <span className="text-2xl font-bold">{Number(workoutStats.total)}</span>
              <span className="text-sm text-muted-foreground">workouts</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {Number(workoutStats.count_7d)} this week
              </span>
            </div>
            <GymFrequencyMiniChart data={gymFrequency} />
          </CardContent>
        </Card>

        {/* Last Gym Session card (passed as children from server component) */}
        {children}
      </div>

      {/* --- Expanded Dialogs --- */}

      {/* Training Days Dialog */}
      <Dialog
        open={openDialog === "training-days"}
        onOpenChange={(open) => { if (!open) setOpenDialog(null); }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Training Days</DialogTitle>
            <DialogDescription>Activity count per day of week</DialogDescription>
          </DialogHeader>
          <TrainingDaysExpanded dowCounts={dowCounts} dowTotal={dowTotal} />
        </DialogContent>
      </Dialog>

      {/* Training Time Dialog */}
      <Dialog
        open={openDialog === "training-time"}
        onOpenChange={(open) => { if (!open) setOpenDialog(null); }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Training Time</DialogTitle>
            <DialogDescription>When you train throughout the day</DialogDescription>
          </DialogHeader>
          <TrainingTimeExpanded todCounts={todCounts} />
        </DialogContent>
      </Dialog>

      {/* Activity Breakdown Dialog */}
      <Dialog
        open={openDialog === "activity-breakdown"}
        onOpenChange={(open) => { if (!open) setOpenDialog(null); }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Activity Breakdown</DialogTitle>
            <DialogDescription>All activity types and their counts</DialogDescription>
          </DialogHeader>
          <ActivityBreakdownExpanded
            activityCounts={activityCounts}
            totalActivities={totalActivities}
          />
        </DialogContent>
      </Dialog>

      {/* Gym Frequency Dialog */}
      <Dialog
        open={openDialog === "gym-frequency"}
        onOpenChange={(open) => { if (!open) setOpenDialog(null); }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Gym Frequency</DialogTitle>
            <DialogDescription>Monthly gym workout history</DialogDescription>
          </DialogHeader>
          <GymFrequencyExpanded
            data={gymFrequency}
            workoutStats={workoutStats}
            streak={streak}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

// --- Expanded View: Training Days ---

function TrainingDaysExpanded({
  dowCounts,
  dowTotal,
}: {
  dowCounts: number[];
  dowTotal: number;
}) {
  const chartData = DAY_NAMES.map((name, i) => ({
    day: name,
    count: dowCounts[i],
  }));
  const max = Math.max(...dowCounts);
  const avgPerDay = dowTotal / 7;

  return (
    <div>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} vertical={false} />
            <XAxis
              dataKey="day"
              className="text-[11px]"
              tickLine={false}
            />
            <YAxis
              className="text-[10px]"
              tickLine={false}
              width={35}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              contentStyle={tooltipStyle}
              itemStyle={{ color: "var(--card-foreground)" }}
              labelStyle={{ color: "var(--card-foreground)" }}
              formatter={(value: any) => [`${value} activities`, "Count"]}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell
                  key={index}
                  fill={
                    entry.count === max
                      ? "var(--primary)"
                      : "color-mix(in oklch, var(--primary) 50%, transparent)"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4 pt-4 border-t mt-4">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Activities</div>
          <div className="text-xl font-bold">{dowTotal}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg / Day</div>
          <div className="text-xl font-bold">{avgPerDay.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Most Active</div>
          <div className="text-xl font-bold">
            {DAY_NAMES[dowCounts.indexOf(max)]}
          </div>
          <div className="text-xs text-muted-foreground">{max} activities</div>
        </div>
      </div>
    </div>
  );
}

// --- Expanded View: Training Time ---

function TrainingTimeExpanded({ todCounts }: { todCounts: number[] }) {
  const chartData = todCounts.map((count, h) => {
    const isMorning = h >= 5 && h < 12;
    const isAfternoon = h >= 12 && h < 17;
    const isEvening = h >= 17 && h < 22;
    const category = isMorning ? "morning" : isAfternoon ? "afternoon" : isEvening ? "evening" : "night";
    return {
      hour: h,
      label: h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`,
      shortLabel: h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`,
      count,
      category,
    };
  });

  const max = Math.max(...todCounts);
  const total = todCounts.reduce((s, c) => s + c, 0);
  const peakIdx = todCounts.indexOf(max);
  const peakLabel = chartData[peakIdx]?.label || "";

  const morningCount = todCounts.slice(5, 12).reduce((s, c) => s + c, 0);
  const afternoonCount = todCounts.slice(12, 17).reduce((s, c) => s + c, 0);
  const eveningCount = todCounts.slice(17, 22).reduce((s, c) => s + c, 0);
  const nightCount = total - morningCount - afternoonCount - eveningCount;

  const categoryColors: Record<string, string> = {
    morning: "#fbbf24",
    afternoon: "#f97316",
    evening: "#818cf8",
    night: "#6b7280",
  };

  return (
    <div>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} vertical={false} />
            <XAxis
              dataKey="shortLabel"
              className="text-[9px]"
              tickLine={false}
              interval={1}
            />
            <YAxis
              className="text-[10px]"
              tickLine={false}
              width={30}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              contentStyle={tooltipStyle}
              itemStyle={{ color: "var(--card-foreground)" }}
              labelStyle={{ color: "var(--card-foreground)" }}
              labelFormatter={(_: any, payload: any) => {
                const item = payload?.[0]?.payload;
                return item?.label || "";
              }}
              formatter={(value: any) => [`${value} activities`, "Count"]}
            />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell
                  key={index}
                  fill={
                    entry.count === max
                      ? "var(--primary)"
                      : categoryColors[entry.category]
                  }
                  fillOpacity={entry.count === max ? 1 : 0.7}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 pt-4 border-t mt-4">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Peak Hour</div>
          <div className="text-xl font-bold">{peakLabel}</div>
          <div className="text-xs text-muted-foreground">{max} activities</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-amber-400" /> Morning
          </div>
          <div className="text-xl font-bold">{morningCount}</div>
          <div className="text-xs text-muted-foreground">5 AM - 12 PM</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-orange-400" /> Afternoon
          </div>
          <div className="text-xl font-bold">{afternoonCount}</div>
          <div className="text-xs text-muted-foreground">12 PM - 5 PM</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-indigo-400" /> Evening
          </div>
          <div className="text-xl font-bold">{eveningCount}</div>
          <div className="text-xs text-muted-foreground">5 PM - 10 PM</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-gray-500" /> Night
          </div>
          <div className="text-xl font-bold">{nightCount}</div>
          <div className="text-xs text-muted-foreground">10 PM - 5 AM</div>
        </div>
      </div>
    </div>
  );
}

// --- Expanded View: Activity Breakdown ---

function ActivityBreakdownExpanded({
  activityCounts,
  totalActivities,
}: {
  activityCounts: { type_key: string; cnt: number }[];
  totalActivities: number;
}) {
  const chartData = activityCounts.map((a) => ({
    type_key: a.type_key,
    label: ACTIVITY_LABELS[a.type_key] || a.type_key.replace(/_/g, " "),
    count: a.cnt,
    fill: ACTIVITY_RECHARTS_COLORS[a.type_key] || "#a78bfa",
  }));

  return (
    <div>
      <div style={{ height: Math.max(activityCounts.length * 36, 200) }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 30, bottom: 5, left: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} horizontal={false} />
            <XAxis
              type="number"
              className="text-[10px]"
              tickLine={false}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              className="text-[11px]"
              tickLine={false}
              width={60}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              contentStyle={tooltipStyle}
              itemStyle={{ color: "var(--card-foreground)" }}
              labelStyle={{ color: "var(--card-foreground)" }}
              formatter={(value: any, _name: any, props: any) => {
                const pct = totalActivities > 0 ? ((Number(value) / totalActivities) * 100).toFixed(1) : "0";
                return [`${value} activities (${pct}%)`, props?.payload?.label || ""];
              }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.fill} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Per-type stats table */}
      <div className="pt-4 border-t mt-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Breakdown
        </div>
        <div className="space-y-2">
          {activityCounts.map((a) => {
            const icon = ACTIVITY_ICONS[a.type_key] || <Activity className="h-3.5 w-3.5" />;
            const label = ACTIVITY_LABELS[a.type_key] || a.type_key.replace(/_/g, " ");
            const pct = totalActivities > 0 ? ((a.cnt / totalActivities) * 100).toFixed(1) : "0";
            return (
              <div key={a.type_key} className="flex items-center gap-3 text-sm">
                {icon}
                <span className="text-muted-foreground w-20">{label}</span>
                <span className="font-medium w-10 text-right">{a.cnt}</span>
                <span className="text-xs text-muted-foreground w-14 text-right">{pct}%</span>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max((a.cnt / activityCounts[0].cnt) * 100, 2)}%`,
                      backgroundColor: ACTIVITY_RECHARTS_COLORS[a.type_key] || "#a78bfa",
                      opacity: 0.7,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between mt-4 pt-3 border-t text-sm">
          <span className="text-muted-foreground font-medium">Total</span>
          <span className="font-bold">{totalActivities} activities</span>
        </div>
      </div>
    </div>
  );
}

// --- Expanded View: Gym Frequency ---

function GymFrequencyExpanded({
  data,
  workoutStats,
  streak,
}: {
  data: { month: string; workouts: number }[];
  workoutStats: { total: number; count_7d: number };
  streak: number;
}) {
  const chartData = data.map((d) => ({
    month: d.month,
    workouts: Number(d.workouts),
  }));

  // Compute 3-month running average
  const withAvg = chartData.map((d, i) => {
    const start = Math.max(0, i - 2);
    const slice = chartData.slice(start, i + 1);
    const avg = slice.reduce((s, x) => s + x.workouts, 0) / slice.length;
    return { ...d, avg: Math.round(avg * 10) / 10 };
  });

  const max = Math.max(...chartData.map((d) => d.workouts));
  const bestMonth = chartData.reduce(
    (best, d) => (d.workouts > best.workouts ? d : best),
    chartData[0] || { month: "", workouts: 0 }
  );
  const avgPerMonth =
    chartData.length > 0
      ? chartData.reduce((s, d) => s + d.workouts, 0) / chartData.length
      : 0;
  const currentMonth = chartData.length > 0 ? chartData[chartData.length - 1] : null;

  const formatMonth = (m: string) => {
    const [year, month] = m.split("-");
    const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[parseInt(month)]} '${year.slice(2)}`;
  };

  // Compute tick marks so they don't overlap
  const tickMonths = (() => {
    const unique = chartData.map((d) => d.month);
    if (unique.length > 12) {
      const step = Math.ceil(unique.length / 12);
      return unique.filter((_, i) => i % step === 0 || i === unique.length - 1);
    }
    return unique;
  })();

  return (
    <div>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={withAvg} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} vertical={false} />
            <XAxis
              dataKey="month"
              className="text-[9px]"
              tickLine={false}
              tickFormatter={formatMonth}
              ticks={tickMonths}
            />
            <YAxis
              className="text-[10px]"
              tickLine={false}
              width={30}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              contentStyle={tooltipStyle}
              itemStyle={{ color: "var(--card-foreground)" }}
              labelStyle={{ color: "var(--card-foreground)" }}
              labelFormatter={(m: any) => {
                const [year, month] = String(m).split("-");
                const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                return `${months[parseInt(month)]} ${year}`;
              }}
              formatter={(value: any, name: any) => {
                if (name === "avg") return [`${Number(value).toFixed(1)}`, "3-month avg"];
                return [`${value} workouts`, "Count"];
              }}
            />
            <Bar dataKey="workouts" radius={[3, 3, 0, 0]}>
              {withAvg.map((entry, index) => (
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
            <Line
              type="monotone"
              dataKey="avg"
              stroke="#f97316"
              strokeWidth={2}
              dot={false}
              strokeOpacity={0.8}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 pt-4 border-t mt-4">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Workouts</div>
          <div className="text-xl font-bold">{Number(workoutStats.total)}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg / Month</div>
          <div className="text-xl font-bold">{avgPerMonth.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Best Month</div>
          <div className="text-xl font-bold">{bestMonth.workouts}</div>
          <div className="text-xs text-muted-foreground">{formatMonth(bestMonth.month)}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Current Month</div>
          <div className="text-xl font-bold">{currentMonth?.workouts ?? 0}</div>
          <div className="text-xs text-muted-foreground">
            {Number(workoutStats.count_7d)} this week
          </div>
        </div>
        {streak > 0 && (
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Current Streak</div>
            <div className="text-xl font-bold text-primary">{streak} days</div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Mini Gym Frequency Chart (for the card view, replaces WorkoutFrequencyChart) ---

function GymFrequencyMiniChart({ data }: { data: { month: string; workouts: number }[] }) {
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

  const tickMonths = (() => {
    const unique = chartData.map((d) => d.month);
    if (unique.length > 8) {
      const step = Math.ceil(unique.length / 8);
      return unique.filter((_, i) => i % step === 0 || i === unique.length - 1);
    }
    return unique;
  })();

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={chartData}>
        <XAxis
          dataKey="month"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(m: string) => {
            const [year, month] = m.split("-");
            const mo = parseInt(month);
            const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            return `${months[mo]} '${year.slice(2)}`;
          }}
          ticks={tickMonths}
        />
        <YAxis hide />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.3 }}
          formatter={(value: any) => [`${value} workouts`, "Count"]}
          labelFormatter={(m: any) => {
            const [year, month] = String(m).split("-");
            const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            return `${months[parseInt(month)]} ${year}`;
          }}
          contentStyle={tooltipStyle}
              itemStyle={{ color: "var(--card-foreground)" }}
              labelStyle={{ color: "var(--card-foreground)" }}
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
