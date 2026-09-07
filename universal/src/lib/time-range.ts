import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** The 10 time ranges, matching web/lib/time-ranges.ts (same tokens hit the same
 *  backend routes, which parse them through parseRangeDays). */
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

export const DEFAULT_RANGE = "6m";

export function rangeToDays(range: string | undefined): number {
  if (!range) return 180;
  const f = RANGES.find((r) => r.value === range);
  return f ? f.days : 180;
}

export function rangeLabel(range: string): string {
  return RANGES.find((r) => r.value === range)?.label ?? range;
}

export function isRangeKey(v: unknown): v is string {
  return typeof v === "string" && RANGES.some((r) => r.value === v);
}

/* ---- one shared, persisted range (soma#754) ----
   Web keeps the choice in localStorage["soma_time_range"] and carries it across pages.
   The app does the same: one module-level value every screen subscribes to, written to
   AsyncStorage (localStorage on Expo web) and read back once at startup, so 1W chosen on
   Running is what Activities opens with, today and after a cold start. */
const STORAGE_KEY = "soma_time_range";
let current = DEFAULT_RANGE;
let hydrated = false;
let touched = false; // a choice made before the stored value arrives must win
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function getRangePref(): string { return current; }
export function isRangeHydrated(): boolean { return hydrated; }

export function setRangePref(next: string): void {
  if (!isRangeKey(next) || next === current) return;
  current = next;
  touched = true;
  emit();
  AsyncStorage.setItem(STORAGE_KEY, next).catch(() => { /* storage unavailable: in-memory only */ });
}

/** Read the stored choice once. Safe to call many times; resolves after the first read. */
export function hydrateRangePref(): Promise<void> {
  if (!hydration) {
    hydration = AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => { if (!touched && isRangeKey(v) && v !== current) current = v; })
      .catch(() => { /* keep the default */ })
      .then(() => { hydrated = true; emit(); });
  }
  return hydration;
}

/** [range, setRange] — shared across screens and sessions. */
export function useRangePref(): [string, (r: string) => void] {
  const range = useSyncExternalStore(subscribe, getRangePref, getRangePref);
  return [range, setRangePref];
}

export function useRangeHydrated(): boolean {
  return useSyncExternalStore(subscribe, isRangeHydrated, isRangeHydrated);
}

/** Test hook: forget everything (module state survives between vitest cases). */
export function __resetRangePrefForTests(): void {
  current = DEFAULT_RANGE; hydrated = false; touched = false; hydration = null; listeners.clear();
}
