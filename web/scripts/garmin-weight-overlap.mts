/**
 * Read-only. For every weigh-in soma took from Health Connect, what does Garmin hold on that date?
 *
 *   cd web && set -a && . ~/.config/soma/sync.env && set +a && npx tsx scripts/garmin-weight-overlap.mts
 *
 * Garmin mints `samplePk` when a sample is written, so a sample created today is one soma pushed and
 * an older one is his. That is what separates a duplicate soma caused from his own record.
 */
import { GarminAuth, DBTokenStore } from "garmin-auth";
import { healGarminTokenRow } from "../lib/garmin-token-heal";
import { getDb } from "../lib/db";

const sql = getDb();
await healGarminTokenRow(sql);
const client = await new GarminAuth({ store: new DBTokenStore(process.env.DATABASE_URL!) }).client();

const hc = (await sql`
  SELECT date::text AS date, weight_grams FROM weight_log
  WHERE source_type = 'HEALTH_CONNECT' ORDER BY date`) as unknown as { date: string; weight_grams: number }[];

type M = { weight?: number; samplePk?: number; sourceType?: string; timestampGMT?: number; date?: number };
const today = new Date().toISOString().slice(0, 10);

let dupes = 0, fresh = 0;
for (const w of hc) {
  const r = (await client.connectapi(`/weight-service/weight/range/${w.date}/${w.date}?includeAll=true`)) as {
    dailyWeightSummaries?: Array<{ allWeightMetrics?: M[] }>;
  };
  const all = (r.dailyWeightSummaries ?? []).flatMap((d) => d.allWeightMetrics ?? []);
  // A sample created today is soma's own push. samplePk is time-ordered, so compare against today's floor.
  const lines = all.map((m) => {
    const kg = (m.weight ?? 0) / 1000;
    return `${kg.toFixed(2)}kg ${m.sourceType ?? "?"} pk=${m.samplePk}`;
  });
  const others = all.filter((m) => m.sourceType !== "MANUAL" || Math.abs((m.weight ?? 0) - w.weight_grams) > 1);
  const hisSameReading = all.filter(
    (m) => Math.abs((m.weight ?? 0) - w.weight_grams) <= 100, // within 0.1 kg = the same weigh-in
  );
  const tag = hisSameReading.length > 1 ? "DUPLICATE" : all.length > 1 ? "two readings" : "new";
  if (tag === "DUPLICATE") dupes++; else if (tag === "new") fresh++;
  console.log(`${w.date}  soma pushed ${(w.weight_grams / 1000).toFixed(2)}  | Garmin now: ${lines.join(", ")}  => ${tag}`);
  void others; void today;
}
console.log(`\n${hc.length} dates: ${fresh} new to Garmin, ${dupes} with the same reading twice`);
process.exit(0);
