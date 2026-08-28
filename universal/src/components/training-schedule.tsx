import { useMemo, useState } from "react";
import { View, Pressable } from "react-native";
import { Text, Card } from "soma-style";
import { requestGarminPush, type ActivityMatch, type PlanDay, type WorkoutStep } from "../lib/api";
import { getBasePace, getHRZone } from "../lib/vdot-pace-zones";
import { TRAFFIC_COLOR, type ProjectedDay } from "../lib/project-days";
import { MatchedActivityPanel } from "./matched-activity-panel";

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

/** Seconds/km → "M:SS". */
function paceStr(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
const scoreColor = (s: number) => (s >= 80 ? "#6ad4a0" : s >= 60 ? "#e0c458" : "#e06060");

function DayRow({
  day,
  isToday,
  match,
  vdot,
  proj,
  onToggleComplete,
  onOpenMatch,
}: {
  day: PlanDay;
  isToday: boolean;
  match?: ActivityMatch;
  vdot: number | null;
  proj?: ProjectedDay;
  onToggleComplete: (day: PlanDay) => void;
  onOpenMatch?: (day: PlanDay, match: ActivityMatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pushOverride, setPushOverride] = useState<string | null>(null);
  const steps = day.workoutSteps ?? [];
  const status = pushOverride ?? day.garminPushStatus;
  const pushed = status === "pushed" || status === "success";
  const pending = status === "pending";
  const failed = status === "failed" || status === "error";
  const canPush = steps.length > 0 && !pushed && !pending;
  const act = match?.matched ? match.activity : null;

  async function onPush() {
    setPushOverride("pending"); // optimistic; the plan-push cron completes it
    const ok = await requestGarminPush(day.id);
    if (!ok) setPushOverride(day.garminPushStatus ?? null);
  }

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

        {/* main tap target: expand steps + match details */}
        <Pressable className="flex-1" onPress={() => (steps.length || act) && setOpen((o) => !o)}>
          <View className="flex-row items-center gap-2">
            <Text variant="micro" className={isToday ? "text-teal" : "text-text-muted"}>
              {isToday ? "TODAY" : shortDate(day.dayDate)}
            </Text>
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: runColor(day.runType) + "22" }}>
              <Text variant="micro" style={{ color: runColor(day.runType) }}>{day.runType}</Text>
            </View>
            {match?.matched && match.completionScore != null ? (
              <Pressable onPress={() => onOpenMatch?.(day, match)} hitSlop={6}>
                <View className="flex-row items-center gap-0.5 rounded-full px-2 py-0.5" style={{ backgroundColor: scoreColor(match.completionScore) + "22" }}>
                  <Text variant="micro" style={{ color: scoreColor(match.completionScore) }}>{match.completionScore}%</Text>
                  <Text variant="micro" style={{ color: scoreColor(match.completionScore) }}>›</Text>
                </View>
              </Pressable>
            ) : null}
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
          {/* Target pace + HR zone for run days. When the forward simulation has
              projected this day, show its readiness-ADJUSTED pace + traffic light
              (or a REST signal); otherwise the base VDOT pace. */}
          {day.runType && day.runType.toLowerCase() !== "rest" && (day.targetDistanceKm ?? 0) > 0 ? (() => {
            const hz = getHRZone(day.runType);
            if (proj) {
              if (proj.adjustedPace == null) {
                return <Text variant="micro" className="mt-0.5" style={{ color: "#e06060" }}>⛔ REST — readiness critical</Text>;
              }
              const tl = TRAFFIC_COLOR[proj.trafficLight] ?? "#77c8d1";
              const changed = Math.abs(proj.paceChangePct) >= 0.5;
              return (
                <View className="flex-row flex-wrap items-center gap-x-2 mt-0.5">
                  <View className="flex-row items-center gap-1">
                    <View className="h-2 w-2 rounded-full" style={{ backgroundColor: tl }} />
                    <Text variant="micro" className="tabular-nums" style={{ color: tl }}>{paceStr(proj.adjustedPace)}/km</Text>
                  </View>
                  {changed ? <Text variant="micro" className="tabular-nums text-text-muted">{proj.paceChangePct > 0 ? "+" : ""}{proj.paceChangePct}% vs base</Text> : null}
                  <Text variant="micro" className="text-text-muted">·</Text>
                  <Text variant="micro" className="tabular-nums text-text-muted">HR {hz.zone} {hz.low}–{hz.high}</Text>
                </View>
              );
            }
            if (vdot == null) return null;
            return (
              <View className="flex-row items-center gap-2 mt-0.5">
                <Text variant="micro" className="tabular-nums" style={{ color: runColor(day.runType) }}>{paceStr(getBasePace(vdot, day.runType))}/km</Text>
                <Text variant="micro" className="text-text-muted">·</Text>
                <Text variant="micro" className="tabular-nums text-text-muted">HR {hz.zone} {hz.low}–{hz.high}</Text>
              </View>
            );
          })() : null}
          {/* garmin sync status + manual push/retry (queues for the plan-push cron) */}
          {pushed ? (
            <Text variant="micro" className="text-success mt-0.5">✓ On Garmin</Text>
          ) : pending ? (
            <Text variant="micro" className="text-warning mt-0.5">⏳ Syncing to Garmin</Text>
          ) : failed ? (
            <Pressable onPress={onPush} hitSlop={6}>
              <Text variant="micro" className="text-danger mt-0.5">✕ Push failed — tap to retry</Text>
            </Pressable>
          ) : canPush ? (
            <Pressable onPress={onPush} hitSlop={6}>
              <Text variant="micro" className="text-teal mt-0.5">↑ Push to Garmin</Text>
            </Pressable>
          ) : null}
        </Pressable>
      </View>

      {/* expandable workout steps + matched-activity detail */}
      {open ? (
        <View className="mt-2 ml-9 gap-1">
          {steps.map((s, i) => (
            <View key={i} className="flex-row items-start gap-2">
              <View className="mt-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: runColor(day.runType) }} />
              <Text variant="micro" className="text-text-secondary flex-1">{stepLine(s)}</Text>
            </View>
          ))}
          {day.gymNotes ? <Text variant="micro" className="text-text-muted mt-1">Gym: {day.gymNotes}</Text> : null}
          {act ? (
            <View className="mt-1.5 rounded-lg bg-surface-subtle px-2.5 py-2 gap-0.5">
              <View className="flex-row items-center justify-between">
                <Text variant="micro" className="text-text-muted">MATCHED GARMIN ACTIVITY</Text>
                {match?.completionScore != null ? (
                  <Text variant="micro" style={{ color: scoreColor(match.completionScore) }}>{match.completionScore}% of plan</Text>
                ) : null}
              </View>
              <Text variant="micro" className="text-text-secondary">
                {act.distance_km != null ? `${Number(act.distance_km).toFixed(1)} km` : ""}
                {act.duration_min != null ? ` · ${Math.round(Number(act.duration_min))} min` : ""}
                {act.avg_pace_sec_km != null ? ` · ${paceStr(act.avg_pace_sec_km)}/km` : ""}
              </Text>
              <Text variant="micro" className="text-text-muted">
                {act.avg_hr != null ? `HR ${act.avg_hr}` : ""}
                {act.max_hr != null ? ` (max ${act.max_hr})` : ""}
                {act.calories != null ? ` · ${act.calories} kcal` : ""}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function TrainingSchedule({
  planDays,
  today,
  matches,
  vdot = null,
  projected,
  onToggleComplete,
}: {
  planDays: PlanDay[];
  today: string;
  matches?: Record<number, ActivityMatch>;
  vdot?: number | null;
  projected?: Map<number, ProjectedDay> | null;
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
  const [openMatch, setOpenMatch] = useState<{ day: PlanDay; match: ActivityMatch } | null>(null);

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
                  <DayRow key={d.id} day={d} isToday={d.dayDate === today} match={matches?.[d.id]} vdot={vdot} proj={projected?.get(d.id)} onToggleComplete={onToggleComplete}
                    onOpenMatch={(day, match) => setOpenMatch({ day, match })} />
                ))}
              </View>
            ) : null}
          </Card>
        );
      })}
      <MatchedActivityPanel match={openMatch?.match ?? null} day={openMatch?.day ?? null} onClose={() => setOpenMatch(null)} />
    </View>
  );
}
