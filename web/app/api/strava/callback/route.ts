import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  if (error || !code) {
    return NextResponse.redirect(
      `${baseUrl}/connections?error=${error || "no_code"}`
    );
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Strava credentials not configured" },
      { status: 500 }
    );
  }

  // Exchange authorization code for tokens
  const tokenResp = await fetch("https://www.strava.com/api/v3/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResp.ok) {
    const err = await tokenResp.text();
    console.error("Strava token exchange failed:", err);
    return NextResponse.redirect(
      `${baseUrl}/connections?error=token_exchange_failed`
    );
  }

  const tokens = await tokenResp.json();

  // Store credentials in DB
  const sql = getDb();
  await sql`
    INSERT INTO platform_credentials (platform, auth_type, credentials, connected_at, expires_at, status)
    VALUES (
      'strava',
      'oauth2',
      ${JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        athlete_id: tokens.athlete?.id,
        athlete_name: tokens.athlete
          ? `${tokens.athlete.firstname} ${tokens.athlete.lastname}`
          : null,
      })}::jsonb,
      NOW(),
      to_timestamp(${tokens.expires_at}),
      'active'
    )
    ON CONFLICT (platform) DO UPDATE SET
      credentials = EXCLUDED.credentials,
      expires_at = EXCLUDED.expires_at,
      status = 'active'
  `;

  return NextResponse.redirect(
    `${baseUrl}/connections?connected=strava`
  );
}
