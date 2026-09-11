import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";


export async function POST(req: NextRequest) {
  const sql = getDb();
  const body = await req.json();
  const { date, slot } = body as { date: string; slot: string };

  if (!date || !slot) {
    return NextResponse.json(
      { error: "date and slot are required" },
      { status: 400 },
    );
  }

  // Ensure nutrition_day row exists for this date
  await sql`
    INSERT INTO nutrition_day (date)
    VALUES (${date})
    ON CONFLICT (date) DO NOTHING
  `;

  // Read current skipped_slots
  const rows = await sql`
    SELECT skipped_slots FROM nutrition_day WHERE date = ${date}
  `;
  const current: string[] = rows[0]?.skipped_slots ?? [];
  const alreadySkipped = current.includes(slot);

  if (alreadySkipped) {
    // Unskip: remove slot from array
    await sql`
      UPDATE nutrition_day
      SET skipped_slots = array_remove(skipped_slots, ${slot})
      WHERE date = ${date}
    `;
  } else {
    // Skip means "I did not eat this slot". A slot with logged meals is the opposite claim, and
    // the old behaviour here deleted those meals to make the two agree (one tap on the app removed
    // a 650 kcal lunch with no confirmation, soma#866). Refuse instead: deleting a meal stays an
    // explicit action on the meal itself.
    const logged = await sql`
      SELECT count(*)::int AS n FROM meal_log WHERE date = ${date} AND meal_slot = ${slot}
    `;
    if ((logged[0]?.n ?? 0) > 0) {
      return NextResponse.json(
        { error: "This slot has logged meals. Delete them before skipping it.", slot, meals: logged[0].n },
        { status: 409 },
      );
    }
    await sql`
      UPDATE nutrition_day
      SET skipped_slots = array_append(skipped_slots, ${slot})
      WHERE date = ${date}
    `;
  }

  return NextResponse.json({ skipped: !alreadySkipped, slot });
}
