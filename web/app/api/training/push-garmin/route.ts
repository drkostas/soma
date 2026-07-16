import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const GITHUB_OWNER = process.env.GITHUB_REPO_OWNER ?? "drkostas";
const GITHUB_REPO = process.env.GITHUB_REPO_NAME ?? "soma";

export async function POST() {
  const sql = getDb();
  const pat = process.env.GITHUB_PAT;

  if (!pat) {
    return NextResponse.json(
      { pushed: -1, error: "GITHUB_PAT not configured" },
      { status: 500 }
    );
  }

  try {
    // Check how many workouts are pending push
    const pending = await sql`
      SELECT count(*) as cnt
      FROM training_plan_day
      WHERE garmin_push_status IN ('none', 'pending')
        AND day_date >= CURRENT_DATE
        AND workout_steps IS NOT NULL
        AND run_type != 'rest'
    `;
    const pendingCount = Number(pending[0]?.cnt || 0);

    if (pendingCount === 0) {
      return NextResponse.json({ pushed: 0, message: "No pending workouts to push" });
    }

    // Trigger sync pipeline which handles Garmin push
    const resp = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event_type: "sync-trigger" }),
      }
    );

    if (!resp.ok) {
      return NextResponse.json(
        { pushed: -1, error: `GitHub API error: ${resp.status}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      pushed: pendingCount,
      message: `Triggered push for ${pendingCount} workout(s). Check Garmin Connect in ~5 min.`,
    });
  } catch (err) {
    return NextResponse.json(
      { pushed: -1, error: "Failed to trigger push" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const sql = getDb();
  const stats = await sql`
    SELECT
      count(*) FILTER (WHERE garmin_push_status = 'pushed') as pushed,
      count(*) FILTER (WHERE garmin_push_status IN ('none', 'pending') AND workout_steps IS NOT NULL AND run_type != 'rest') as pending,
      count(*) FILTER (WHERE garmin_push_status = 'failed') as failed
    FROM training_plan_day
    WHERE day_date >= CURRENT_DATE
  `;
  return NextResponse.json(stats[0] || { pushed: 0, pending: 0, failed: 0 });
}
