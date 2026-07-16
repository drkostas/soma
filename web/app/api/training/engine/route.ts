import { NextResponse } from "next/server";

export const runtime = "nodejs";

const GITHUB_OWNER = process.env.GITHUB_REPO_OWNER ?? "drkostas";
const GITHUB_REPO = process.env.GITHUB_REPO_NAME ?? "soma";

export async function POST() {
  const pat = process.env.GITHUB_PAT;
  if (!pat) {
    return NextResponse.json(
      { started: false, error: "GITHUB_PAT not configured" },
      { status: 500 }
    );
  }

  try {
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
      return NextResponse.json(
        { started: false, error: `GitHub API error: ${resp.status}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ started: true });
  } catch (err) {
    return NextResponse.json(
      { started: false, error: "Failed to trigger engine" },
      { status: 500 }
    );
  }
}
