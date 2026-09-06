/**
 * How old may the heart-rate sample behind the Live DJ be before the screen
 * says so? (#668) The daemon accepts a Garmin sample up to a day old
 * (HR_WINDOW_SECONDS) so it can keep queueing through a slow sync, which is
 * fine for the queue and dishonest for the display: five minutes is the line
 * past which "HR 142" is no longer what your heart is doing.
 */
export const HR_STALE_SECONDS = 300;

export type HrAgeTone = "fresh" | "stale" | "old";

export function hrAgeTone(ageS: number | null | undefined): HrAgeTone {
  if (ageS == null) return "fresh";
  if (ageS >= 3600) return "old";
  if (ageS > HR_STALE_SECONDS) return "stale";
  return "fresh";
}

export function hrAgeLabel(ageS: number | null | undefined): string {
  if (ageS == null) return "";
  if (ageS < 120) return "just now";
  if (ageS <= HR_STALE_SECONDS) return `${Math.round(ageS / 60)}m ago`;
  if (ageS < 3600) return `${Math.round(ageS / 60)}m ago · stale`;
  return `${Math.round(ageS / 3600)}h ago · stale`;
}
