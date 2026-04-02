import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * Garmin token status endpoint.
 *
 * Auth is now handled by the garmin-auth Python package in the sync pipeline.
 * This endpoint only reports token freshness for monitoring.
 */

export const runtime = "nodejs";

export async function GET() {
  const sql = getDb();

  try {
    const rows = await sql`
      SELECT credentials FROM platform_credentials WHERE platform = 'garmin_tokens' LIMIT 1
    `;
    if (!rows[0]?.credentials) {
      return NextResponse.json({ status: "no_tokens" }, { status: 404 });
    }

    const tokens = typeof rows[0].credentials === "string"
      ? JSON.parse(rows[0].credentials)
      : rows[0].credentials;

    const oauth2Raw = tokens["oauth2_token.json"] || tokens.oauth2_token;
    const oauth2 = oauth2Raw
      ? (typeof oauth2Raw === "string" ? JSON.parse(oauth2Raw) : oauth2Raw)
      : null;

    const expiresAt = oauth2?.expires_at || 0;
    const hoursRemaining = (expiresAt - Date.now() / 1000) / 3600;

    return NextResponse.json({
      status: hoursRemaining > 0 ? "valid" : "expired",
      hours_remaining: +hoursRemaining.toFixed(1),
      expires_at: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET();
}
