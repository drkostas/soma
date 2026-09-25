/**
 * Remove soma's Health Connect pushes that duplicated a weigh-in Garmin ALREADY held that day.
 *
 *   cd web && set -a && . ~/.config/soma/sync.env && set +a && \
 *     npx tsx scripts/undo-duplicate-hc-pushes.mts            # dry run, deletes nothing
 *     npx tsx scripts/undo-duplicate-hc-pushes.mts --apply    # deletes
 *
 * On a date where he had already typed the reading into Garmin, soma's push is a second copy of the
 * same weigh-in. His entry is older and stays. Soma's is identified by `samplePk`, which Garmin mints
 * at write time, so "created after the push began" separates it from his exactly. Only a sample that
 * is BOTH soma's and sharing its date with an older sample of his is removed.
 */
import { GarminAuth, DBTokenStore } from "garmin-auth";
import { healGarminTokenRow } from "../lib/garmin-token-heal";
import { getDb } from "../lib/db";

const apply = process.argv.includes("--apply");
// samplePk is milliseconds since the epoch. Anything minted after this was written by soma's push.
const PUSH_BEGAN_MS = Date.parse("2026-09-25T13:00:00Z"); // 16:00 Athens, before the 16:07 run

const sql = getDb();
await healGarminTokenRow(sql);
const client = await new GarminAuth({ store: new DBTokenStore(process.env.DATABASE_URL!) }).client();

const dates = ((await sql`
  SELECT DISTINCT date::text AS date FROM weight_log WHERE source_type = 'HEALTH_CONNECT' ORDER BY 1`) as unknown as { date: string }[])
  .map((r) => r.date);

type M = { weight?: number; samplePk?: number; sourceType?: string };
const toDelete: Array<{ date: string; pk: number; kg: number; his: string }> = [];
for (const date of dates) {
  const r = (await client.connectapi(`/weight-service/weight/range/${date}/${date}?includeAll=true`)) as {
    dailyWeightSummaries?: Array<{ allWeightMetrics?: M[] }>;
  };
  const all = (r.dailyWeightSummaries ?? []).flatMap((d) => d.allWeightMetrics ?? []);
  const mine = all.filter((m) => (m.samplePk ?? 0) >= PUSH_BEGAN_MS);
  const his = all.filter((m) => (m.samplePk ?? 0) < PUSH_BEGAN_MS);
  if (!his.length) continue; // nothing of his on that day, so soma's push is the only record: keep it
  for (const m of mine) {
    toDelete.push({
      date, pk: m.samplePk!, kg: (m.weight ?? 0) / 1000,
      his: his.map((h) => `${((h.weight ?? 0) / 1000).toFixed(2)}kg pk=${h.samplePk}`).join(", "),
    });
  }
}

console.log(`${toDelete.length} of soma's samples sit on a day he already had a weigh-in:`);
for (const d of toDelete) console.log(`  ${d.date}  soma ${d.kg.toFixed(2)}kg pk=${d.pk}   (his, kept: ${d.his})`);
if (!apply) { console.log("\nDRY RUN. Nothing deleted. Re-run with --apply."); process.exit(0); }

for (const d of toDelete) {
  await client.delete(`/weight-service/weight/${d.date}/byversion/${d.pk}`);
  console.log(`  deleted ${d.date} pk=${d.pk}`);
}
process.exit(0);
