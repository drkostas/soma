/**
 * Recompute daily_readiness for a date range with the current rules (#647).
 *
 *   cd web && set -a && . ./.env.local && set +a && \
 *   npx tsx scripts/readiness-recompute.mts 2026-08-22 2026-09-04
 *
 * Idempotent upsert — the same write garmin-ingest does for today after every
 * sync. Use it after a rule change so stored lights match the code.
 */
import { getDb } from "../lib/db";
import { computeDailyReadiness } from "../lib/readiness-stream";

const [from, to] = process.argv.slice(2);
const isDate = (s: string | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
if (!isDate(from) || !isDate(to)) {
  console.error("usage: readiness-recompute.mts YYYY-MM-DD YYYY-MM-DD");
  process.exit(2);
}
const sql = getDb();
for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86_400_000) {
  const d = new Date(t).toISOString().slice(0, 10);
  const r = await computeDailyReadiness(sql, d);
  console.log(`${d} ${r.traffic_light} composite=${r.composite_score} flags=${JSON.stringify(r.flags)}`);
}
process.exit(0);
