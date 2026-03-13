import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

// ---------------------------------------------------------------------------
// Drink database — mirrors Python seed_data.DRINK_DATABASE (9 types)
// ---------------------------------------------------------------------------

const DRINK_DB: Record<
  string,
  {
    name: string;
    calories_per_100ml: number;
    carbs_per_100ml: number;
    alcohol_pct: number;
    default_ml: number;
  }
> = {
  beer_light: {
    name: "Light Beer",
    calories_per_100ml: 29,
    carbs_per_100ml: 1.3,
    alcohol_pct: 4.2,
    default_ml: 355,
  },
  beer_regular: {
    name: "Regular Beer",
    calories_per_100ml: 43,
    carbs_per_100ml: 3.6,
    alcohol_pct: 5.0,
    default_ml: 355,
  },
  beer_ipa: {
    name: "IPA",
    calories_per_100ml: 60,
    carbs_per_100ml: 4.0,
    alcohol_pct: 6.5,
    default_ml: 355,
  },
  beer_craft: {
    name: "Craft Beer",
    calories_per_100ml: 65,
    carbs_per_100ml: 5.0,
    alcohol_pct: 7.0,
    default_ml: 355,
  },
  wine_red: {
    name: "Red Wine",
    calories_per_100ml: 85,
    carbs_per_100ml: 2.6,
    alcohol_pct: 13.5,
    default_ml: 150,
  },
  wine_white: {
    name: "White Wine",
    calories_per_100ml: 82,
    carbs_per_100ml: 2.6,
    alcohol_pct: 12.5,
    default_ml: 150,
  },
  spirit: {
    name: "Spirit (neat/rocks)",
    calories_per_100ml: 231,
    carbs_per_100ml: 0,
    alcohol_pct: 40.0,
    default_ml: 45,
  },
  margarita: {
    name: "Margarita",
    calories_per_100ml: 110,
    carbs_per_100ml: 11.0,
    alcohol_pct: 13.0,
    default_ml: 240,
  },
  old_fashioned: {
    name: "Old Fashioned",
    calories_per_100ml: 140,
    carbs_per_100ml: 5.0,
    alcohol_pct: 20.0,
    default_ml: 120,
  },
};

// Ethanol density: 0.789 g/ml
const ETHANOL_DENSITY = 0.789;

/**
 * Estimate how long fat oxidation is suppressed by alcohol intake.
 *   0g        -> 0h
 *   1-14g     -> 0-4h (linear)
 *   14-28g    -> 4-6h (linear)
 *   28-56g    -> 6-12h (linear)
 *   56g+      -> 12-24h (linear, capped)
 */
function fatOxidationPause(alcoholGrams: number): number {
  if (alcoholGrams <= 0) return 0;
  if (alcoholGrams <= 14) return (alcoholGrams / 14) * 4;
  if (alcoholGrams <= 28) return 4 + ((alcoholGrams - 14) / 14) * 2;
  if (alcoholGrams <= 56) return 6 + ((alcoholGrams - 28) / 28) * 6;
  return Math.min(24, 12 + ((alcoholGrams - 56) / 56) * 12);
}

export async function GET() {
  return NextResponse.json({ drinks: DRINK_DB });
}

export async function POST(req: NextRequest) {
  const sql = getDb();
  const { date, drink_type, quantity = 1 } = (await req.json()) as {
    date: string;
    drink_type: string;
    quantity?: number;
  };

  if (!date || !drink_type) {
    return NextResponse.json(
      { error: "date and drink_type are required" },
      { status: 400 }
    );
  }

  const drink = DRINK_DB[drink_type];
  if (!drink) {
    return NextResponse.json(
      { error: `Unknown drink_type: ${drink_type}` },
      { status: 400 }
    );
  }

  const totalMl = drink.default_ml * quantity;
  const calories = Math.round((drink.calories_per_100ml * totalMl) / 100);
  const carbs = Math.round(((drink.carbs_per_100ml * totalMl) / 100) * 10) / 10;
  const alcoholGrams =
    Math.round(totalMl * (drink.alcohol_pct / 100) * ETHANOL_DENSITY * 10) / 10;
  const pauseHours = Math.round(fatOxidationPause(alcoholGrams) * 10) / 10;

  // Ensure nutrition_day row exists for this date
  await sql`
    INSERT INTO nutrition_day (date)
    VALUES (${date})
    ON CONFLICT (date) DO NOTHING
  `;

  const result = await sql`
    INSERT INTO drink_log (date, drink_id, name, quantity_ml, calories, carbs, alcohol_g)
    VALUES (
      ${date},
      ${drink_type},
      ${drink.name},
      ${totalMl},
      ${calories},
      ${carbs},
      ${alcoholGrams}
    )
    RETURNING id
  `;

  return NextResponse.json({
    id: result[0].id,
    calories,
    alcohol_grams: alcoholGrams,
    fat_oxidation_pause_hours: pauseHours,
  });
}
