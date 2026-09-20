/**
 * Print the context block the meal agent reads, against whatever DATABASE_URL is set.
 *
 * The context is the only thing standing between the agent and a guess, so being able to look at
 * it directly is worth a script. Read-only.
 */
import { getDb } from "../lib/db";
import { buildAgentContext, renderContext } from "../lib/nutrition-agent-context";

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const slot = process.argv[3] ?? "lunch";
const sql = getDb();
const ctx = await buildAgentContext(sql, date, slot, 400, 900);
const out = renderContext(ctx);
// Only the part about the day; the ingredient table is hundreds of lines.
console.log(out.slice(0, out.indexOf("## Ingredients this owner logs")));
