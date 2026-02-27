import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { existsSync } from "fs";
import path from "path";
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

    // Spawn the push_single script (local dev only — requires sync/.venv)
    const syncDir = path.resolve(process.cwd(), "..", "sync");
    const pythonBin = path.join(syncDir, ".venv", "bin", "python");

    if (!existsSync(pythonBin)) {
      return NextResponse.json(
        { started: false, error: "Local sync not available — this feature requires running Soma locally with the sync/.venv Python environment." },
        { status: 503 }
      );
    }

    const child = execFile(
      pythonBin,
      ["-m", "src.push_single", source_platform, String(source_id), destination],
      {
        cwd: syncDir,
        timeout: 120_000,
        env: {
          ...process.env,
          PYTHONPATH: syncDir,
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          console.error("[sync/activity] Push error:", error.message);
        }
        if (stdout) {
          console.log("[sync/activity] stdout:", stdout);
        }
        if (stderr) {
          console.error("[sync/activity] stderr:", stderr);
        }
      }
    );

    child.unref();

    return NextResponse.json({ started: true });
  } catch (err) {
    console.error("Error triggering activity sync:", err);
    return NextResponse.json(
      { started: false, error: "Failed to trigger sync" },
      { status: 500 }
    );
  }
}
