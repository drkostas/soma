/**
 * The sentence that exposed the bug, end to end (soma: "Yesterday i ate ... for dinner").
 *
 *   cd web && DATABASE_URL=postgresql://gkos@127.0.0.1:5432/verify_soma \
 *     npx tsx scripts/retro-day-check.mts
 */
import { getDb } from "../lib/db";
import { createCapture, getCapture } from "../lib/meal-capture";
import { processCapture, claimForCheck, dayBack } from "../lib/meal-worker";
import { todayAthlete } from "../lib/athlete-tz";

const sql = getDb();
const today = todayAthlete();
const yesterday = dayBack(today, 1);

const CASES = [
  { what: "yesterday, named outright", text: "Yesterday i ate 400g of yogurt granola honey tahini and grapes for dinner", want: yesterday, slot: "dinner" },
  { what: "today, so it must not move", text: "Today for breakfast I ate 350g omelette with 1 full egg rest egg whites cherry tomatoes and a bit of pesto", want: today, slot: "breakfast" },
];

let bad = 0;
for (const c of CASES) {
  const id = await createCapture(sql, { date: today, slot: "breakfast", mode: "log", text: c.text, image: null });
  const claimed = await claimForCheck(sql, id);
  if (!claimed) { console.error("could not claim"); process.exit(1); }
  await processCapture(sql, claimed);
  const cap = await getCapture(sql, id);
  const rows = cap?.meal_log_id
    ? ((await sql`SELECT date::text AS date, meal_slot, calories FROM meal_log WHERE id = ${cap.meal_log_id}`) as Array<{ date: string; meal_slot: string; calories: number }>)
    : [];
  const meal = rows[0];
  const offset = (cap?.proposal as { day_offset?: number } | null)?.day_offset;
  const ok = meal && meal.date === c.want && meal.meal_slot === c.slot;
  if (!ok) bad++;
  console.log(`${ok ? "pass" : "FAIL"}  ${c.what}`);
  console.log(`      day_offset=${offset}  landed on ${meal?.date ?? "(no meal)"} ${meal?.meal_slot ?? ""} ${meal?.calories ?? ""} kcal`);
  console.log(`      wanted ${c.want} ${c.slot}`);
  if (cap?.meal_log_id) await sql`DELETE FROM meal_log WHERE id = ${cap.meal_log_id}`;
  await sql`DELETE FROM meal_capture WHERE id = ${id}`;
}
console.log(bad ? `\n${bad} FAILED` : "\nboth placed on the right day");
process.exit(bad ? 1 : 0);
