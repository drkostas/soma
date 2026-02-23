"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { WorkoutDetailModal } from "./workout-detail-modal";

interface CalendarDay {
  day: string | Date; // YYYY-MM-DD or Date from pg
  program: string;
  hevy_id: string;
}

interface Props {
  data: CalendarDay[];
}

const PROGRAM_PALETTE = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#f97316", // orange
  "#a855f7", // purple
  "#06b6d4", // cyan
  "#f43f5e", // rose
  "#eab308", // yellow
  "#10b981", // emerald
];

export function WorkoutCalendar({ data }: Props) {
  const [weeksBack, setWeeksBack] = useState(0); // 0 = current 26 weeks
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    date: string;
    program: string;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const WEEKS_SHOWN = 26;

  // Build program → color map
  const programColors = useMemo(() => {
    const colors: Record<string, string> = {};
    let idx = 0;
    for (const c of data) {
      if (c.program && !colors[c.program]) {
        colors[c.program] = PROGRAM_PALETTE[idx % PROGRAM_PALETTE.length];
        idx++;
      }
    }
    return colors;
  }, [data]);

  // Build day lookup: date → CalendarDay[]
  const dayMap = useMemo(() => {
    const map = new Map<string, CalendarDay[]>();
    for (const c of data) {
      const d = c.day instanceof Date
        ? (c.day as Date).toISOString().split("T")[0]
        : String(c.day).slice(0, 10);
      const existing = map.get(d) || [];
      existing.push({ ...c, day: d });
      map.set(d, existing);
    }
    return map;
  }, [data]);

  // Compute the date range for the current view
  const { startMon, endDate, weeks } = useMemo(() => {
    const today = new Date();
    const currentDay = today.getDay();
    const daysToMon = currentDay === 0 ? 6 : currentDay - 1;

    // Current week's Monday
    const thisMon = new Date(today);
    thisMon.setDate(thisMon.getDate() - daysToMon);

    // Apply navigation offset
    const viewEndMon = new Date(thisMon);
    viewEndMon.setDate(viewEndMon.getDate() - weeksBack * 7);

    const viewStartMon = new Date(viewEndMon);
    viewStartMon.setDate(viewStartMon.getDate() - (WEEKS_SHOWN - 1) * 7);

    // End of view
    const viewEnd = new Date(viewEndMon);
    viewEnd.setDate(viewEnd.getDate() + 6); // Sunday of last week

    // Clamp to today
    const clampedEnd = viewEnd > today ? today : viewEnd;

    // Build weeks array
    const weeksArr: ({ date: string; workouts: CalendarDay[] } | null)[][] = [];
    const d = new Date(viewStartMon);
    while (d <= clampedEnd) {
      const weekIdx = Math.floor(
        (d.getTime() - viewStartMon.getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      if (!weeksArr[weekIdx]) weeksArr[weekIdx] = [];
      const dateStr = d.toISOString().split("T")[0];
      const dayOfWeek = d.getDay() === 0 ? 6 : d.getDay() - 1;
      weeksArr[weekIdx][dayOfWeek] = {
        date: dateStr,
        workouts: dayMap.get(dateStr) || [],
      };
      d.setDate(d.getDate() + 1);
    }

    return { startMon: viewStartMon, endDate: clampedEnd, weeks: weeksArr };
  }, [weeksBack, dayMap]);

  // Month labels
  const monthLabels = useMemo(() => {
    const labels: { label: string; colStart: number }[] = [];
    let lastMonth = "";
    for (let w = 0; w < weeks.length; w++) {
      const firstDay = weeks[w]?.find(Boolean);
      if (firstDay) {
        const md = new Date(firstDay.date);
        const m = md.toLocaleDateString("en-US", { month: "short" });
        const y = md.getFullYear();
        const key = `${m} ${y}`;
        if (key !== lastMonth) {
          // Show year if it's different from current year
          const now = new Date();
          const label = y !== now.getFullYear() ? `${m} '${String(y).slice(-2)}` : m;
          labels.push({ label, colStart: w });
          lastMonth = key;
        }
      }
    }
    return labels;
  }, [weeks]);

  // Stats for the view
  const viewStats = useMemo(() => {
    let activeDays = 0;
    for (const week of weeks) {
      if (!week) continue;
      for (const cell of week) {
        if (cell && cell.workouts.length > 0) activeDays++;
      }
    }
    return { activeDays };
  }, [weeks]);

  const dayLabels = ["Mon", "", "Wed", "", "Fri", "", "Sun"];

  // Can navigate?
  const hasOlderData = useMemo(() => {
    if (data.length === 0) return false;
    const dates = data.map(d => {
      const dd = d.day instanceof Date ? d.day : new Date(String(d.day));
      return dd.getTime();
    });
    const earliest = new Date(Math.min(...dates));
    return startMon > earliest;
  }, [data, startMon]);

  const canGoNewer = weeksBack > 0;

  const handleDayClick = (workouts: CalendarDay[]) => {
    if (workouts.length === 0) return;
    // Open the first workout (most common case: 1 workout per day)
    setSelectedWorkoutId(workouts[0].hevy_id);
  };

  // Close tooltip on scroll/resize
  useEffect(() => {
    const close = () => setTooltip(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative">
      {/* Navigation header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeeksBack(w => w + WEEKS_SHOWN)}
            disabled={!hasOlderData}
            className="p-1 rounded-md hover:bg-accent/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Earlier"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setWeeksBack(w => Math.max(0, w - WEEKS_SHOWN))}
            disabled={!canGoNewer}
            className="p-1 rounded-md hover:bg-accent/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Later"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {weeksBack > 0 && (
            <button
              onClick={() => setWeeksBack(0)}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded border border-border/50"
            >
              Today
            </button>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {viewStats.activeDays} sessions in {WEEKS_SHOWN} weeks
        </span>
      </div>

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

      {/* Grid */}
      <div className="flex gap-[2px]">
        {/* Day labels */}
        <div className="flex flex-col gap-[2px] mr-0.5 shrink-0">
          {dayLabels.map((label, i) => (
            <div
              key={i}
              className="flex items-center justify-end"
              style={{ minHeight: "14px", aspectRatio: "auto" }}
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
                return <div key={di} className="w-full" style={{ aspectRatio: "1" }} />;
              }
              const count = cell.workouts.length;
              const isActive = count > 0;
              const program = cell.workouts[0]?.program;
              const color = program ? programColors[program] : undefined;
              const opacity = count >= 3 ? 1.0 : count >= 2 ? 0.75 : count >= 1 ? 0.5 : 0;

              return (
                <div
                  key={di}
                  className={`w-full rounded-[2px] transition-all ${
                    !isActive ? "bg-muted/20" : ""
                  } ${
                    isActive
                      ? "cursor-pointer hover:ring-1 hover:ring-foreground/30 hover:brightness-110"
                      : "hover:bg-muted/40"
                  }`}
                  style={{
                    aspectRatio: "1",
                    ...(isActive && color
                      ? { backgroundColor: color, opacity }
                      : isActive
                        ? { backgroundColor: "var(--primary)", opacity }
                        : {}),
                  }}
                  title={`${cell.date}${program ? ` — ${program}` : ""}${count > 1 ? ` (${count} workouts)` : ""}`}
                  onClick={() => handleDayClick(cell.workouts)}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10px] text-muted-foreground">
        {Object.entries(programColors).map(([program, color]) => (
          <span key={program} className="flex items-center gap-1">
            <span
              className="w-[10px] h-[10px] rounded-[2px]"
              style={{ backgroundColor: color, opacity: 0.75 }}
            />
            {program}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="w-[10px] h-[10px] rounded-[2px] bg-muted/40" />
          Rest
        </span>
      </div>

      {/* Workout detail modal */}
      <WorkoutDetailModal
        workoutId={selectedWorkoutId}
        onClose={() => setSelectedWorkoutId(null)}
      />
    </div>
  );
}
