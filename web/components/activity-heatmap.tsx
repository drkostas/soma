"use client";

interface DayData {
  date: string;
  count: number;
  types: string[];
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
};

function getColor(types: string[]): string {
  if (types.length === 0) return "bg-muted/30";
  // Multi-activity day
  if (types.length > 1) return "bg-primary";
  return TYPE_COLORS[types[0]] || "bg-primary/70";
}

export function ActivityHeatmap({ data }: { data: DayData[] }) {
  const today = new Date();
  const dayLabels = ["", "Mon", "", "Wed", "", "Fri", ""];

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
    weeks[weekIdx][dayOfWeek] = existing || { date: dateStr, count: 0, types: [] };
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

  return (
    <div>
      <div className="overflow-x-auto">
        {/* Month labels */}
        <div className="flex ml-8 mb-1">
          {monthLabels.map((ml, i) => {
            const nextCol = i < monthLabels.length - 1 ? monthLabels[i + 1].colStart : weeks.length;
            const span = nextCol - ml.colStart;
            return (
              <div
                key={`${ml.label}-${ml.colStart}`}
                className="text-[10px] text-muted-foreground"
                style={{ width: `${span * 14}px` }}
              >
                {ml.label}
              </div>
            );
          })}
        </div>
        <div className="flex gap-0">
          <div className="flex flex-col gap-[2px] mr-1">
            {dayLabels.map((label, i) => (
              <div key={i} className="h-[12px] flex items-center">
                <span className="text-[9px] text-muted-foreground w-6 text-right">{label}</span>
              </div>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[2px]">
              {Array.from({ length: 7 }, (_, di) => {
                const cell = week?.[di];
                if (!cell) return <div key={di} className="w-[12px] h-[12px]" />;
                const color = cell.count > 0 ? getColor(cell.types) : "bg-muted/20";
                return (
                  <div
                    key={di}
                    className={`w-[12px] h-[12px] rounded-[2px] ${color} ${
                      cell.count > 0 ? "hover:opacity-80" : "hover:bg-muted/40"
                    } transition-opacity`}
                    title={`${cell.date}: ${cell.count > 0 ? `${cell.count} ${cell.count === 1 ? "activity" : "activities"}` : "Rest day"}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
        <span>{totalActive} active days in 6 months</span>
        <span className="ml-auto flex items-center gap-1">Less</span>
        <span className="w-[10px] h-[10px] rounded-[2px] bg-muted/20" />
        <span className="w-[10px] h-[10px] rounded-[2px] bg-primary/40" />
        <span className="w-[10px] h-[10px] rounded-[2px] bg-primary/70" />
        <span className="w-[10px] h-[10px] rounded-[2px] bg-primary" />
        <span>More</span>
      </div>
    </div>
  );
}
