import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

async function getStravaToken(sql: ReturnType<typeof getDb>): Promise<string | null> {
  const rows = await sql`
    SELECT credentials, expires_at FROM platform_credentials
    WHERE platform = 'strava' AND status = 'active'
    LIMIT 1
  `;
  if (!rows.length) return null;

  const row = rows[0] as { credentials: Record<string, string>; expires_at: string | null };
  const { credentials, expires_at } = row;
  const accessToken = credentials?.access_token;
  const refreshToken = credentials?.refresh_token;
  if (!accessToken) return null;

  // Still valid (with 5 min buffer)
  const expiresAt = expires_at ? new Date(expires_at).getTime() : 0;
  if (Date.now() + 5 * 60 * 1000 < expiresAt) return accessToken;

  // Refresh
  if (!refreshToken) return null;
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const refreshResp = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!refreshResp.ok) return null;

  const tokens = await refreshResp.json();
  await sql`
    UPDATE platform_credentials SET
      credentials = ${JSON.stringify({ ...credentials, access_token: tokens.access_token, refresh_token: tokens.refresh_token })}::jsonb,
      expires_at = to_timestamp(${tokens.expires_at as number}),
      status = 'active'
    WHERE platform = 'strava'
  `;
  return tokens.access_token as string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { branding?: boolean };
  const showBranding = body.branding !== false;

  const sql = getDb();

  // Get Strava destination activity ID
  const syncRows = await sql`
    SELECT destination_id FROM activity_sync_log
    WHERE source_id = ${id}
      AND destination = 'strava'
      AND status IN ('sent', 'external')
    LIMIT 1
  `;
  const stravaActivityId = (syncRows[0] as { destination_id: string | null } | undefined)?.destination_id;
  if (!stravaActivityId) {
    return NextResponse.json({ error: "Activity not synced to Strava yet. Sync it first from the Connections page." }, { status: 400 });
  }

  // Get Strava token
  const token = await getStravaToken(sql);
  if (!token) {
    return NextResponse.json({ error: "Strava not connected. Connect Strava in the Connections page." }, { status: 401 });
  }

  // Fetch the generated image
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3456";
  const brandingParam = showBranding ? "1" : "0";
  const imageResp = await fetch(`${baseUrl}/api/activity/${id}/image?branding=${brandingParam}`);
  if (!imageResp.ok) {
    return NextResponse.json({ error: "Failed to generate activity image" }, { status: 500 });
  }
  const imageBuffer = await imageResp.arrayBuffer();

  // Upload photo to Strava
  const formData = new FormData();
  formData.append("file", new Blob([imageBuffer], { type: "image/png" }), "soma-run.png");

  const uploadResp = await fetch(
    `https://www.strava.com/api/v3/activities/${stravaActivityId}/photos`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    }
  );

  if (!uploadResp.ok) {
    const errText = await uploadResp.text().catch(() => "");
    return NextResponse.json(
      { error: `Strava upload failed (${uploadResp.status}): ${errText.slice(0, 200)}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
