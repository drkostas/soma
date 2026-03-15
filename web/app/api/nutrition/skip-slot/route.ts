import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

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
    // Skip: add slot to array AND delete any meals logged for that slot
    await sql`
      UPDATE nutrition_day
      SET skipped_slots = array_append(skipped_slots, ${slot})
      WHERE date = ${date}
    `;
    await sql`
      DELETE FROM meal_log
      WHERE date = ${date} AND meal_slot = ${slot}
    `;
  }

  return NextResponse.json({ skipped: !alreadySkipped, slot });
}
