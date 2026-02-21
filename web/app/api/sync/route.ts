import { NextResponse } from "next/server";
import { execFile } from "child_process";
import path from "path";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST() {
  const sql = getDb();

  try {
    // Check for a sync already running (started within the last 10 minutes)
    const running = await sql`
      SELECT id, started_at
      FROM sync_log
      WHERE status = 'running'
        AND started_at >= NOW() - INTERVAL '10 minutes'
      ORDER BY started_at DESC
      LIMIT 1
    `;

    if (running.length > 0) {
      return NextResponse.json(
        { started: false, reason: "Sync already running" },
        { status: 409 }
      );
    }

    // Resolve paths
    const syncDir = path.resolve(process.cwd(), "..", "sync");
    const pythonBin = path.join(syncDir, ".venv", "bin", "python");

    // Spawn the pipeline (fire-and-forget)
    const child = execFile(
      pythonBin,
      ["-m", "src.pipeline", "1"],
      {
        cwd: syncDir,
        timeout: 300_000, // 5 minutes
        env: {
          ...process.env,
          PYTHONPATH: syncDir,
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          console.error("[sync] Pipeline error:", error.message);
        }
        if (stdout) {
          console.log("[sync] Pipeline stdout:\n", stdout);
        }
        if (stderr) {
          console.error("[sync] Pipeline stderr:\n", stderr);
        }
      }
    );

    // Detach so the HTTP response doesn't wait for the child
    child.unref();

    return NextResponse.json({ started: true });
  } catch (err) {
    console.error("Error triggering sync:", err);
    return NextResponse.json(
      { started: false, error: "Failed to trigger sync" },
      { status: 500 }
    );
  }
}
