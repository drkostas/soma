import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createHmac, randomBytes } from "crypto";

/**
 * Vercel cron endpoint: refreshes Garmin OAuth tokens every 12 hours.
 *
 * Implements the OAuth1 → OAuth2 token exchange that garth/garminconnect uses,
 * but in TypeScript so it can run on Vercel's infrastructure (different IP than
 * GitHub Actions, avoiding shared-IP rate limits).
 *
 * Token flow:
 * 1. Load OAuth1 + OAuth2 tokens from platform_credentials (Neon DB)
 * 2. If OAuth2 has >2 hours remaining, skip (no refresh needed)
 * 3. Sign an OAuth1 request to Garmin's exchange endpoint
 * 4. POST to get a fresh OAuth2 token
 * 5. Save both tokens back to DB
 */

export const runtime = "nodejs"; // need crypto module
export const maxDuration = 30;

// OAuth1 signature generation for Garmin (empty consumer key/secret)
function oauthSign(
  method: string,
  url: string,
  params: Record<string, string>,
  tokenSecret: string,
): string {
  // Garmin uses empty consumer secret
  const signingKey = `&${encodeURIComponent(tokenSecret)}`;
  const sortedParams = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
  const hmac = createHmac("sha1", signingKey);
  hmac.update(baseString);
  return hmac.digest("base64");
}

function buildOAuthHeader(
  url: string,
  oauthToken: string,
  oauthTokenSecret: string,
): string {
  const nonce = randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: "",
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: oauthToken,
    oauth_version: "1.0",
  };

  const signature = oauthSign("POST", url, oauthParams, oauthTokenSecret);
  oauthParams.oauth_signature = signature;

  const header = Object.entries(oauthParams)
    .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
    .join(", ");
  return `OAuth ${header}`;
}

export async function POST(req: Request) {
  // Auth: Vercel crons send Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();

  try {
    // 1. Load tokens from DB
    const rows = await sql`
      SELECT credentials FROM platform_credentials WHERE platform = 'garmin_tokens' LIMIT 1
    `;
    if (!rows[0]?.credentials) {
      return NextResponse.json({ error: "No tokens in DB" }, { status: 404 });
    }

    const tokens = typeof rows[0].credentials === "string"
      ? JSON.parse(rows[0].credentials)
      : rows[0].credentials;

    // Tokens are stored with file-based keys from garth
    const oauth1Raw = tokens["oauth1_token.json"] || tokens.oauth1_token;
    const oauth2Raw = tokens["oauth2_token.json"] || tokens.oauth2_token;
    const oauth1 = typeof oauth1Raw === "string" ? JSON.parse(oauth1Raw) : oauth1Raw;
    const oauth2 = typeof oauth2Raw === "string" ? JSON.parse(oauth2Raw) : oauth2Raw;

    if (!oauth1?.oauth_token || !oauth1?.oauth_token_secret) {
      return NextResponse.json({ error: "Missing OAuth1 token" }, { status: 400 });
    }

    // 2. Check if refresh is needed (>2 hours remaining = skip)
    const expiresAt = oauth2?.expires_at || 0;
    const hoursRemaining = (expiresAt - Date.now() / 1000) / 3600;
    if (hoursRemaining > 2) {
      return NextResponse.json({
        status: "skipped",
        message: `Token still valid (${hoursRemaining.toFixed(1)}h remaining)`,
      });
    }

    // 3. Exchange OAuth1 → OAuth2
    const exchangeUrl = `https://connectapi.${oauth1.domain || "garmin.com"}/oauth-service/oauth/exchange/user/2.0`;
    const authHeader2 = buildOAuthHeader(exchangeUrl, oauth1.oauth_token, oauth1.oauth_token_secret);

    const resp = await fetch(exchangeUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader2,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "GarminConnect/4.73 (SomaNutrition)",
      },
      body: "", // empty body for exchange
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({
        error: `Exchange failed: ${resp.status}`,
        detail: text,
      }, { status: resp.status });
    }

    const newOAuth2 = await resp.json();

    // Set expiration timestamps
    const now = Math.floor(Date.now() / 1000);
    newOAuth2.expires_at = now + (newOAuth2.expires_in || 86400);
    newOAuth2.refresh_token_expires_at = now + (newOAuth2.refresh_token_expires_in || 7776000);

    // 4. Save back to DB (use same key format as garth)
    tokens["oauth2_token.json"] = newOAuth2;
    if (tokens.oauth2_token) tokens.oauth2_token = newOAuth2;
    await sql`
      UPDATE platform_credentials
      SET credentials = ${JSON.stringify(tokens)}
      WHERE platform = 'garmin_tokens'
    `;

    return NextResponse.json({
      status: "refreshed",
      expires_at: new Date(newOAuth2.expires_at * 1000).toISOString(),
      hours_valid: ((newOAuth2.expires_at - now) / 3600).toFixed(1),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET for manual testing
export async function GET(req: Request) {
  return POST(req);
}
