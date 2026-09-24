/**
 * Remove ONLY the Garmin weigh-ins this session created, and nothing that was already there.
 *
 * A check script ran the real push against verify_soma, which holds his historical MANUAL rows, so
 * 30 weigh-ins were backfilled into his live Garmin account instead of the one probe. The samples
 * I created carry a `samplePk` minted minutes ago; anything older is his and must not be touched.
 */
import { GarminAuth, DBTokenStore } from "garmin-auth";
import { healGarminTokenRow } from "../lib/garmin-token-heal";
import { makeDb } from "../lib/db";

const TOKENS_URL = "postgresql://gkos@127.0.0.1:5432/soma";
const WEIGHTS_URL = "postgresql://gkos@127.0.0.1:5432/verify_soma";
const CUTOFF = Date.now() - 2 * 60 * 60 * 1000; // anything minted in the last two hours is mine

const tokenSql = makeDb(TOKENS_URL);
await healGarminTokenRow(tokenSql);
const auth = new GarminAuth({ store: new DBTokenStore(TOKENS_URL) });
const client = await auth.client();

const sql = makeDb(WEIGHTS_URL);
const rows = (await sql`
  SELECT date::text AS date FROM weight_log
  WHERE pushed_garmin_at > now() - interval '2 hours' ORDER BY date DESC`) as Array<{ date: string }>;
console.log(`checking ${rows.length} dates`);

let removed = 0;
let kept = 0;
for (const { date } of rows) {
  const res = (await client.connectapi(`/weight-service/weight/range/${date}/${date}?includeAll=true`)) as {
    dailyWeightSummaries?: Array<{ allWeightMetrics?: Array<{ weight?: number; samplePk?: number; sourceType?: string }> }>;
  };
  for (const d of res.dailyWeightSummaries ?? []) {
    for (const m of d.allWeightMetrics ?? []) {
      if (!m.samplePk) continue;
      if (m.samplePk < CUTOFF) {
        kept++;
        console.log(`  KEEP ${date} ${(m.weight ?? 0) / 1000}kg samplePk=${m.samplePk} (not mine)`);
        continue;
      }
      await client.delete(`/weight-service/weight/${date}/byversion/${m.samplePk}`);
      removed++;
      console.log(`  removed ${date} ${(m.weight ?? 0) / 1000}kg`);
    }
  }
}
console.log(`\nremoved ${removed}, kept ${kept} that were not mine`);

// And un-mark them in verify_soma, so the test database tells the truth again.
await sql`UPDATE weight_log SET pushed_garmin_at = NULL WHERE pushed_garmin_at > now() - interval '2 hours'`;
console.log("verify_soma un-marked");
