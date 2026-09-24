/**
 * The whole outward half, end to end: a row in soma becomes a weigh-in in Garmin (soma#weight).
 *
 *   cd web && set -a && . ~/.config/soma/sync.env && set +a && \
 *     DATABASE_URL=postgresql://gkos@127.0.0.1:5432/verify_soma npx tsx scripts/weight-push-check.mts
 *
 * Writes one probe weigh-in, verifies Garmin holds it, then removes it from Garmin and from soma, so
 * his account and his log are left exactly as found.
 */
import { GarminAuth, DBTokenStore } from "garmin-auth";
import { healGarminTokenRow } from "../lib/garmin-token-heal";
import { makeDb } from "../lib/db";
import { pushWeightsToGarmin, weightsOwedToGarmin } from "../lib/weight-push";

// ⛔ TWO CONNECTIONS ON PURPOSE. The weigh-in rows are written to verify_soma so his real log is
// untouched, but the GARMIN TOKENS only exist in soma, and a DBTokenStore pointed at verify_soma
// reports "Login needs MFA / fresh SSO" — which reads as an auth problem and is a wrong-database
// problem. The sync job itself has one connection and does not have this worry.
const WEIGHTS_URL = process.env.WEIGHTS_URL ?? "postgresql://gkos@127.0.0.1:5432/verify_soma";
const TOKENS_URL = process.env.TOKENS_URL ?? "postgresql://gkos@127.0.0.1:5432/soma";

const sql = makeDb(WEIGHTS_URL);
const tokenSql = makeDb(TOKENS_URL);
await healGarminTokenRow(tokenSql);
const auth = new GarminAuth({ store: new DBTokenStore(TOKENS_URL) });
const client = await auth.client();

const probeDate = "2026-09-19";
const grams = 72950;
const ext = "weight-push-check";

await sql`DELETE FROM weight_log WHERE external_id = ${ext}`;
await sql`
  INSERT INTO weight_log (date, weight_grams, source_type, external_id, measured_at)
  VALUES (${probeDate}, ${grams}, 'HEALTH_CONNECT', ${ext}, ${`${probeDate}T06:30:00.000Z`})`;

const owed = await weightsOwedToGarmin(sql);
console.log(`owed to Garmin: ${owed.length} (probe included: ${owed.some((w) => w.date === probeDate)})`);

const res = await pushWeightsToGarmin(sql, client);
console.log(`push: ${JSON.stringify(res)}`);

const range = async () =>
  (await client.connectapi(`/weight-service/weight/range/${probeDate}/${probeDate}?includeAll=true`)) as {
    dailyWeightSummaries?: Array<{ allWeightMetrics?: Array<{ weight?: number; samplePk?: number }> }>;
  };
const after = (await range()).dailyWeightSummaries ?? [];
const landed = after.flatMap((d) => d.allWeightMetrics ?? []);
console.log(`Garmin now holds on ${probeDate}: ${landed.map((m) => `${(m.weight ?? 0) / 1000}kg`).join(", ") || "(nothing)"}`);

const marked = (await sql`SELECT pushed_garmin_at IS NOT NULL AS done FROM weight_log WHERE external_id = ${ext}`) as Array<{ done: boolean }>;
console.log(`row marked as pushed: ${marked[0]?.done}`);

const stillOwed = await weightsOwedToGarmin(sql);
console.log(`owed after the push: ${stillOwed.length} (probe still owed: ${stillOwed.some((w) => w.date === probeDate)})`);

for (const m of landed) {
  if (!m.samplePk) continue;
  await client.delete(`/weight-service/weight/${probeDate}/byversion/${m.samplePk}`);
  console.log(`removed sample ${m.samplePk} from Garmin`);
}
await sql`DELETE FROM weight_log WHERE external_id = ${ext}`;
const final = (await range()).dailyWeightSummaries ?? [];
console.log(`clean: Garmin ${final.length === 0 ? "empty" : "STILL HAS SOMETHING"}, soma row removed`);
