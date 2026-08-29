import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

interface SyncEntry {
  sync_type: string;
  status: string;
  records_synced: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

interface SourceStatus {
  status: string;
  lastSync: string;
  records: number;
  error: string | null;
}

export async function GET() {
  const sql = getDb();

  try {
    // Get the latest sync entry per sync_type
    const latestPerType = await sql`
      SELECT DISTINCT ON (sync_type)
        sync_type,
        status,
        records_synced,
        error_message,
        started_at,
        completed_at
      FROM sync_log
      ORDER BY sync_type, started_at DESC
    `;

    // No sync entries at all
    if (latestPerType.length === 0) {
      return NextResponse.json({
        lastSync: null,
        status: "never",
        recordsSynced: 0,
        error: null,
        sources: {},
      });
    }

    const rows = latestPerType as SyncEntry[];

    // Build per-source status map
    const sources: Record<string, SourceStatus> = {};
    for (const row of rows) {
      sources[row.sync_type] = {
        status: row.status,
        lastSync: row.completed_at ?? row.started_at,
        records: Number(row.records_synced) || 0,
        error: row.error_message ?? null,
      };
    }

    // Derive most-recent overall from the DISTINCT ON results
    // (the globally latest row is guaranteed to be the latest for its own sync_type)
    const mostRecent = rows.reduce((a, b) =>
      new Date(a.started_at) > new Date(b.started_at) ? a : b
    );

    // Check if any sync is currently running (stale guard: ignore > 30 min)
    const STALE_MS = 30 * 60 * 1000;
    const isRunning = rows.some(
      (r) =>
        r.status === "running" &&
        Date.now() - new Date(r.started_at).getTime() < STALE_MS
    );

    // Determine overall status
    let overallStatus: string;
    if (isRunning) {
      overallStatus = "running";
    } else {
      overallStatus = mostRecent.status;
    }

    // Recent run history + per-table data counts (pipeline operations detail).
    const historyRows = await sql`
      SELECT sync_type, status, records_synced, started_at::text AS started_at
      FROM sync_log
      ORDER BY started_at DESC
      LIMIT 8
    `;
    const history = (historyRows as Record<string, unknown>[]).map((r) => ({
      type: String(r.sync_type),
      status: String(r.status),
      records: Number(r.records_synced) || 0,
      at: String(r.started_at),
    }));

    const countRows = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM garmin_activity_raw WHERE endpoint_name = 'summary') AS activities,
        (SELECT COUNT(*)::int FROM hevy_raw_data WHERE endpoint_name = 'workout')        AS workouts,
        (SELECT COUNT(*)::int FROM daily_health_summary)                                 AS health_days
    `;
    const c = (countRows as Record<string, unknown>[])[0] ?? {};
    const tables = [
      { label: "Activities", count: Number(c.activities ?? 0) },
      { label: "Workouts", count: Number(c.workouts ?? 0) },
      { label: "Health days", count: Number(c.health_days ?? 0) },
    ];

    return NextResponse.json({
      lastSync: mostRecent.completed_at ?? mostRecent.started_at,
      status: overallStatus,
      recordsSynced: Number(mostRecent.records_synced) || 0,
      error: mostRecent.error_message ?? null,
      sources,
      history,
      tables,
    });
  } catch (err) {
    console.error("Error fetching sync status:", err);
    return NextResponse.json(
      { error: "Failed to fetch sync status" },
      { status: 500 }
    );
  }
}
