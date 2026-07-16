import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ETHANOL_DENSITY, fatOxidationPauseHours } from "macro-engine-core";

// nodejs (not edge): imports the CJS macro-engine-core package for the alcohol
// helpers, matching the other nutrition routes.
export const runtime = "nodejs";

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
    calories_per_100ml: 73.2,
    carbs_per_100ml: 5.0,
    alcohol_pct: 7.8,
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
    calories_per_100ml: 220.5,
    carbs_per_100ml: 0,
    alcohol_pct: 40.0,
    default_ml: 44,
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

// ETHANOL_DENSITY (0.789 g/ml) and the fat-oxidation-pause curve now come from
// macro-engine-core so soma and the package can't drift apart.

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
  const pauseHours = Math.round(fatOxidationPauseHours(alcoholGrams) * 10) / 10;

  // Ensure nutrition_day row exists for this date
  await sql`
    INSERT INTO nutrition_day (date)
    VALUES (${date})
    ON CONFLICT (date) DO NOTHING
  `;

  const result = await sql`
    INSERT INTO drink_log (date, drink_type, name, quantity, quantity_ml, calories, carbs, alcohol_grams, fat_oxidation_pause_hours)
    VALUES (
      ${date},
      ${drink_type},
      ${drink.name},
      ${quantity},
      ${totalMl},
      ${calories},
      ${carbs},
      ${alcoholGrams},
      ${pauseHours}
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

export async function DELETE(req: NextRequest) {
  const sql = getDb();
  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  await sql`DELETE FROM drink_log WHERE id = ${Number(id)}`;

  return NextResponse.json({ deleted: true });
}
