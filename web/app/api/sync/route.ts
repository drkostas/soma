import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const GITHUB_OWNER = "drkostas";
const GITHUB_REPO = "soma";

export async function POST() {
  const sql = getDb();

  try {
    // Prevent double-triggering if a sync is already running
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

    const pat = process.env.GITHUB_PAT;
    if (!pat) {
      return NextResponse.json(
        { started: false, error: "GITHUB_PAT not configured" },
        { status: 500 }
      );
    }

    // Trigger GitHub Actions workflow via repository_dispatch
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
      const text = await resp.text();
      console.error("[sync] GitHub dispatch failed:", resp.status, text);
      return NextResponse.json(
        { started: false, error: `GitHub API error: ${resp.status}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ started: true });
  } catch (err) {
    console.error("Error triggering sync:", err);
    return NextResponse.json(
      { started: false, error: "Failed to trigger sync" },
      { status: 500 }
    );
  }
}
