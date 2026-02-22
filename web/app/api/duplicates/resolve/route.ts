import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

interface ResolveRequest {
  survivorId: number;
  deleteId: number;
  mergedFields: {
    activityName?: string;
    activityType?: { typeKey: string };
    startTimeGMT?: string;
    duration?: number;
    distance?: number;
    calories?: number;
    averageHR?: number;
    maxHR?: number;
  };
}

export async function POST(request: Request) {
  const sql = neon(process.env.DATABASE_URL!);

  try {
    const body: ResolveRequest = await request.json();
    const { survivorId, deleteId, mergedFields } = body;

    if (!survivorId || !deleteId || survivorId === deleteId) {
      return NextResponse.json(
        { error: "Invalid survivorId/deleteId" },
        { status: 400 }
      );
    }

    // Step 1: Update survivor's summary JSON with merged fields
    // Fetch current summary
    const [survivor] = await sql`
      SELECT raw_json FROM garmin_activity_raw
      WHERE activity_id = ${survivorId} AND endpoint_name = 'summary'
    `;

    if (!survivor) {
      return NextResponse.json(
        { error: `Survivor activity ${survivorId} not found` },
        { status: 404 }
      );
    }

    const updatedJson = { ...survivor.raw_json };

    // Apply merged fields
    if (mergedFields.activityName !== undefined)
      updatedJson.activityName = mergedFields.activityName;
    if (mergedFields.activityType !== undefined)
      updatedJson.activityType = { ...updatedJson.activityType, ...mergedFields.activityType };
    if (mergedFields.startTimeGMT !== undefined)
      updatedJson.startTimeGMT = mergedFields.startTimeGMT;
    if (mergedFields.duration !== undefined)
      updatedJson.duration = mergedFields.duration;
    if (mergedFields.distance !== undefined)
      updatedJson.distance = mergedFields.distance;
    if (mergedFields.calories !== undefined)
      updatedJson.calories = mergedFields.calories;
    if (mergedFields.averageHR !== undefined)
      updatedJson.averageHR = mergedFields.averageHR;
    if (mergedFields.maxHR !== undefined)
      updatedJson.maxHR = mergedFields.maxHR;

    // Update in DB
    await sql`
      UPDATE garmin_activity_raw
      SET raw_json = ${JSON.stringify(updatedJson)}::jsonb, synced_at = NOW()
      WHERE activity_id = ${survivorId} AND endpoint_name = 'summary'
    `;

    // Step 2: Delete the loser from Garmin Connect + DB via Python script
    const syncDir = path.resolve(process.cwd(), "..", "sync");
    const pythonBin = path.join(syncDir, ".venv", "bin", "python");

    let garminDeleted = false;
    let dbRowsDeleted = 0;

    try {
      const { stdout, stderr } = await execFileAsync(
        pythonBin,
        ["-m", "src.delete_activity", String(deleteId)],
        { cwd: syncDir, env: { ...process.env, PYTHONPATH: syncDir }, timeout: 60_000 }
      );
      console.log("[dedup] Delete output:", stdout);
      if (stderr) console.error("[dedup] Delete stderr:", stderr);
      garminDeleted = stdout.includes("Deleted activity") && stdout.includes("from Garmin");
      const match = stdout.match(/Deleted (\d+) rows/);
      dbRowsDeleted = match ? parseInt(match[1]) : 0;
    } catch (error: any) {
      console.error("[dedup] Delete failed:", error.message);
      // Even if Garmin delete fails, clean up DB
      await sql`DELETE FROM garmin_activity_raw WHERE activity_id = ${deleteId}`;
      dbRowsDeleted = -1; // indicate fallback
    }

    return NextResponse.json({
      success: true,
      survivorId,
      deleteId,
      garminDeleted,
      dbRowsDeleted,
    });
  } catch (error: any) {
    console.error("Resolve error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
