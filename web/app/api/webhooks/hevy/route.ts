import { NextRequest, NextResponse } from "next/server";

/**
 * Hevy webhook endpoint — receives POST when a workout is saved.
 * Triggers a GitHub Actions sync workflow to fetch the new workout.
 */
export async function POST(req: NextRequest) {
  // Verify auth token
  const authHeader = req.headers.get("authorization");
  const expectedToken = process.env.HEVY_WEBHOOK_SECRET;
  if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const workoutId = body?.workoutId;

  console.log(`[Hevy Webhook] Received workout: ${workoutId}`);

  // Trigger GitHub Actions sync workflow
  const ghToken = process.env.GITHUB_PAT;
  const repo = process.env.GITHUB_REPO || "drkostas/soma";

  if (ghToken) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            event_type: "sync-trigger",
            client_payload: { source: "hevy-webhook", workoutId },
          }),
        }
      );
      console.log(`[Hevy Webhook] GitHub dispatch: ${res.status}`);
    } catch (err) {
      console.error("[Hevy Webhook] GitHub dispatch failed:", err);
    }
  } else {
    console.warn("[Hevy Webhook] No GITHUB_PAT — cannot trigger sync");
  }

  // Must respond 200 within 5 seconds
  return NextResponse.json({ ok: true, workoutId });
}
