import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

const VALID_PLATFORMS = ["garmin", "hevy", "strava", "surfr"];

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const sql = getDb();
  const { platform } = await params;

  if (!VALID_PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }

  try {
    const rows = await sql`
      UPDATE platform_credentials
      SET status = 'disconnected', credentials = '{}'::jsonb
      WHERE platform = ${platform}
      RETURNING platform
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Platform not found" }, { status: 404 });
    }

    return NextResponse.json({ disconnected: true, platform });
  } catch (err) {
    console.error("Error disconnecting platform:", err);
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }
}
