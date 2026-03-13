import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { NutritionDashboard } from "@/components/nutrition-dashboard";

export const metadata: Metadata = { title: "Nutrition" };
export const revalidate = 60;

/** Safe query wrapper — returns fallback on missing table or other DB error. */
async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function getNutritionDay(date: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM nutrition_day WHERE date = ${date}
  `;
  return rows[0] ?? null;
}

async function getMeals(date: string) {
  const sql = getDb();
  return sql`
    SELECT ml.*, pm.name AS preset_name, pm.tags AS preset_tags
    FROM meal_log ml
    LEFT JOIN preset_meals pm ON ml.preset_meal_id = pm.id
    WHERE ml.date = ${date}
    ORDER BY ml.logged_at
  `;
}

async function getDrinks(date: string) {
  const sql = getDb();
  return sql`
    SELECT * FROM drink_log WHERE date = ${date} ORDER BY logged_at
  `;
}

async function getPresets() {
  const sql = getDb();
  return sql`SELECT * FROM preset_meals ORDER BY name`;
}

async function getTrainingDay(date: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT d.run_type, d.run_title, d.target_distance_km,
           d.target_duration_min, d.load_level, d.gym_workout,
           p.plan_name
    FROM training_plan_day d
    JOIN training_plan p ON d.plan_id = p.id
    WHERE p.status = 'active' AND d.day_date = ${date}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function getHealthSummary(date: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT total_steps, bmr_kilocalories, active_kilocalories,
           sleep_time_seconds
    FROM daily_health_summary
    WHERE date = ${date}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function getSleepDetail(date: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT total_sleep_seconds, deep_sleep_seconds, sleep_score
    FROM sleep_detail
    WHERE date = ${date}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export default async function NutritionPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const params = await searchParams;
  const today = params.date || new Date().toISOString().slice(0, 10);

  const [plan, meals, drinks, presets, training, health, sleep] =
    await Promise.all([
      safeQuery(() => getNutritionDay(today), null),
      safeQuery(() => getMeals(today), []),
      safeQuery(() => getDrinks(today), []),
      safeQuery(() => getPresets(), []),
      safeQuery(() => getTrainingDay(today), null),
      safeQuery(() => getHealthSummary(today), null),
      safeQuery(() => getSleepDetail(today), null),
    ]);

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <NutritionDashboard
        date={today}
        plan={plan}
        meals={meals}
        drinks={drinks}
        presets={presets}
        training={training}
        health={health}
        sleep={sleep}
      />
    </div>
  );
}
