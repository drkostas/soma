import type { QueryFn } from "@/lib/db";
import { runStatus, unknownRunStatus, type RunStatus } from "@/lib/run-status";
import { todayKey } from "banister";

/**
 * soma's own running load (training_load, source garmin_running), last 35 days.
 *
 * This used to swallow a query failure into an empty list (#1004), so a missing
 * or unpopulated `training_load` rendered as "No runs in 4 weeks / no run
 * recorded" next to a header reporting 25 runs. Those contradict each other,
 * and the card was the one lying: it has no way to know there were no runs.
 *
 * So the two cases are now told apart, which is cheap:
 *   - the query fails, or the table holds nothing at all → the load pipeline
 *     has not written it, and we do not know → unknown
 *   - the table holds rows but none for running in the window → there really
 *     were no runs, which is the useful claim and stays
 */
export async function loadRunStatus(sql: QueryFn, today: string = todayKey()): Promise<RunStatus> {
  let rows: { date: string; load: number }[];
  try {
    rows = (await sql`
      SELECT activity_date::text AS date, SUM(load_value)::float AS load
      FROM training_load
      WHERE source = 'garmin_running'
        AND activity_date >= CURRENT_DATE - 35
      GROUP BY activity_date
      ORDER BY activity_date
    `) as { date: string; load: number }[];
  } catch {
    // A missing table or an unreachable database. Either way there is nothing
    // to read a trend from, and saying "no runs" would be an invention.
    return unknownRunStatus();
  }

  if (rows.length === 0) {
    // Empty could be "no runs lately" or "nothing ever wrote this table". One
    // row of any source settles it.
    try {
      const any = (await sql`SELECT 1 AS present FROM training_load LIMIT 1`) as unknown[];
      if (any.length === 0) return unknownRunStatus();
    } catch {
      return unknownRunStatus();
    }
  }

  return runStatus(
    rows.map((r) => ({ date: r.date.slice(0, 10), load: Number(r.load) || 0 })),
    today,
  );
}
