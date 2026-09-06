import { daysBetween } from "@/lib/coverage";

/**
 * A running-only status for the Running page (#738).
 *
 * Garmin's "Training Status: Productive" is computed over every activity and
 * only TAGGED with a sport; in a month of nine kite sessions and five short
 * runs it still says Productive next to a mileage chart falling to nothing.
 * This is the run-only reading, from soma's own running load (training_load,
 * source garmin_running): acute = last 7 days, chronic = last 28, both per
 * day, and a verdict only when there is enough running to call a trend.
 */
export interface RunLoadDay {
  date: string;
  load: number;
}

export type RunStatusKind = "none" | "lapsed" | "light" | "easing" | "steady" | "building" | "spiking";

export interface RunStatus {
  kind: RunStatusKind;
  label: string;
  detail: string;
  runs28: number;
  lastRun: string | null;
  daysSinceRun: number | null;
  /** load per day over the last 7 / 28 days */
  acute: number;
  chronic: number;
  /** acute / chronic, null when chronic is 0 */
  acwr: number | null;
}

/** Fewer runs than this in 28 days is too little to call a trend (2 a week). */
export const RUN_TREND_MIN_RUNS = 8;
/** No run for more than this many days reads as "not running lately". */
export const RUN_LAPSED_DAYS = 14;

export function runStatus(days: readonly RunLoadDay[], today: string): RunStatus {
  const recent = days.filter((d) => daysBetween(d.date, today) >= 0 && daysBetween(d.date, today) < 28);
  const last7 = recent.filter((d) => daysBetween(d.date, today) < 7);
  const acute = Math.round((last7.reduce((s, d) => s + d.load, 0) / 7) * 10) / 10;
  const chronic = Math.round((recent.reduce((s, d) => s + d.load, 0) / 28) * 10) / 10;
  const acwr = chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : null;
  const all = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const lastRun = all.length ? all[all.length - 1].date : null;
  const daysSinceRun = lastRun ? daysBetween(lastRun, today) : null;
  const runs28 = recent.length;
  const base = { runs28, lastRun, daysSinceRun, acute, chronic, acwr };

  if (!lastRun || daysSinceRun == null || runs28 === 0) {
    return { ...base, kind: "none", label: "No runs in 4 weeks", detail: lastRun ? `last run ${lastRun}` : "no run recorded" };
  }
  if (daysSinceRun > RUN_LAPSED_DAYS) {
    return { ...base, kind: "lapsed", label: "Not running lately", detail: `last run ${lastRun}, ${daysSinceRun} days ago` };
  }
  if (runs28 < RUN_TREND_MIN_RUNS) {
    return { ...base, kind: "light", label: "Light", detail: `${runs28} run${runs28 === 1 ? "" : "s"} in 4 weeks, too few to call a trend` };
  }
  const detail = `${runs28} runs in 4 weeks · load ${acute}/day vs ${chronic}/day (ACWR ${acwr})`;
  if (acwr == null || acwr < 0.8) return { ...base, kind: "easing", label: "Easing off", detail };
  if (acwr <= 1.3) return { ...base, kind: "steady", label: "Steady", detail };
  if (acwr <= 1.5) return { ...base, kind: "building", label: "Building", detail };
  return { ...base, kind: "spiking", label: "Spiking", detail };
}
