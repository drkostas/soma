import { useEffect, useState } from "react";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3456";

export interface MacroSet {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export interface SomaPlan {
  plan: { target_calories: number; target_protein: number; target_carbs: number; target_fat: number; target_fiber: number };
  consumed: MacroSet;
  remaining: MacroSet;
  slotBudgets: Record<string, { calories: number; protein?: number; carbs?: number; fat?: number; fiber?: number }>;
  breakdown?: { totalBurn?: number; bmr?: number };
  adaptive: { effectiveTdee: number; reportedTdee: number; driftFlag: boolean; deficitDurationDays: number; dietBreakLevel: string } | null;
  trend7d?: { adherence?: { ratio: number; status: string; weeklyActual: number; weeklyGoal: number } | null };
}

export interface Today {
  total_steps?: number;
  total_distance_meters?: number;
  active_kilocalories?: number;
  total_kilocalories?: number;
  resting_heart_rate?: number;
  min_heart_rate?: number;
  max_heart_rate?: number;
  avg_stress_level?: number;
  max_stress_level?: number;
  body_battery_max?: number;
  body_battery_drained?: number;
  moderate_intensity_minutes?: number;
  vigorous_intensity_minutes?: number;
}

/** soma's daily health metrics (Overview). */
export function useToday() {
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/health/today`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Today) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, []);
  return { data, error };
}

export interface TrainingBreakdown {
  date: string;
  readiness: {
    traffic_light: string;
    composite_score: number | null;
    hrv_z_score: number | null;
    sleep_z_score: number | null;
    rhr_z_score: number | null;
    body_battery_z_score: number | null;
  };
  pmc: { ctl: number; atl: number; tsb: number };
  fitness: {
    vo2max: number | null;
    decoupling_pct: number | null;
    weight_kg: number | null;
    vdot_adjusted: number | null;
  };
}

/** soma's training breakdown: PMC (fitness/fatigue/form), readiness, fitness markers. */
export function useTraining(date: string) {
  const [data, setData] = useState<TrainingBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/training/breakdown?date=${date}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: TrainingBreakdown) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [date]);
  return { data, error };
}

export interface Calibration {
  phase: number;
  dataDays: number;
  weights: { hrv: number; sleep: number; rhr: number; bb: number };
  forceEqual: boolean;
}

/** Readiness calibration state (from the training graph endpoint). */
export function useCalibration(date: string) {
  const [cal, setCal] = useState<Calibration | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/training/graph?date=${date}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { calibration: Calibration }) => alive && setCal(d.calibration ?? null))
      .catch(() => {});
    return () => { alive = false; };
  }, [date, reload]);
  return { cal, refetch: () => setReload((n) => n + 1) };
}

/** Toggle readiness weighting between adaptive and force-equal. Returns true on success. */
export async function toggleCalibration(forceEqual: boolean): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/training/calibration/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ forceEqual }),
  });
  return res.ok;
}

export function useSomaPlan(date: string) {
  const [data, setData] = useState<SomaPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`${API_BASE}/api/nutrition/plan?date=${date}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: SomaPlan) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [date, reload]);
  return { data, loading, error, refetch: () => setReload((n) => n + 1) };
}

export interface Preset {
  id: string;
  name: string;
  meal_slot: string | null;
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  total_fiber: number;
}

/** soma's saved preset meals (log-meal is preset-based, not free-food search). */
export function usePresets() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/nutrition/presets`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { presets: Preset[] }) => alive && (setPresets(d.presets ?? []), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, []);
  return { presets, error };
}

export interface Drink {
  key: string;
  name: string;
  calories_per_100ml: number;
  alcohol_pct: number;
  default_ml: number;
}

/** soma's drink catalog (alcohol tracking). */
export function useDrinks() {
  const [drinks, setDrinks] = useState<Drink[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/nutrition/log-drink`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { drinks: Record<string, Omit<Drink, "key">> }) =>
        alive && setDrinks(Object.entries(d.drinks ?? {}).map(([key, v]) => ({ key, ...v }))))
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return { drinks };
}

/** Log a drink (quantity of the drink's default serving). Returns true on success. */
export async function logDrink(date: string, drinkType: string, quantity = 1): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/nutrition/log-drink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, drink_type: drinkType, quantity }),
  });
  return res.ok;
}

/** Close (finalize) a day. Returns the resulting status ("closed" | "already_closed"). */
export async function closeDay(date: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/nutrition/close-day`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date }),
  });
  if (!res.ok) return null;
  const d = (await res.json()) as { status?: string };
  return d.status ?? null;
}

/** Log a preset meal into a slot. Returns true on success. */
export async function logPresetMeal(
  date: string,
  slot: string,
  preset: Preset,
  portion = 1,
): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/nutrition/log-meal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date,
      meal_slot: slot,
      preset_meal_id: preset.id,
      portion_multiplier: portion,
      items: [],
      preset_macros: {
        calories: preset.total_calories,
        protein: preset.total_protein,
        carbs: preset.total_carbs,
        fat: preset.total_fat,
        fiber: preset.total_fiber,
      },
    }),
  });
  return res.ok;
}
