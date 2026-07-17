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

export function useSomaPlan(date: string) {
  const [data, setData] = useState<SomaPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`${API_BASE}/api/nutrition/plan?date=${date}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: SomaPlan) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [date]);
  return { data, loading, error };
}
