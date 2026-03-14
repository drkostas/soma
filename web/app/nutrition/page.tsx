import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { NutritionDashboard } from "@/components/nutrition-dashboard";
import { NutritionOnboarding } from "@/components/nutrition-onboarding";

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

/** Check if nutrition_profile exists; if not, gather bootstrap data for onboarding. */
async function getBootstrap() {
  const sql = getDb();

  // Check if profile already exists
  const profileRows = await sql`SELECT id FROM nutrition_profile WHERE id = 1`;
  if (profileRows.length > 0) return null;

  // No profile — gather bootstrap data from existing tables
  const [healthRows, weightRows, fitnessRows, profileRawRows] = await Promise.all([
    sql`
      SELECT bmr_kilocalories, active_kilocalories
      FROM daily_health_summary
      WHERE bmr_kilocalories IS NOT NULL
      ORDER BY date DESC LIMIT 1
    `,
    sql`
      SELECT weight_grams / 1000.0 AS weight_kg
      FROM weight_log
      WHERE weight_grams IS NOT NULL
      ORDER BY date DESC LIMIT 1
    `,
    sql`
      SELECT vo2max
      FROM fitness_trajectory
      WHERE vo2max IS NOT NULL
      ORDER BY date DESC LIMIT 1
    `,
    sql`
      SELECT raw_json
      FROM garmin_profile_raw
      WHERE endpoint_name = 'user_profile'
      LIMIT 1
    `,
  ]);

  const bmr = Number(healthRows[0]?.bmr_kilocalories) || 1800;
  const active = Number(healthRows[0]?.active_kilocalories) || 400;
  const tdee = bmr + active;

  const weight_kg = Number(weightRows[0]?.weight_kg) || 80;
  const vo2max = fitnessRows[0]?.vo2max ? Number(fitnessRows[0].vo2max) : null;

  // Extract profile fields from Garmin raw JSON
  const rawProfile = profileRawRows[0]?.raw_json;
  const height_cm: number | null = rawProfile?.height ? Number(rawProfile.height) : null;
  const birthDateStr: string | null = rawProfile?.birthDate ?? null;
  const genderRaw: string | null = rawProfile?.gender ?? null;
  const sex = genderRaw ? genderRaw.toLowerCase() : null;

  // Compute age from birth date
  let age: number | null = null;
  if (birthDateStr) {
    const birth = new Date(birthDateStr);
    const now = new Date();
    age = now.getFullYear() - birth.getFullYear();
    const monthDiff = now.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
      age--;
    }
  }

  // Compute NHANES BF% estimate
  let estimated_bf_pct: number | null = null;
  if (age !== null && height_cm !== null) {
    const isMale = sex === "male" ? 1 : 0;
    const bmi = weight_kg / ((height_cm / 100) ** 2);
    const raw = 47.35 + 0.035 * age - 11.07 * isMale - 0.177 * height_cm +
      0.191 * weight_kg + 0.345 * bmi - 0.137 * (vo2max || 40);
    estimated_bf_pct = Math.round(Math.max(5, Math.min(50, raw)) * 10) / 10;
  }

  // Fetch recent Hevy exercise names (try/catch — jsonb_array_elements can fail)
  let recent_exercises: string[] = [];
  try {
    const exerciseRows = await sql`
      SELECT DISTINCT e->>'title' AS title
      FROM hevy_raw_data,
           jsonb_array_elements(raw_json->'exercises') AS e
      WHERE endpoint_name = 'workout'
      ORDER BY title
      LIMIT 80
    `;
    recent_exercises = exerciseRows
      .map((r: Record<string, unknown>) => r.title as string)
      .filter(Boolean);
  } catch {
    // Malformed data or missing table — proceed with empty list
  }

  return {
    tdee,
    weight_kg,
    height_cm,
    age,
    sex,
    vo2max,
    estimated_bf_pct,
    recent_exercises,
  };
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

  // Check if onboarding is needed (no nutrition_profile)
  const bootstrap = await safeQuery(() => getBootstrap(), undefined);

  if (bootstrap) {
    return (
      <div className="max-w-lg mx-auto px-4 py-6">
        <NutritionOnboarding bootstrap={bootstrap} />
      </div>
    );
  }

  // Profile exists — load dashboard data
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
