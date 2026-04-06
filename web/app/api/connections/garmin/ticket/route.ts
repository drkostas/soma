import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * Store Garmin OAuth tokens obtained via the Cloudflare Worker exchange.
 *
 * Flow: user signs into Garmin SSO in their browser (residential IP),
 * copies the ticket URL, frontend sends ticket to CF Worker which
 * exchanges it for OAuth1+OAuth2 tokens, then POSTs them here for storage.
 */
export async function POST(req: NextRequest) {
  const sql = getDb();

  try {
    const { oauth1, oauth2 } = await req.json();

    if (!oauth1?.oauth_token || !oauth2?.access_token) {
      return NextResponse.json(
        { error: "Invalid tokens — missing oauth_token or access_token" },
        { status: 400 },
      );
    }

    const tokens = {
      "oauth1_token.json": oauth1,
      "oauth2_token.json": oauth2,
    };

    // Store in platform_credentials as garmin_tokens (same format garmin-auth expects)
    await sql`
      INSERT INTO platform_credentials (platform, auth_type, credentials, status, connected_at)
      VALUES ('garmin_tokens', 'oauth', ${JSON.stringify(tokens)}::jsonb, 'active', NOW())
      ON CONFLICT (platform)
      DO UPDATE SET credentials = ${JSON.stringify(tokens)}::jsonb,
                    status = 'active',
                    connected_at = NOW()
    `;

    // Also update garmin platform status
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
