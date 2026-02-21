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

    return NextResponse.json({
      lastSync: mostRecent.completed_at ?? mostRecent.started_at,
      status: overallStatus,
      recordsSynced: Number(mostRecent.records_synced) || 0,
      error: mostRecent.error_message ?? null,
      sources,
    });
  } catch (err) {
    console.error("Error fetching sync status:", err);
    return NextResponse.json(
      { error: "Failed to fetch sync status" },
      { status: 500 }
    );
  }
}
