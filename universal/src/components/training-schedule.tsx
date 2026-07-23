import { useMemo, useState } from "react";
import { View, Pressable } from "react-native";
import { Text, Card } from "soma-style";
import type { PlanDay, WorkoutStep } from "../lib/api";

/* Run-type → colour, matching the web training plan (easy green, quality orange,
   long blue, rest grey). Used for the small type pill on each day row. */
const RUN_COLOR: Record<string, string> = {
  easy: "#6ad4a0",
  recovery: "#6ad4a0",
  tempo: "#e0a458",
  threshold: "#e0a458",
  intervals: "#e0a458",
  interval: "#e0a458",
  repetition: "#e0a458",
  long: "#6aa0e0",
  race: "#c77dff",
  rest: "#5a7a8a",
};
const runColor = (t: string) => RUN_COLOR[t?.toLowerCase()] ?? "#77c8d1";

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** One workout step rendered as "warmup · Easy run · 6.5 km · Z2". */
function stepLine(s: WorkoutStep): string {
  const parts: string[] = [];
  if (s.step_type) parts.push(s.step_type);
  if (s.description) parts.push(s.description);
  if (s.duration_type === "distance" && s.duration_value != null) {
    parts.push(s.duration_value >= 1000 ? `${(s.duration_value / 1000).toFixed(s.duration_value % 1000 ? 1 : 0)} km` : `${s.duration_value} m`);
  } else if (s.duration_type === "time" && s.duration_value != null) {
    parts.push(`${Math.round(s.duration_value / 60)} min`);
  }
  if (s.hr_zone != null) parts.push(`Z${s.hr_zone}`);
  return parts.join(" · ");
}

function DayRow({
  day,
  isToday,
  onToggleComplete,
}: {
  day: PlanDay;
  isToday: boolean;
  onToggleComplete: (day: PlanDay) => void;
}) {
  const [open, setOpen] = useState(false);
  const steps = day.workoutSteps ?? [];
  const pushed = day.garminPushStatus === "pushed" || day.garminPushStatus === "success";
  const pending = day.garminPushStatus === "pending";

  return (
    <View className="border-b border-border-subtle py-2.5">
      <View className="flex-row items-center gap-3">
        {/* completion checkbox */}
        <Pressable
          onPress={() => onToggleComplete(day)}
          hitSlop={8}
          className="h-6 w-6 items-center justify-center rounded-full border"
          style={{
            borderColor: day.completed ? "#6ad4a0" : "#2a3a48",
            backgroundColor: day.completed ? "#6ad4a022" : "transparent",
          }}
        >
          {day.completed ? <Text style={{ color: "#6ad4a0", fontSize: 13 }}>✓</Text> : null}
        </Pressable>

        {/* main tap target: expand steps */}
        <Pressable className="flex-1" onPress={() => steps.length && setOpen((o) => !o)}>
          <View className="flex-row items-center gap-2">
            <Text variant="micro" className={isToday ? "text-teal" : "text-text-muted"}>
              {isToday ? "TODAY" : shortDate(day.dayDate)}
            </Text>
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: runColor(day.runType) + "22" }}>
              <Text variant="micro" style={{ color: runColor(day.runType) }}>{day.runType}</Text>
            </View>
            {day.gymWorkout ? (
              <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: "#6366b022" }}>
                <Text variant="micro" style={{ color: "#8a8dd0" }}>🏋 {day.gymWorkout}</Text>
              </View>
            ) : null}
          </View>
          <View className="flex-row items-center justify-between mt-0.5">
            <Text
              variant="body"
              className={day.completed ? "text-text-muted line-through" : "text-text"}
              numberOfLines={1}
              style={{ flex: 1 }}
            >
              {day.runTitle}
            </Text>
            {day.targetDistanceKm != null ? (
              <Text variant="caption" className="tabular-nums text-text-secondary ml-2">{day.targetDistanceKm} km</Text>
            ) : null}
          </View>
          {/* garmin sync status */}
          {pushed ? (
            <Text variant="micro" className="text-success mt-0.5">✓ On Garmin</Text>
          ) : pending ? (
            <Text variant="micro" className="text-warning mt-0.5">⏳ Syncing to Garmin</Text>
          ) : null}
        </Pressable>
      </View>

      {/* expandable workout steps */}
      {open && steps.length ? (
        <View className="mt-2 ml-9 gap-1">
          {steps.map((s, i) => (
            <View key={i} className="flex-row items-start gap-2">
              <View className="mt-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: runColor(day.runType) }} />
              <Text variant="micro" className="text-text-secondary flex-1">{stepLine(s)}</Text>
            </View>
          ))}
          {day.gymNotes ? <Text variant="micro" className="text-text-muted mt-1">Gym: {day.gymNotes}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

export function TrainingSchedule({
  planDays,
  today,
  onToggleComplete,
}: {
  planDays: PlanDay[];
  today: string;
  onToggleComplete: (day: PlanDay) => void;
}) {
  // group by week
  const weeks = useMemo(() => {
    const map = new Map<number, PlanDay[]>();
    for (const d of planDays) {
      const arr = map.get(d.weekNumber) ?? [];
      arr.push(d);
      map.set(d.weekNumber, arr);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([week, days]) => ({ week, days: days.sort((a, b) => a.dayDate.localeCompare(b.dayDate)) }));
  }, [planDays]);

  const currentWeek = useMemo(
    () => planDays.find((d) => d.dayDate === today)?.weekNumber ?? weeks[0]?.week,
    [planDays, today, weeks],
  );
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(currentWeek != null ? [currentWeek] : []));

  const toggleWeek = (w: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(w) ? next.delete(w) : next.add(w);
      return next;
    });

  if (!planDays.length) return null;

  return (
    <View className="gap-3">
      <Text variant="eyebrow" className="text-text-muted">Training plan</Text>
      {weeks.map(({ week, days }) => {
        const done = days.filter((d) => d.completed).length;
        const runDays = days.filter((d) => d.runType !== "rest").length;
        const km = days.reduce((s, d) => s + (d.targetDistanceKm ?? 0), 0);
        const pct = days.length ? done / days.length : 0;
        const isOpen = expanded.has(week);
        const isCurrent = week === currentWeek;
        return (
          <Card key={week} className="gap-2">
            <Pressable onPress={() => toggleWeek(week)} className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                {isCurrent ? <View className="h-2 w-2 rounded-full" style={{ backgroundColor: "#77c8d1" }} /> : null}
                <Text variant="body" className="text-text">Week {week}</Text>
              </View>
              <View className="flex-row items-center gap-2">
                <Text variant="micro" className="tabular-nums text-text-muted">
                  {km.toFixed(0)} km · {runDays} runs · {done}/{days.length} done
                </Text>
                <Text variant="micro" className="text-text-muted">{isOpen ? "▲" : "▼"}</Text>
              </View>
            </Pressable>
            {/* completion progress */}
            <View className="h-1.5 rounded-full bg-surface-subtle overflow-hidden">
              <View className="h-full rounded-full" style={{ width: `${Math.round(pct * 100)}%`, backgroundColor: pct >= 1 ? "#6ad4a0" : "#6366b0" }} />
            </View>
            {isOpen ? (
              <View className="mt-1">
                {days.map((d) => (
                  <DayRow key={d.id} day={d} isToday={d.dayDate === today} onToggleComplete={onToggleComplete} />
                ))}
              </View>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}
