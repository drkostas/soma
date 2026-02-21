"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { Activity } from "lucide-react";

// --- Types ---

interface MetricData {
  label: string;
  value: number;
  prev: number | null;
  unit: string;
}

interface InteractiveThisWeekProps {
  metrics: MetricData[];
  streak: number;
}

interface DayData {
  day: string;
  date: string;
  sessions: number;
  hours: number;
  km: number;
  calories: number;
}

interface WeeklyComparisonData {
  this_week: DayData[];
  last_week: DayData[];
  totals: {
    this_week: { sessions: number; hours: number; km: number; calories: number };
    last_week: { sessions: number; hours: number; km: number; calories: number };
  };
}

type MetricKey = "sessions" | "hours" | "km" | "calories";

const METRIC_TABS: { key: MetricKey; label: string; unit: string; format: (v: number) => string }[] = [
  { key: "sessions", label: "Sessions", unit: "", format: (v) => String(v) },
  { key: "hours", label: "Duration", unit: "h", format: (v) => v.toFixed(1) },
  { key: "km", label: "Distance", unit: "km", format: (v) => v.toFixed(1) },
  { key: "calories", label: "Calories", unit: "kcal", format: (v) => Math.round(v).toLocaleString() },
];

const tooltipStyle = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  color: "var(--card-foreground)",
  fontSize: "12px",
};

// --- Component ---

export function InteractiveThisWeek({ metrics, streak }: InteractiveThisWeekProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<WeeklyComparisonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<MetricKey>("sessions");

  const fetchData = useCallback(async () => {
    if (data) return; // Already fetched
    setLoading(true);
    try {
      const res = await fetch("/api/weekly-comparison");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error("Failed to fetch weekly comparison:", err);
    } finally {
      setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    if (open && !data) {
      fetchData();
    }
  }, [open, data, fetchData]);

  const hasData = metrics.length > 0 && metrics.some((m) => m.value > 0);

  return (
    <>
      {/* Card view - identical to original inline rendering */}
      <Card
        className="mb-6 cursor-pointer transition-colors hover:bg-muted/50"
        onClick={() => setOpen(true)}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Activity className="h-4 w-4" />
            This Week
            {streak > 0 && (
              <span className="ml-auto text-xs font-normal text-primary">
                {streak}-day training streak
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasData ? (
            <p className="text-sm text-muted-foreground">No training this week yet</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {metrics.map((m) => {
                const diff = m.prev !== null ? ((m.value - m.prev) / Math.max(m.prev, 1)) * 100 : null;
                return (
                  <div key={m.label}>
                    <div className="text-xs text-muted-foreground">{m.label}</div>
                    <div className="text-xl font-bold">
                      {m.unit === "kcal"
                        ? Math.round(m.value).toLocaleString()
                        : m.value}
                      <span className="text-sm font-normal text-muted-foreground ml-1">{m.unit}</span>
                    </div>
                    {diff !== null && (
                      <div className={`text-xs ${diff >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {diff >= 0 ? "+" : ""}{diff.toFixed(0)}% vs last week
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog with day-by-day comparison */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>This Week vs Last Week</DialogTitle>
            <DialogDescription>
              Day-by-day training comparison
              {streak > 0 && ` -- ${streak}-day streak`}
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-sm text-muted-foreground animate-pulse">Loading comparison data...</div>
            </div>
          )}

          {!loading && data && (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as MetricKey)}>
              <TabsList className="w-full">
                {METRIC_TABS.map((tab) => (
                  <TabsTrigger key={tab.key} value={tab.key} className="flex-1">
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {METRIC_TABS.map((tab) => (
                <TabsContent key={tab.key} value={tab.key}>
                  <WeeklyChart
                    thisWeek={data.this_week}
                    lastWeek={data.last_week}
                    metricKey={tab.key}
                    unit={tab.unit}
                    format={tab.format}
                  />
                  <WeeklySummary
                    thisWeekTotal={data.totals.this_week[tab.key]}
                    lastWeekTotal={data.totals.last_week[tab.key]}
                    unit={tab.unit}
                    format={tab.format}
                    label={tab.label}
                  />
                </TabsContent>
              ))}
            </Tabs>
          )}

          {!loading && !data && (
            <div className="flex items-center justify-center py-12">
              <div className="text-sm text-muted-foreground">Failed to load data</div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// --- Weekly Bar Chart ---

function WeeklyChart({
  thisWeek,
  lastWeek,
  metricKey,
  unit,
  format,
}: {
  thisWeek: DayData[];
  lastWeek: DayData[];
  metricKey: MetricKey;
  unit: string;
  format: (v: number) => string;
}) {
  const chartData = thisWeek.map((tw, i) => ({
    day: tw.day,
    this_week: tw[metricKey],
    last_week: lastWeek[i]?.[metricKey] ?? 0,
  }));

  return (
    <div className="h-[280px] w-full mt-4">
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
            width={40}
            allowDecimals={metricKey !== "sessions"}
            tickFormatter={(v) => format(v)}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value: any, name: any) => {
              const label = name === "this_week" ? "This Week" : "Last Week";
              return [`${format(Number(value ?? 0))}${unit ? ` ${unit}` : ""}`, label];
            }}
          />
          <Legend
            formatter={(value) => (value === "this_week" ? "This Week" : "Last Week")}
            wrapperStyle={{ fontSize: "12px" }}
          />
          <Bar
            dataKey="last_week"
            fill="var(--muted-foreground)"
            fillOpacity={0.25}
            radius={[4, 4, 0, 0]}
            name="last_week"
          />
          <Bar
            dataKey="this_week"
            fill="var(--primary)"
            fillOpacity={0.85}
            radius={[4, 4, 0, 0]}
            name="this_week"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- Weekly Summary Row ---

function WeeklySummary({
  thisWeekTotal,
  lastWeekTotal,
  unit,
  format,
  label,
}: {
  thisWeekTotal: number;
  lastWeekTotal: number;
  unit: string;
  format: (v: number) => string;
  label: string;
}) {
  const diff = lastWeekTotal > 0
    ? ((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100
    : thisWeekTotal > 0 ? 100 : 0;

  return (
    <div className="grid grid-cols-3 gap-4 pt-4 border-t mt-4">
      <div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">This Week</div>
        <div className="text-xl font-bold">
          {format(thisWeekTotal)}
          {unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
        </div>
      </div>
      <div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Last Week</div>
        <div className="text-xl font-bold text-muted-foreground">
          {format(lastWeekTotal)}
          {unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
        </div>
      </div>
      <div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Change</div>
        <div className={`text-xl font-bold ${diff >= 0 ? "text-green-400" : "text-red-400"}`}>
          {diff >= 0 ? "+" : ""}{diff.toFixed(0)}%
        </div>
        <div className="text-xs text-muted-foreground">
          {label.toLowerCase()}
        </div>
      </div>
    </div>
  );
}
