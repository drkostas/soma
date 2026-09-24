/**
 * Can soma WRITE a weight into Garmin? Half of what he asked for depends on it.
 *
 * Writes a weigh-in, reads it back, then deletes it, so his account is left as it was found. Run
 * with the sync env loaded.
 */
import { GarminAuth, DBTokenStore } from "garmin-auth";
import { healGarminTokenRow } from "../lib/garmin-token-heal";
import { getDb } from "../lib/db";

const sql = getDb();
await healGarminTokenRow(sql);
const auth = new GarminAuth({ store: new DBTokenStore(process.env.DATABASE_URL!) });
const client = await auth.client();

// A date far enough back that it cannot collide with anything real he logs today.
const probeDate = "2026-09-23";
const grams = 73199;

const range = async () =>
  (await client.connectapi(`/weight-service/weight/range/${probeDate}/${probeDate}?includeAll=true`)) as {
    dailyWeightSummaries?: Array<{ allWeightMetrics?: Array<{ weight?: number; samplePk?: number; sourceType?: string }> }>;
  };

console.log("before:", JSON.stringify((await range()).dailyWeightSummaries ?? []).slice(0, 160));

try {
  // `connectapi` is GET only; the client has a real `post`.
  const res = await client.post("/weight-service/user-weight", {
    dateTimestamp: `${probeDate}T08:00:00.00`,
    unitKey: "kg",
    value: grams / 1000,
  });
  console.log("POST /weight-service/user-weight ->", JSON.stringify(res).slice(0, 200));
} catch (e) {
  console.log("POST failed:", (e as Error).message.slice(0, 300));
}

const after = (await range()).dailyWeightSummaries ?? [];
console.log("after :", JSON.stringify(after).slice(0, 300));

// Clean up whatever we created.
for (const d of after) {
  for (const m of d.allWeightMetrics ?? []) {
    if (!m.samplePk) continue;
    try {
      await client.delete(`/weight-service/weight/${probeDate}/byversion/${m.samplePk}`);
      console.log(`deleted sample ${m.samplePk}`);
    } catch (e) {
      console.log(`could not delete ${m.samplePk}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
}
console.log("final :", JSON.stringify((await range()).dailyWeightSummaries ?? []).slice(0, 160));
