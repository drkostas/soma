/**
 * Ask Garmin directly what weigh-ins it holds, rather than trusting soma's stored snapshots.
 *
 *   cd web && set -a && . ~/.config/soma/sync.env && set +a && \
 *     npx tsx scripts/garmin-weight-check.mts 2026-09-01 2026-09-22
 *
 * The stored `daily_weigh_ins` rows are per-day snapshots taken when the sync ran. If the scale
 * reached Garmin later that evening, the snapshot is empty for ever, because the ingest's staleness
 * rule is about heart-rate completeness and never reconsiders a weight.
 */
import { GarminAuth, DBTokenStore } from "garmin-auth";
import { healGarminTokenRow } from "../lib/garmin-token-heal";
import { getDb } from "../lib/db";

const from = process.argv[2] ?? "2026-09-01";
const to = process.argv[3] ?? new Date().toISOString().slice(0, 10);

const sql = getDb();
await healGarminTokenRow(sql);
const auth = new GarminAuth({ store: new DBTokenStore(process.env.DATABASE_URL!) });
const client = await auth.client();

// Garmin's own range endpoint for weigh-ins.
const path = `/weight-service/weight/range/${from}/${to}?includeAll=true`;
const res = (await client.connectapi(path)) as {
  dailyWeightSummaries?: Array<{ summaryDate?: string; allWeightMetrics?: Array<{ weight?: number; calendarDate?: string; sourceType?: string }> }>;
};

const rows = res?.dailyWeightSummaries ?? [];
console.log(`Garmin holds ${rows.length} day(s) with a weigh-in between ${from} and ${to}`);
for (const d of rows) {
  for (const m of d.allWeightMetrics ?? []) {
    console.log(`  ${d.summaryDate ?? m.calendarDate}  ${m.weight != null ? (m.weight / 1000).toFixed(3) + " kg" : "(none)"}  ${m.sourceType ?? ""}`);
  }
}
if (!rows.length) console.log("  nothing. Garmin itself has no weigh-in in that window.");
