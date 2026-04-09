import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * Garmin token status endpoint.
 *
 * Auth is handled by the `garmin-auth >= 0.3.0` Python package in the
 * sync pipeline. This endpoint only reports whether a DI OAuth token is
 * stored. We cannot decode the JWT expiration cheaply here (it is server
 * signed) so we just report presence/absence. Token refresh is handled
 * automatically by the Python `garminconnect` client when tokens are used.
 */

export const runtime = "nodejs";

function decodeDiTokenExpiry(token: string): number | null {
  // DI access tokens are JWTs; parse the payload to pull `exp`.
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const sql = getDb();

  try {
    const rows = await sql`
      SELECT credentials FROM platform_credentials WHERE platform = 'garmin_tokens' LIMIT 1
    `;
    if (!rows[0]?.credentials) {
      return NextResponse.json({ status: "no_tokens" }, { status: 404 });
    }

    const credentials = typeof rows[0].credentials === "string"
      ? JSON.parse(rows[0].credentials)
      : rows[0].credentials;

    // New format (garmin-auth >= 0.3.0): wrapped under ``garmin_tokens``.
    const tokens = credentials?.garmin_tokens ?? null;
    if (!tokens?.di_token) {
      // Legacy rows (oauth1/oauth2) from garmin-auth < 0.3.0 are no longer
      // refreshable; surface them as expired so the UI prompts re-auth.
      return NextResponse.json({
        status: "expired",
        message: "Token in legacy format — re-authenticate to upgrade",
      });
    }

    const expUnix = decodeDiTokenExpiry(tokens.di_token);
    if (!expUnix) {
      return NextResponse.json({
        status: "stored",
        message: "DI token present but expiry could not be parsed",
      });
    }
    const hoursRemaining = (expUnix - Date.now() / 1000) / 3600;
    return NextResponse.json({
      status: hoursRemaining > 0 ? "valid" : "expired",
      hours_remaining: +hoursRemaining.toFixed(1),
      expires_at: new Date(expUnix * 1000).toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
