"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { MUSCLE_LABELS, MUSCLE_COLORS, type MuscleGroup } from "@/lib/muscle-groups";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Trophy, TrendingUp, Calendar, Dumbbell, Heart } from "lucide-react";

interface ExerciseData {
  name: string;
  muscles: { primary: MuscleGroup[]; secondary: MuscleGroup[] };
  totalSessions: number;
  totalSets: number;
  totalReps: number;
  records: {
    maxWeight: { value: number; date: string; reps: number };
    maxReps: { value: number; date: string; weight: number };
    maxVolume: { value: number; date: string; weight: number; reps: number };
    estimated1RM: { value: number; date: string; weight: number; reps: number };
  };
  progression: {
    date: string;
    workoutId: string;
    program: string;
    maxWeight: number;
    totalVolume: number;
    maxReps: number;
    estimated1RM: number;
    avgHr: number | null;
    sets: { weight: number; reps: number; type: string }[];
  }[];
}

type ChartMetric = "maxWeight" | "totalVolume" | "estimated1RM" | "maxReps";

const METRIC_LABELS: Record<ChartMetric, string> = {
  maxWeight: "Max Weight",
  totalVolume: "Total Volume",
  estimated1RM: "Est. 1RM",
  maxReps: "Max Reps",
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "2-digit" }),
  });
}

function RecordCard({ label, value, unit, context, icon }: {
  label: string;
  value: string;
  unit: string;
  context: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="border border-border/50 rounded-lg p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-xl font-bold">
        {value}
        <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">{context}</div>
    </div>
  );
}

function ChartTooltipContent({ active, payload }: any) {
  if (!active || !payload?.[0]) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-popover border border-border rounded-lg p-2 text-xs shadow-md">
      <div className="font-medium mb-1">{formatDate(data.date)}</div>
      <div className="text-muted-foreground">{data.program}</div>
      <div className="mt-1 space-y-0.5">
        <div>Max: {data.maxWeight} kg</div>
        <div>Volume: {data.totalVolume.toLocaleString()} kg</div>
        <div>Est 1RM: {data.estimated1RM} kg</div>
        {data.avgHr && (
          <div className="flex items-center gap-1 text-red-400">
            <Heart className="h-3 w-3" /> {data.avgHr} bpm
          </div>
        )}
      </div>
    </div>
  );
}

export function ExerciseDetailModal({
  exerciseName,
  onClose,
}: {
  exerciseName: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<ExerciseData | null>(null);
  const [loading, setLoading] = useState(false);
  const [metric, setMetric] = useState<ChartMetric>("maxWeight");
  const [tab, setTab] = useState("records");

  useEffect(() => {
    if (!exerciseName) {
      setData(null);
      return;
    }
    setLoading(true);
    setTab("records");
    setMetric("maxWeight");
    fetch(`/api/workouts/exercise?name=${encodeURIComponent(exerciseName)}`)
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [exerciseName]);

  // Summarize sets for history display
  const summarizeSets = (sets: { weight: number; reps: number; type: string }[]) => {
    const working = sets.filter(s => s.type === "normal" && s.weight > 0);
    if (working.length === 0) return "bodyweight";

    // Group identical sets: "3×12 @ 40kg, 2×10 @ 45kg"
    const groups: { weight: number; reps: number; count: number }[] = [];
    for (const s of working) {
      const existing = groups.find(g => g.weight === s.weight && g.reps === s.reps);
      if (existing) existing.count++;
      else groups.push({ weight: s.weight, reps: s.reps, count: 1 });
    }
    return groups
      .map(g => `${g.count}×${g.reps} @ ${Math.round(g.weight * 10) / 10}kg`)
      .join(", ");
  };

  return (
    <Sheet open={!!exerciseName} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            Loading...
          </div>
        )}
        {data && !loading && (
          <>
            <SheetHeader className="mb-4">
              <SheetTitle className="text-lg">{data.name}</SheetTitle>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {data.muscles.primary.map(mg => (
                  <Badge
                    key={mg}
                    variant="outline"
                    className="text-[10px]"
                    style={{ borderColor: MUSCLE_COLORS[mg].hex, color: MUSCLE_COLORS[mg].hex }}
                  >
                    {MUSCLE_LABELS[mg]}
                  </Badge>
                ))}
                {data.muscles.secondary.map(mg => (
                  <Badge
                    key={`s-${mg}`}
                    variant="outline"
                    className="text-[10px] opacity-50"
                  >
                    {MUSCLE_LABELS[mg]}
                  </Badge>
                ))}
              </div>
              <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                <span>{data.totalSessions} sessions</span>
                <span>{data.totalSets} sets</span>
                <span>{data.totalReps.toLocaleString()} reps</span>
              </div>
            </SheetHeader>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full">
                <TabsTrigger value="records" className="flex-1 text-xs">Records</TabsTrigger>
                <TabsTrigger value="progression" className="flex-1 text-xs">Progression</TabsTrigger>
                <TabsTrigger value="history" className="flex-1 text-xs">History</TabsTrigger>
              </TabsList>

              {/* Records Tab */}
              <TabsContent value="records" className="mt-4">
                <div className="grid grid-cols-2 gap-3">
                  <RecordCard
                    label="Max Weight"
                    value={`${Math.round(data.records.maxWeight.value * 10) / 10}`}
                    unit="kg"
                    context={`${data.records.maxWeight.reps} reps · ${formatDate(data.records.maxWeight.date)}`}
                    icon={<Trophy className="h-3 w-3 text-yellow-400" />}
                  />
                  <RecordCard
                    label="Est. 1RM"
                    value={`${data.records.estimated1RM.value}`}
                    unit="kg"
                    context={`${Math.round(data.records.estimated1RM.weight * 10) / 10}kg × ${data.records.estimated1RM.reps} · ${formatDate(data.records.estimated1RM.date)}`}
                    icon={<TrendingUp className="h-3 w-3 text-green-400" />}
                  />
                  <RecordCard
                    label="Max Reps"
                    value={`${data.records.maxReps.value}`}
                    unit="reps"
                    context={`@ ${Math.round(data.records.maxReps.weight * 10) / 10}kg · ${formatDate(data.records.maxReps.date)}`}
                    icon={<Dumbbell className="h-3 w-3 text-blue-400" />}
                  />
                  <RecordCard
                    label="Best Set Volume"
                    value={`${Math.round(data.records.maxVolume.value).toLocaleString()}`}
                    unit="kg"
                    context={`${Math.round(data.records.maxVolume.weight * 10) / 10}×${data.records.maxVolume.reps} · ${formatDate(data.records.maxVolume.date)}`}
                    icon={<Dumbbell className="h-3 w-3 text-purple-400" />}
                  />
                </div>
              </TabsContent>

              {/* Progression Tab */}
              <TabsContent value="progression" className="mt-4">
                <div className="flex gap-1 mb-3 p-0.5 bg-muted/50 rounded-lg w-fit">
                  {(["maxWeight", "totalVolume", "estimated1RM", "maxReps"] as ChartMetric[]).map(m => (
                    <button
                      key={m}
                      onClick={() => setMetric(m)}
                      className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                        metric === m
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {METRIC_LABELS[m]}
                    </button>
                  ))}
                </div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.progression} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(d: string) => {
                          const date = new Date(d + "T00:00:00");
                          return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                        }}
                        className="text-[10px]"
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        className="text-[10px]"
                        tickLine={false}
                        axisLine={false}
                        width={45}
                      />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Line
                        type="monotone"
                        dataKey={metric}
                        stroke="var(--primary)"
                        strokeWidth={2}
                        dot={{ r: 2, fill: "var(--primary)" }}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </TabsContent>

              {/* History Tab */}
              <TabsContent value="history" className="mt-4">
                <div className="space-y-2">
                  {data.progression.slice().reverse().map((session, i) => (
                    <div
                      key={i}
                      className="border border-border/40 rounded-lg px-3 py-2 hover:bg-accent/10 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{formatDate(session.date)}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {session.program}
                          </Badge>
                          {session.avgHr && (
                            <span className="text-[10px] text-red-400 flex items-center gap-0.5">
                              <Heart className="h-2.5 w-2.5" /> {session.avgHr}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {summarizeSets(session.sets)}
                      </div>
                      <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
                        <span>Max: {session.maxWeight}kg</span>
                        <span>Vol: {session.totalVolume.toLocaleString()}kg</span>
                        <span>1RM: {session.estimated1RM}kg</span>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
