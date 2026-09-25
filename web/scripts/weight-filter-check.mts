/**
 * Does the typo filter change any of HIS numbers? It must not.
 *
 *   cd web && set -a && . ~/.config/soma/sync.env && set +a && npx tsx scripts/weight-filter-check.mts
 *
 * His log contains no outliers, so a filter that is correct is INERT on it: the trend, the latest
 * weight and every derived figure must come out identical. This is the check that a guard against
 * bad data has not quietly changed good data.
 */
import { getDb } from "../lib/db";
import { flagOutliers } from "../lib/weight-plausibility";
import { latestWeighIn } from "../lib/weigh-ins";
import { computeWeightTrend, WEIGHT_TREND_WINDOW_DAYS } from "banister";

const sql = getDb();
const today = new Date().toISOString().slice(0, 10);

const all = (await sql`
  SELECT date::text AS date, weight_grams / 1000.0 AS weight_kg, source_type
  FROM weight_log WHERE weight_grams IS NOT NULL AND weight_grams > 0 ORDER BY date
`) as unknown as { date: string; weight_kg: number; source_type: string }[];
const rows = all.map((r) => ({ date: r.date, weightKg: Number(r.weight_kg) }));

const { kept, discarded } = flagOutliers(rows);
console.log(`${rows.length} weigh-ins in the log, ${kept.length} kept, ${discarded.length} discarded`);
for (const d of discarded) {
  const src = all.find((a) => a.date === d.date)?.source_type ?? "?";
  console.log(`  DISCARDED ${d.date}  ${d.weightKg} kg  (${src})  ${d.offByKg} kg from median ${d.localMedianKg}`);
}
console.log(discarded.length === 0 ? "PASS nothing in his log is an outlier, so the filter is inert" : "^^^ review each one above");

// The trend, both ways.
const a = computeWeightTrend(rows, today, WEIGHT_TREND_WINDOW_DAYS);
const b = computeWeightTrend(kept, today, WEIGHT_TREND_WINDOW_DAYS);
const same = JSON.stringify(a) === JSON.stringify(b);
console.log(`\ntrend unfiltered: ${JSON.stringify(a)}`);
console.log(`trend filtered:   ${JSON.stringify(b)}`);
console.log(same ? "PASS the trend is unchanged" : "FAIL the trend moved");

// The latest weight, through the new reader.
const latest = await latestWeighIn(sql, today, "check");
const naive = all[all.length - 1];
console.log(`\nlatest through the reader: ${latest ? `${latest.date} ${latest.weightKg} kg` : "(none)"}`);
console.log(`newest row in the table:   ${naive.date} ${Number(naive.weight_kg)} kg (${naive.source_type})`);
console.log(latest && latest.date === naive.date ? "PASS the reader agrees with the newest row" : "the reader differs, which is the point of it");

process.exit(discarded.length === 0 && same ? 0 : 1);
