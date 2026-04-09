import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * Store Garmin DI OAuth tokens obtained via the Cloudflare Worker exchange.
 *
 * Flow: user signs into Garmin SSO in their browser (residential IP, MFA
 * handled natively by Garmin's own UI), copies the ticket URL, frontend
 * sends the ticket to the Cloudflare Worker which exchanges it for a
 * DI OAuth token at `diauth.garmin.com`, then POSTs the result here for
 * persistence in `platform_credentials.credentials` (wrapped under the
 * ``garmin_tokens`` key so the Python-side `garmin-auth>=0.3.0`
 * ``DBTokenStore`` can read it).
 */
export async function POST(req: NextRequest) {
  const sql = getDb();

  try {
    const body = await req.json();
    // Accept either a top-level DI payload or a nested ``tokens`` wrapper
    // (the CF Worker returns top-level; some clients wrap it).
    const tokens = body?.tokens ?? body;

    if (!tokens?.di_token || !tokens?.di_refresh_token || !tokens?.di_client_id) {
      return NextResponse.json(
        { error: "Invalid tokens — expected di_token, di_refresh_token, di_client_id" },
        { status: 400 },
      );
    }

    const payload = {
      di_token: tokens.di_token,
      di_refresh_token: tokens.di_refresh_token,
      di_client_id: tokens.di_client_id,
    };
    // garmin-auth >= 0.3.0 DBTokenStore wraps the DI payload under the
    // ``garmin_tokens`` key inside the credentials JSONB column.
    const credentials = JSON.stringify({ garmin_tokens: payload });

    await sql`
      INSERT INTO platform_credentials (platform, auth_type, credentials, status, connected_at)
      VALUES ('garmin_tokens', 'oauth', ${credentials}::jsonb, 'active', NOW())
      ON CONFLICT (platform)
      DO UPDATE SET credentials = ${credentials}::jsonb,
                    status = 'active',
                    connected_at = NOW()
    `;

    // Also mark the user-facing ``garmin`` platform row as active so the
    // connections dashboard reflects the state immediately.
    await sql`
      UPDATE platform_credentials
      SET status = 'active', connected_at = NOW()
      WHERE platform = 'garmin'
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Error storing Garmin tokens:", err);
    return NextResponse.json(
      { error: "Failed to store tokens" },
      { status: 500 },
    );
  }
}
