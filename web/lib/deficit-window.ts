import { meetsCoverageFloor, daysBetween, STREAK_MAX_GAP_DAYS } from "@/lib/coverage";

/**
 * The current deficit window (#728). The #699 rule, applied to the trajectory:
 * a day COUNTS only when it is closed and its logging coverage clears the
 * floor; a run of counted days is one window as long as no two of them are
 * more than STREAK_MAX_GAP_DAYS apart. Everything summed for the user — the
 * cumulative deficit, the average, the projected weight — is summed over the
 * latest window only, and the page says which window that is.
 *
 * Without this the cumulative line walked from March across four empty months
 * to −49k and the header claimed "916/day avg (45d)" over a diet nobody was on.
 */
export interface WindowDay {
  date: string;
  closed: boolean;
  coverage: number | null;
  /** consumed − burn for the day; negative is a deficit. */
  deficit: number;
}

export interface DeficitWindow {
  /** First and last counted date of the latest window; null when no day ever counted. */
  start: string | null;
  end: string | null;
  countedDays: number;
  /** Sum of deficits over counted days in the window, positive = achieved deficit. */
  totalDeficit: number;
  avgDeficit: number | null;
  /** True when the window's last counted day is within the gap of today. */
  active: boolean;
  /** Dates that count (closed + coverage) and belong to the window. */
  countedDates: ReadonlySet<string>;
  /** All dates that count, any window (for chart segmentation). */
  allCountedDates: ReadonlySet<string>;
}

export function countsForDeficit(d: WindowDay): boolean {
  return d.closed && meetsCoverageFloor(d.coverage);
}

export function deficitWindow(days: readonly WindowDay[], today: string, maxGap: number = STREAK_MAX_GAP_DAYS): DeficitWindow {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const counted = sorted.filter(countsForDeficit);
  const allCountedDates = new Set(counted.map((d) => d.date));
  if (counted.length === 0) {
    return { start: null, end: null, countedDays: 0, totalDeficit: 0, avgDeficit: null, active: false, countedDates: new Set(), allCountedDates };
  }
  // Walk back from the latest counted day; stop at the first gap wider than maxGap.
  const window: WindowDay[] = [];
  for (let i = counted.length - 1; i >= 0; i--) {
    const d = counted[i];
    if (window.length && daysBetween(d.date, window[window.length - 1].date) > maxGap) break;
    window.push(d);
  }
  window.reverse();
  const total = window.reduce((s, d) => s + d.deficit, 0);
  const end = window[window.length - 1].date;
  return {
    start: window[0].date,
    end,
    countedDays: window.length,
    totalDeficit: Math.round(-total),
    avgDeficit: Math.round(-total / window.length),
    active: daysBetween(end, today) <= maxGap,
    countedDates: new Set(window.map((d) => d.date)),
    allCountedDates,
  };
}

/** "since 2026-03-14, 45 counted days" / "no counted day since 2026-05-12" / "no counted day yet". */
export function windowLabel(w: DeficitWindow): string {
  if (!w.end) return "no counted day yet";
  if (!w.active) return `no counted day since ${w.end}`;
  return `since ${w.start}, ${w.countedDays} counted day${w.countedDays === 1 ? "" : "s"}`;
}
