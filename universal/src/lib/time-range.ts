import { useState } from "react";

/** The 10 time ranges, matching web/lib/time-ranges.ts (same tokens hit the same
 *  :3456 backend). */
export interface TimeRange { label: string; value: string; days: number; }
export const RANGES: TimeRange[] = [
  { label: "1W", value: "1w", days: 7 },
  { label: "2W", value: "2w", days: 14 },
  { label: "1M", value: "1m", days: 30 },
  { label: "3M", value: "3m", days: 90 },
  { label: "6M", value: "6m", days: 180 },
  { label: "9M", value: "9m", days: 270 },
  { label: "1Y", value: "1y", days: 365 },
  { label: "2Y", value: "2y", days: 730 },
  { label: "3Y", value: "3y", days: 1095 },
  { label: "All", value: "all", days: 3650 },
];

export function rangeToDays(range: string | undefined): number {
  if (!range) return 180;
  const f = RANGES.find((r) => r.value === range);
  return f ? f.days : 180;
}

export function rangeLabel(range: string): string {
  return RANGES.find((r) => r.value === range)?.label ?? range;
}

/** Clamp a range to the nearest token the /api/stats/* endpoint accepts
 *  (only 7d/30d/90d/1y). Used where a shared range must call that endpoint. */
export function statsRange(range: string): string {
  const d = rangeToDays(range);
  if (d <= 10) return "7d";
  if (d <= 45) return "30d";
  if (d <= 200) return "90d";
  return "1y";
}

const STORAGE_KEY = "soma_time_range";

/** Shared, persisted selected time range — mirrors the web's single
 *  `localStorage["soma_time_range"]` so the choice carries across screens and
 *  sessions. Falls back to in-memory on native (until AsyncStorage is added). */
export function useRangePref(defaultRange = "6m"): [string, (r: string) => void] {
  const [range, setRangeState] = useState<string>(() => {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      if (raw && RANGES.some((r) => r.value === raw)) return raw;
    } catch { /* native / unavailable */ }
    return defaultRange;
  });
  const setRange = (r: string) => {
    setRangeState(r);
    try { if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, r); } catch { /* native */ }
  };
  return [range, setRange];
}
