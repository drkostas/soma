/**
 * Two databases in one process really are two (the pool bug, 2026-09-24).
 *
 * `localDb` cached a single pool in a module-level variable and returned it for every later call
 * whatever url was asked for. A script that wanted `soma` and `verify_soma` got whichever it opened
 * first, so its SELECT returned nothing and its UPDATE hit the wrong database, both silently. That
 * is why a cleanup reported "nothing to do" while 29 unwanted weigh-ins sat in his Garmin account.
 */
import { makeDb, getDb } from "../lib/db";
import { weightsOwedToGarmin } from "../lib/weight-push";

const a = makeDb("postgresql://gkos@127.0.0.1:5432/soma");
const b = makeDb("postgresql://gkos@127.0.0.1:5432/verify_soma");
const one = (await a`SELECT current_database() AS db`) as Array<{ db: string }>;
const two = (await b`SELECT current_database() AS db`) as Array<{ db: string }>;
console.log(`first  connection: ${one[0].db}`);
console.log(`second connection: ${two[0].db}`);
console.log(one[0].db !== two[0].db ? "PASS two urls give two databases" : "FAIL both went to the same one");

const owed = await weightsOwedToGarmin(getDb());
console.log(`\nowed to Garmin from soma: ${owed.length}`);
console.log(owed.length === 0
  ? "PASS nothing is owed, because every existing row is a source Garmin minted"
  : `check these before any push: ${owed.map((w) => w.date).join(", ")}`);
process.exit(one[0].db !== two[0].db && owed.length === 0 ? 0 : 1);
