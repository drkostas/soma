import { useCallback, useEffect, useState } from "react";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3456";

/** Personal API token for prod (soma.gkos.dev gates /api/* behind a session;
    the token bypasses that for this native client). Empty in local dev. */
const API_TOKEN = process.env.EXPO_PUBLIC_API_TOKEN;
const AUTH_HEADERS: Record<string, string> = API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {};

/**
 * GET JSON with one automatic retry. Serverless DBs (Neon) can return a transient
 * 5xx or a "fetch failed" on cold start; a single-shot fetch would leave the screen
 * blank until manual reload. One short-delay retry smooths that over. `path` is
 * relative to API_BASE.
 */
export async function fetchJson<T>(path: string, retries = 1): Promise<T> {
  try {
    const r = await fetch(`${API_BASE}${path}`, { headers: AUTH_HEADERS });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  } catch (e) {
    if (retries > 0) {
      await new Promise((res) => setTimeout(res, 600));
      return fetchJson<T>(path, retries - 1);
    }
    throw e;
  }
}

export interface MacroSet {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export interface SomaMealItem { name?: string; grams?: number }
export interface SomaMeal {
  id: number;
  meal_slot: string;
  source?: string | null;
  preset_meal_id?: string | null;
  calories: number; protein: number; carbs: number; fat: number; fiber: number;
  items?: SomaMealItem[];
  logged_at?: string;
}
export interface SomaBreakdown {
  totalBurn?: number; bmr?: number;
  stepCalories?: number; stepCaloriesPredicted?: number; expectedSteps?: number; actualSteps?: number;
  runCalories?: number; runActual?: number; runPredicted?: number; runEnabled?: boolean; runActualDistKm?: number; runDistanceKm?: number;
  gymCalories?: number; gymBreakdown?: { title: string; calories: number; predicted?: number; actual?: number }[];
  drinkCalories?: number; deficit?: number;
}
export interface TrendDay { date: string; ate: number; burn: number; deficit: number; closed: boolean; isToday: boolean }
export interface SomaPlan {
  plan: { target_calories: number; target_protein: number; target_carbs: number; target_fat: number; target_fiber: number } | null;
  consumed: MacroSet;
  remaining: MacroSet | null;
  slotBudgets: Record<string, { calories: number; protein?: number; carbs?: number; fat?: number; fiber?: number }> | null;
  meals?: SomaMeal[];
  breakdown?: SomaBreakdown | null;
  adaptive: { effectiveTdee: number; reportedTdee: number; driftFlag: boolean; deficitDurationDays: number; dietBreakLevel: string } | null;
  trend7d?: {
    adherence?: { ratio: number; status: string; weeklyActual: number; weeklyGoal: number } | null;
    days?: TrendDay[];
    totalDeficit?: number; goalDeficit?: number;
  };
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

/**
 * Wire a hook's refetch() to a pull-to-refresh RefreshControl. The GET hooks
 * don't expose a completion promise, so we clear the spinner after a short beat
 * (the retry-aware fetchJson usually resolves well within it).
 */
export function usePullRefresh(refetch: () => void) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refetch();
    setTimeout(() => setRefreshing(false), 900);
  }, [refetch]);
  return { refreshing, onRefresh };
}

/** soma's daily health metrics (Overview). */
export function useToday() {
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchJson<Today>("/api/health/today")
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [reload]);
  return { data, error, refetch: () => setReload((n) => n + 1) };
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
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchJson<TrainingBreakdown>(`/api/training/breakdown?date=${date}`)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [date, reload]);
  return { data, error, refetch: () => setReload((n) => n + 1) };
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
    fetchJson<{ calibration: Calibration }>(`/api/training/graph?date=${date}`)
      .then((d) => alive && setCal(d.calibration ?? null))
      .catch(() => {});
    return () => { alive = false; };
  }, [date, reload]);
  return { cal, refetch: () => setReload((n) => n + 1) };
}

/** Toggle readiness weighting between adaptive and force-equal. Returns true on success. */
export async function toggleCalibration(forceEqual: boolean): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/training/calibration/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
    body: JSON.stringify({ forceEqual }),
  });
  return res.ok;
}

// ---- Forward simulation: full training-plan schedule + PMC/readiness/fitness/comparison ----
export interface WorkoutStep {
  step_type: string;
  description?: string | null;
  hr_zone?: number | null;
  target_type?: string | null;
  duration_type?: string | null;
  duration_value?: number | null;
}
export interface PlanDay {
  id: number;
  dayDate: string;
  weekNumber: number;
  runType: string;
  runTitle: string;
  targetDistanceKm: number | null;
  workoutSteps: WorkoutStep[] | null;
  loadLevel?: string | null;
  gymWorkout?: string | null;
  gymNotes?: string | null;
  completed: boolean;
  garminWorkoutId?: string | null;
  garminPushStatus?: string | null;
  actualDistanceKm?: number | null;
}
export interface ComparisonPoint { date: string; [k: string]: number | string }
export interface ForwardSim {
  today: string;
  pmc: { ctl: number; atl: number; tsb: number } | null;
  readiness: { compositeZ: number | null; trafficLight: string } | null;
  calibration: Calibration | null;
  fitness: { vo2max: number | null; vdotAdjusted: number | null; weightKg: number | null } | null;
  planDays: PlanDay[];
  comparison: {
    load: ComparisonPoint[];
    readiness: ComparisonPoint[];
    fitness: ComparisonPoint[];
    racePrediction: ComparisonPoint[];
  } | null;
}

/** The full forward-simulation payload: schedule + PMC + readiness + fitness + comparison. */
export function useForwardSim(date: string) {
  const [data, setData] = useState<ForwardSim | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchJson<ForwardSim>(`/api/training/forward-sim?date=${date}`)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [date, reload]);
  return { data, loading, error, refetch: () => setReload((n) => n + 1) };
}

/** Toggle a plan day's completion. Passes the existing actual distance through so
    the PATCH route (which nulls it when omitted) doesn't wipe matched-activity data. */
export async function setDayCompletion(
  dayId: number,
  completed: boolean,
  actualDistanceKm?: number | null,
): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/training/day/${dayId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
    body: JSON.stringify({ completed, actual_distance_km: actualDistanceKm ?? null }),
  });
  return res.ok;
}

/** Toggle a sync rule on/off (PATCH /api/connections/rules/[id]). Returns true on success. */
export async function setRuleEnabled(id: number, enabled: boolean): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/connections/rules/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
    body: JSON.stringify({ enabled }),
  });
  return res.ok;
}

// ---- Running trends: training-load/ACWR + cadence/stride ----
export interface LoadPoint { date: string; acute: number | null; chronic: number | null; acwr: number | null }
export interface CadencePoint { date: string; cadence: number | null; stride: number | null }
export interface RunningTrends { loadTrend: LoadPoint[]; cadenceStride: CadencePoint[] }

/** Training-load/ACWR trend + cadence/stride from /api/running/trends. */
export function useRunningTrends(range: string) {
  const [data, setData] = useState<RunningTrends | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchJson<RunningTrends>(`/api/running/trends?range=${range}`)
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => { alive = false; };
  }, [range, reload]);
  return { data, refetch: () => setReload((n) => n + 1) };
}

// ---- Strength-training data (volume, stats, recent, top exercises) ----
export interface WorkoutSummary {
  stats: {
    total_workouts: number | string;
    training_days: number | string;
    avg_duration_min: number | string | null;
    avg_exercises: number | string | null;
  } | null;
  weeklyVolume: { week: string; total_volume: number | string }[];
  recent: { id: string; title: string; start_time: string; exercise_count: number; duration_min: number | null; volume: number }[];
  topExercises: { name: string; sessions: number }[];
}

/** Strength-training summary from /api/workouts/summary. */
export function useWorkoutsSummary(range: string) {
  const [data, setData] = useState<WorkoutSummary | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchJson<WorkoutSummary>(`/api/workouts/summary?range=${range}`)
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => { alive = false; };
  }, [range, reload]);
  return { data, refetch: () => setReload((n) => n + 1) };
}

// ---- Per-night sleep data (stages, score, sleep HR, SpO2) for the sleep dashboard ----
export interface SleepNight {
  date: string;
  total: number | null; deep: number | null; light: number | null; rem: number | null; awake: number | null;
  score: number | null; hr: number | null; spo2: number | null;
}
export interface SleepSummary {
  trend: SleepNight[];
  stats: {
    nights: number;
    avg_hours: number | null; avg_score: number | null;
    avg_deep_pct: number | null; avg_rem_pct: number | null;
    avg_sleep_hr: number | null; avg_spo2: number | null;
  };
  lastNight: SleepNight | null;
}

/** Per-night sleep stages + score + sleep HR/SpO2 from /api/sleep/summary. */
export function useSleepSummary(range: string) {
  const [data, setData] = useState<SleepSummary | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchJson<SleepSummary>(`/api/sleep/summary?range=${range}`)
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => { alive = false; };
  }, [range, reload]);
  return { data, refetch: () => setReload((n) => n + 1) };
}

// ---- HRV + training-readiness (recovery vitals) ----
export interface HrvPoint { date: string; weekly_avg: number | null; last_night_avg: number | null; status: string | null }
export interface ReadinessPoint {
  date: string; score: number | null; level: string | null;
  hrv_pct: number | null; stress_pct: number | null; acwr_pct: number | null;
  recovery_pct: number | null; sleep_history_pct: number | null;
}
export interface RecoverySummary {
  hrv: { trend: HrvPoint[]; latest: HrvPoint | null };
  readiness: { trend: ReadinessPoint[]; latest: ReadinessPoint | null };
}

/** HRV + training-readiness from /api/recovery/summary. */
export function useRecoverySummary(range: string) {
  const [data, setData] = useState<RecoverySummary | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchJson<RecoverySummary>(`/api/recovery/summary?range=${range}`)
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => { alive = false; };
  }, [range, reload]);
  return { data, refetch: () => setReload((n) => n + 1) };
}

// ---- Training computation graph (nodes → the mobile pace-computation breakdown) ----
export interface GraphNode { id: string; label: string; value: number | null }

/** The computation-graph nodes keyed by id (readiness_factor, tsb, adjusted_pace, …). */
export function useTrainingGraph(date: string) {
  const [nodes, setNodes] = useState<Record<string, GraphNode>>({});
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchJson<{ graph?: { nodes?: GraphNode[] }; nodes?: GraphNode[] }>(`/api/training/graph?date=${date}`)
      .then((d) => {
        if (!alive) return;
        const arr = d.graph?.nodes ?? d.nodes ?? [];
        const map: Record<string, GraphNode> = {};
        for (const nd of arr) map[nd.id] = nd;
        setNodes(map);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [date, reload]);
  return { nodes, refetch: () => setReload((n) => n + 1) };
}

export function useSomaPlan(date: string) {
  const [data, setData] = useState<SomaPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchJson<SomaPlan>(`/api/nutrition/plan?date=${date}`)
      .then((d) => alive && (setData(d), setError(null)))
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
    fetchJson<{ presets: Preset[] }>("/api/nutrition/presets")
      .then((d) => alive && (setPresets(d.presets ?? []), setError(null)))
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
    fetchJson<{ drinks: Record<string, Omit<Drink, "key">> }>("/api/nutrition/log-drink")
      .then((d) =>
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
    headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
    body: JSON.stringify({ date, drink_type: drinkType, quantity }),
  });
  return res.ok;
}

/** Close (finalize) a day. Returns the resulting status ("closed" | "already_closed"). */
export async function closeDay(date: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/nutrition/close-day`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
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
    headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
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

/** Delete a logged meal by its id. */
export async function deleteMeal(mealId: number): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/nutrition/log-meal?id=${mealId}`, {
    method: "DELETE",
    headers: AUTH_HEADERS,
  });
  return res.ok;
}

/** Today's date as YYYY-MM-DD in the device's local timezone. */
export function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
