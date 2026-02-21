"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ActivityDetailModal } from "./activity-detail-modal";
import { WorkoutDetailModal } from "./workout-detail-modal";
import {
  Footprints,
  Dumbbell,
  Wind,
  Snowflake,
  Mountain,
  Activity,
  Bike,
  Waves,
  PersonStanding,
  Heart,
} from "lucide-react";

interface ActivityInfo {
  activity_id: string;
  type_key: string;
  name: string;
  workout_id?: string;
}

interface DayData {
  date: string;
  count: number;
  types: string[];
  activities: ActivityInfo[];
}

const TYPE_COLORS: Record<string, string> = {
  running: "bg-green-500",
  strength_training: "bg-orange-500",
  kiteboarding_v2: "bg-cyan-500",
  wind_kite_surfing: "bg-cyan-500",
  resort_snowboarding: "bg-blue-400",
  resort_skiing_snowboarding_ws: "bg-blue-400",
  hiking: "bg-emerald-500",
  walking: "bg-emerald-400",
  cycling: "bg-yellow-500",
  e_bike_fitness: "bg-yellow-500",
  lap_swimming: "bg-blue-500",
  indoor_cardio: "bg-red-400",
  treadmill_running: "bg-green-500",
};

const ACTIVITY_LABELS: Record<string, string> = {
  running: "Run",
  strength_training: "Gym",
  kiteboarding_v2: "Kite",
  wind_kite_surfing: "Kite",
  resort_snowboarding: "Snow",
  resort_skiing_snowboarding_ws: "Snow",
  hiking: "Hike",
  walking: "Walk",
  cycling: "Cycle",
  e_bike_fitness: "E-Bike",
  lap_swimming: "Swim",
  indoor_cardio: "Cardio",
  treadmill_running: "Treadmill",
};

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  running: <Footprints className="h-3 w-3 text-green-400" />,
  strength_training: <Dumbbell className="h-3 w-3 text-orange-400" />,
  kiteboarding_v2: <Wind className="h-3 w-3 text-cyan-400" />,
  wind_kite_surfing: <Wind className="h-3 w-3 text-cyan-400" />,
  resort_snowboarding: <Snowflake className="h-3 w-3 text-blue-300" />,
  resort_skiing_snowboarding_ws: <Snowflake className="h-3 w-3 text-blue-300" />,
  hiking: <Mountain className="h-3 w-3 text-green-400" />,
  walking: <PersonStanding className="h-3 w-3 text-emerald-400" />,
  cycling: <Bike className="h-3 w-3 text-yellow-400" />,
  e_bike_fitness: <Bike className="h-3 w-3 text-yellow-400" />,
  lap_swimming: <Waves className="h-3 w-3 text-blue-400" />,
  indoor_cardio: <Heart className="h-3 w-3 text-red-400" />,
  treadmill_running: <Footprints className="h-3 w-3 text-green-400" />,
};

function getColor(types: string[]): string {
  if (types.length === 0) return "bg-muted/30";
  if (types.length > 1) return "bg-primary";
  return TYPE_COLORS[types[0]] || "bg-primary/70";
}

export function ActivityHeatmap({ data }: { data: DayData[] }) {
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);
  const [floatingMenu, setFloatingMenu] = useState<{
    activities: ActivityInfo[];
    x: number;
    y: number;
    date: string;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const dayLabels = ["Mon", "", "Wed", "", "Fri", "", "Sun"];

  // Go back 26 weeks
  const currentDay = today.getDay();
  const daysToMon = currentDay === 0 ? 6 : currentDay - 1;
  const thisMon = new Date(today);
  thisMon.setDate(thisMon.getDate() - daysToMon);
  const startMon = new Date(thisMon);
  startMon.setDate(startMon.getDate() - 25 * 7);

  // Build lookup
  const dayMap = new Map<string, DayData>();
  for (const d of data) {
    dayMap.set(d.date, d);
  }

  // Build weeks
  const weeks: (DayData | null)[][] = [];
  const d = new Date(startMon);
  while (d <= today) {
    const weekIdx = Math.floor(
      (d.getTime() - startMon.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
    if (!weeks[weekIdx]) weeks[weekIdx] = [];
    const dateStr = d.toISOString().split("T")[0];
    const dayOfWeek = d.getDay() === 0 ? 6 : d.getDay() - 1;
    const existing = dayMap.get(dateStr);
    weeks[weekIdx][dayOfWeek] = existing || { date: dateStr, count: 0, types: [], activities: [] };
    d.setDate(d.getDate() + 1);
  }

  // Month labels
  const monthLabels: { label: string; colStart: number }[] = [];
  let lastMonth = "";
  for (let w = 0; w < weeks.length; w++) {
    const firstDay = weeks[w]?.find(Boolean);
    if (firstDay) {
      const m = new Date(firstDay.date).toLocaleDateString("en-US", { month: "short" });
      if (m !== lastMonth) {
        monthLabels.push({ label: m, colStart: w });
        lastMonth = m;
      }
    }
  }

  const totalActive = data.filter((d) => d.count > 0).length;

  // Close floating menu on click outside
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      setFloatingMenu(null);
    }
  }, []);

  useEffect(() => {
    if (floatingMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [floatingMenu, handleClickOutside]);

  // Handle day click
  const handleDayClick = (cell: DayData, e: React.MouseEvent<HTMLDivElement>) => {
    if (cell.count === 0) return;

    if (cell.activities.length === 1) {
      // Single activity: open modal directly
      const activity = cell.activities[0];
      if (activity.type_key === "strength_training" && activity.workout_id) {
        setSelectedWorkoutId(activity.workout_id);
      } else {
        setSelectedActivityId(activity.activity_id);
      }
    } else {
      // Multi-activity: show floating menu
      const rect = e.currentTarget.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      setFloatingMenu({
        activities: cell.activities,
        x: rect.left - containerRect.left + rect.width / 2,
        y: rect.bottom - containerRect.top + 4,
        date: cell.date,
      });
    }
  };

  const handleMenuActivityClick = (activity: ActivityInfo) => {
    setFloatingMenu(null);
    if (activity.type_key === "strength_training" && activity.workout_id) {
      setSelectedWorkoutId(activity.workout_id);
    } else {
      setSelectedActivityId(activity.activity_id);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Month labels row */}
      <div className="flex ml-7 mb-1">
        {monthLabels.map((ml, i) => {
          const nextCol = i < monthLabels.length - 1 ? monthLabels[i + 1].colStart : weeks.length;
          const span = nextCol - ml.colStart;
          return (
            <div
              key={`${ml.label}-${ml.colStart}`}
              className="text-[10px] text-muted-foreground"
              style={{ flex: span }}
            >
              {ml.label}
            </div>
          );
        })}
      </div>

      {/* Grid: day labels + week columns */}
      <div className="flex gap-[2px]">
        {/* Day labels column */}
        <div className="flex flex-col gap-[2px] mr-0.5 shrink-0">
          {dayLabels.map((label, i) => (
            <div
              key={i}
              className="flex items-center justify-end"
              style={{ aspectRatio: "auto", minHeight: "14px" }}
            >
              <span className="text-[9px] text-muted-foreground w-5 text-right leading-none">
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Week columns */}
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[2px] flex-1 min-w-0">
            {Array.from({ length: 7 }, (_, di) => {
              const cell = week?.[di];
              if (!cell) {
                return (
                  <div key={di} className="w-full" style={{ aspectRatio: "1" }} />
                );
              }
              const color = cell.count > 0 ? getColor(cell.types) : "bg-muted/20";
              const isClickable = cell.count > 0;
              return (
                <div
                  key={di}
                  className={`w-full rounded-[2px] ${color} transition-all ${
                    isClickable
                      ? "cursor-pointer hover:ring-1 hover:ring-foreground/30 hover:brightness-110"
                      : "hover:bg-muted/40"
                  }`}
                  style={{ aspectRatio: "1" }}
                  title={`${cell.date}: ${
                    cell.count > 0
                      ? `${cell.count} ${cell.count === 1 ? "activity" : "activities"} (${cell.types.join(", ")})`
                      : "Rest day"
                  }`}
                  onClick={(e) => handleDayClick(cell, e)}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend row */}
      <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
        <span>{totalActive} active days in 6 months</span>
        <span className="ml-auto flex items-center gap-1">Less</span>
        <span className="w-[10px] h-[10px] rounded-[2px] bg-muted/20" />
        <span className="w-[10px] h-[10px] rounded-[2px] bg-primary/40" />
        <span className="w-[10px] h-[10px] rounded-[2px] bg-primary/70" />
        <span className="w-[10px] h-[10px] rounded-[2px] bg-primary" />
        <span>More</span>
      </div>

      {/* Floating menu for multi-activity days */}
      {floatingMenu && (
        <div
          ref={menuRef}
          className="absolute z-50 bg-popover border border-border rounded-lg shadow-lg p-1.5 min-w-[180px]"
          style={{
            left: `${floatingMenu.x}px`,
            top: `${floatingMenu.y}px`,
            transform: "translateX(-50%)",
          }}
        >
          <div className="text-[10px] text-muted-foreground px-2 py-1 border-b border-border mb-1">
            {new Date(floatingMenu.date).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </div>
          {floatingMenu.activities.map((activity, i) => {
            const icon = ACTIVITY_ICONS[activity.type_key] || (
              <Activity className="h-3 w-3 text-muted-foreground" />
            );
            const label = ACTIVITY_LABELS[activity.type_key] || activity.type_key.replace(/_/g, " ");
            return (
              <button
                key={i}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-accent/50 transition-colors text-left"
                onClick={() => handleMenuActivityClick(activity)}
              >
                {icon}
                <span className="truncate flex-1">{activity.name || label}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <ActivityDetailModal
        activityId={selectedActivityId}
        onClose={() => setSelectedActivityId(null)}
      />
      <WorkoutDetailModal
        workoutId={selectedWorkoutId}
        onClose={() => setSelectedWorkoutId(null)}
      />
    </div>
  );
}
