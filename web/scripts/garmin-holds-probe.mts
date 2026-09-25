/** Read-only. Does the live Garmin answer parse the way `garminHoldsWeighIn` expects? */
import { GarminAuth, DBTokenStore } from "garmin-auth";
import { healGarminTokenRow } from "../lib/garmin-token-heal";
import { getDb } from "../lib/db";
import { dayPath, garminHoldsWeighIn } from "../lib/weight-push";

const sql = getDb();
await healGarminTokenRow(sql);
const client = await new GarminAuth({ store: new DBTokenStore(process.env.DATABASE_URL!) }).client();
const cases: Array<[string, boolean]> = [
  ["2025-11-29", true],   // his 80.00, kept after the cleanup
  ["2026-09-24", true],   // soma's push from today
  ["2026-09-10", false],  // a day with no weigh-in anywhere
];
let ok = true;
for (const [date, expected] of cases) {
  const got = garminHoldsWeighIn(await client.connectapi(dayPath(date)));
  const pass = got === expected;
  ok &&= pass;
  console.log(`${pass ? "PASS" : "FAIL"}  ${date}  holds=${got}  (expected ${expected})`);
}
process.exit(ok ? 0 : 1);
