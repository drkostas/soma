import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const sql = getDb();
  const { from_date, to_date } = (await req.json()) as {
    from_date: string;
    to_date: string;
  };

  if (!from_date || !to_date) {
    return NextResponse.json(
      { error: "from_date and to_date are required" },
      { status: 400 }
    );
  }

  // Ensure nutrition_day row exists for target date
  await sql`
    INSERT INTO nutrition_day (date)
    VALUES (${to_date})
    ON CONFLICT (date) DO NOTHING
  `;

  // Copy meals from source date
  const sourceMeals = await sql`
    SELECT meal_slot, source, preset_meal_id, portion_multiplier, items,
           calories, protein, carbs, fat, fiber, notes
    FROM meal_log
    WHERE date = ${from_date}
    ORDER BY logged_at
  `;

  if (sourceMeals.length === 0) {
    return NextResponse.json({ copied: 0, message: "No meals found for source date" });
  }

  // Clear existing meals on target date to prevent duplicates
  await sql`DELETE FROM meal_log WHERE date = ${to_date}`;

  let copied = 0;
  for (const m of sourceMeals) {
    await sql`
      INSERT INTO meal_log (date, meal_slot, source, preset_meal_id, portion_multiplier,
                            items, calories, protein, carbs, fat, fiber, notes)
      VALUES (
        ${to_date},
        ${m.meal_slot},
        ${m.source},
        ${m.preset_meal_id},
        ${m.portion_multiplier},
        ${m.items ? JSON.stringify(m.items) : null},
        ${m.calories},
        ${m.protein},
        ${m.carbs},
        ${m.fat},
        ${m.fiber},
        ${m.notes}
      )
    `;
    copied++;
  }

  return NextResponse.json({ copied });
}
