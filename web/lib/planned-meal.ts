import { todayAthlete } from "./athlete-tz";

/** A meal logged on a future date is a plan, not a record (soma#873). */
export function isPlannedDate(date: string, today: string = todayAthlete()): boolean {
  return date > today;
}
