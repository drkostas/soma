import type { QueryFn } from "@/lib/db";
import { runStatus, type RunStatus } from "@/lib/run-status";
import { todayKey } from "@/lib/freshness";

/** soma's own running load (training_load, source garmin_running), last 35 days → RunStatus. */
export async function loadRunStatus(sql: QueryFn, today: string = todayKey()): Promise<RunStatus> {
  // The demo database is a subset without training_load: no runs, not a 500.
  let rows: { date: string; load: number }[] = [];
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
    rows = [];
  }
  return runStatus(rows.map((r) => ({ date: r.date.slice(0, 10), load: Number(r.load) || 0 })), today);
}
