import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get("code");
  const state = sp.get("state");
  const error = sp.get("error");
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3456";

  if (error || !code) {
    return NextResponse.redirect(`${baseUrl}/connections?error=spotify_denied`);
  }

  const verifier = req.cookies.get("spotify_pkce_verifier")?.value;
  const storedState = req.cookies.get("spotify_state")?.value;

  if (!verifier || state !== storedState) {
    return NextResponse.redirect(
      `${baseUrl}/connections?error=spotify_invalid`
    );
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      code_verifier: verifier,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error("Spotify token exchange failed:", err);
    return NextResponse.redirect(
      `${baseUrl}/connections?error=spotify_token`
    );
  }

  const tokens = await tokenRes.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  // Fetch Spotify user profile
  const profileRes = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = profileRes.ok ? await profileRes.json() : null;

  // Store credentials in DB
  const sql = getDb();
  await sql`
    INSERT INTO platform_credentials (platform, auth_type, credentials, connected_at, expires_at, status)
    VALUES (
      'spotify',
      'oauth2',
      ${JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        display_name: profile?.display_name ?? null,
        spotify_user_id: profile?.id ?? null,
      })}::jsonb,
      NOW(),
      ${expiresAt},
      'active'
    )
    ON CONFLICT (platform) DO UPDATE SET
      credentials = EXCLUDED.credentials,
      expires_at = EXCLUDED.expires_at,
      connected_at = NOW(),
      status = 'active'
  `;

  const res = NextResponse.redirect(`${baseUrl}/connections?connected=spotify`);
  res.cookies.delete("spotify_pkce_verifier");
  res.cookies.delete("spotify_state");
  return res;
}
