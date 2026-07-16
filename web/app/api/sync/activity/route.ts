import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { source_platform, source_id, destination, force } = body;

    if (!source_platform || !source_id || !destination) {
      return NextResponse.json(
        { error: "source_platform, source_id, and destination are required" },
        { status: 400 }
      );
    }

    if (!["garmin", "hevy"].includes(source_platform)) {
      return NextResponse.json(
        { error: "source_platform must be 'garmin' or 'hevy'" },
        { status: 400 }
      );
    }

    if (destination !== "strava") {
      return NextResponse.json(
        { error: "Only 'strava' destination is supported" },
        { status: 400 }
      );
    }

    // Check if already synced (skip check if force=true for re-sync)
    const sql = getDb();
    if (!force) {
      const existing = await sql`
        SELECT id FROM activity_sync_log
        WHERE source_platform = ${source_platform}
          AND source_id = ${String(source_id)}
          AND destination = ${destination}
          AND status IN ('sent', 'external')
        LIMIT 1
      `;

      if (existing.length > 0) {
        return NextResponse.json(
          { started: false, reason: "Already synced" },
          { status: 409 }
        );
      }
    }

    // Single-activity push to Strava is now handled automatically by the TS
    // Strava bridge (strava-bridge-ts.yml, 11/15/19 UTC): it forwards every
    // recent Garmin activity not yet on Strava, deduped, and finalizes it
    // (title/description/image). The old local `push_single` Python tool was
    // retired with sync/ (#187), so there is no manual per-activity push here.
    return NextResponse.json(
      {
        started: false,
        error: "Strava forwarding is automatic now — the bridge picks this up on its next run (11/15/19 UTC). No manual push needed.",
      },
      { status: 503 }
    );
  } catch (err) {
    console.error("Error triggering activity sync:", err);
    return NextResponse.json(
      { started: false, error: "Failed to trigger sync" },
      { status: 500 }
    );
  }
}
