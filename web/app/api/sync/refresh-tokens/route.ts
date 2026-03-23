import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createHmac, randomBytes } from "crypto";

/**
 * Self-healing Garmin token refresh endpoint.
 *
 * Called by GitHub Actions before every sync run. Ensures the DB always has
 * a valid OAuth2 token. Two strategies:
 *
 * 1. Fast path: OAuth1 → OAuth2 exchange (if OAuth1 is still valid)
 * 2. Full login: email/password SSO flow → fresh OAuth1 + OAuth2
 *
 * The pipeline on GitHub Actions reads tokens from DB and never touches
 * Garmin's auth servers directly.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const DOMAIN = "garmin.com";
const SSO_BASE = `https://sso.${DOMAIN}/sso`;
const API_BASE = `https://connectapi.${DOMAIN}`;
const USER_AGENT = "GCM-iOS-5.7.2.1";
const CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json";

// ── OAuth1 signing ──────────────────────────────────────────────────────────

function oauthSign(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
): string {
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  const sortedParams = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
  return createHmac("sha1", signingKey).update(baseString).digest("base64");
}

function buildOAuth1Header(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  oauthToken: string,
  oauthTokenSecret: string,
  extraParams?: Record<string, string>,
): string {
  const nonce = randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_version: "1.0",
    ...(oauthToken ? { oauth_token: oauthToken } : {}),
  };

  // Include query params + extra params in signature base
  const urlObj = new URL(url);
  const allParams: Record<string, string> = { ...oauthParams };
  urlObj.searchParams.forEach((v, k) => { allParams[k] = v; });
  if (extraParams) Object.assign(allParams, extraParams);

  const signature = oauthSign(method, url.split("?")[0], allParams, consumerSecret, oauthTokenSecret);
  oauthParams.oauth_signature = signature;

  const header = Object.entries(oauthParams)
    .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
    .join(", ");
  return `OAuth ${header}`;
}

// ── Cookie jar (simple implementation for SSO flow) ─────────────────────────

class CookieJar {
  private cookies: Record<string, string> = {};

  capture(resp: Response) {
    // getSetCookie() returns individual cookies; fall back to raw header parsing
    let cookieHeaders: string[] = [];
    if (typeof resp.headers.getSetCookie === "function") {
      cookieHeaders = resp.headers.getSetCookie();
    }
    if (!cookieHeaders.length) {
      const raw = resp.headers.get("set-cookie");
      if (raw) cookieHeaders = raw.split(/,(?=\s*[A-Za-z_]+=)/);
    }
    for (const header of cookieHeaders) {
      const [kv] = header.split(";");
      const eq = kv.indexOf("=");
      if (eq > 0) {
        this.cookies[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
      }
    }
  }

  toString(): string {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

// ── OAuth1 → OAuth2 exchange (fast path) ────────────────────────────────────

async function exchangeOAuth1ForOAuth2(
  oauth1: { oauth_token: string; oauth_token_secret: string; domain?: string },
): Promise<Record<string, any>> {
  const domain = oauth1.domain || DOMAIN;
  const exchangeUrl = `https://connectapi.${domain}/oauth-service/oauth/exchange/user/2.0`;

  // Use empty consumer key/secret for exchange (garth convention)
  const authHeader = buildOAuth1Header("POST", exchangeUrl, "", "", oauth1.oauth_token, oauth1.oauth_token_secret);

  const resp = await fetch(exchangeUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: "",
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Exchange failed (${resp.status}): ${text.slice(0, 200)}`);
  }

  const oauth2 = await resp.json();
  const now = Math.floor(Date.now() / 1000);
  oauth2.expires_at = now + (oauth2.expires_in || 86400);
  oauth2.refresh_token_expires_at = now + (oauth2.refresh_token_expires_in || 7776000);
  return oauth2;
}

// ── Full email/password login (fallback) ────────────────────────────────────

async function fullLogin(email: string, password: string): Promise<{
  oauth1: Record<string, any>;
  oauth2: Record<string, any>;
}> {
  const jar = new CookieJar();
  const embedParams = new URLSearchParams({
    id: "gauth-widget",
    embedWidget: "true",
    gauthHost: SSO_BASE,
  });

  // Helper: fetch with cookie tracking (follows redirects, captures cookies from each hop)
  async function ssoFetch(url: string, init?: RequestInit): Promise<{ resp: Response; body: string }> {
    // Manual redirect loop to capture cookies at each hop
    let currentUrl = url;
    let resp: Response;
    let hops = 0;
    const mergedInit = { ...init, redirect: "manual" as const };
    while (hops < 10) {
      resp = await fetch(currentUrl, {
        ...mergedInit,
        headers: { ...mergedInit.headers as Record<string, string>, Cookie: jar.toString() },
      });
      jar.capture(resp);
      if ([301, 302, 303, 307, 308].includes(resp.status)) {
        const loc = resp.headers.get("location");
        await resp.text(); // consume
        if (!loc) break;
        currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
        // Switch to GET after redirect (except 307/308)
        if ([301, 302, 303].includes(resp.status)) {
          mergedInit.method = "GET";
          delete mergedInit.body;
        }
        hops++;
        continue;
      }
      break;
    }
    const body = await resp!.text();
    return { resp: resp!, body };
  }

  // Step 1: Initialize SSO session (set cookies)
  await ssoFetch(`${SSO_BASE}/embed?${embedParams}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  // Step 2: Get CSRF token from signin page
  const signinParams = new URLSearchParams({
    id: "gauth-widget",
    embedWidget: "true",
    gauthHost: SSO_BASE,
    service: `${SSO_BASE}/embed`,
    source: `${SSO_BASE}/embed`,
    redirectAfterAccountLoginUrl: `${SSO_BASE}/embed`,
    redirectAfterAccountCreationUrl: `${SSO_BASE}/embed`,
  });

  const { body: signinHtml } = await ssoFetch(`${SSO_BASE}/signin?${signinParams}`, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: `${SSO_BASE}/embed?${embedParams}`,
    },
  });

  const csrfMatch = signinHtml.match(/name="_csrf"\s+value="(.+?)"/);
  if (!csrfMatch) throw new Error("Could not extract CSRF token from signin page");
  const csrf = csrfMatch[1];

  // Step 3: Submit credentials (follow redirects to capture ticket)
  const { resp: loginResp, body: loginHtml } = await ssoFetch(`${SSO_BASE}/signin?${signinParams}`, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Referer: `${SSO_BASE}/signin?${signinParams}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      username: email,
      password: password,
      embed: "true",
      _csrf: csrf,
    }).toString(),
  });

  // Check for MFA (not supported — would need user interaction)
  if (loginHtml.includes("MFA") && !loginHtml.includes("ticket=")) {
    throw new Error("MFA required — cannot auto-login. Disable MFA or use a manual login.");
  }

  // Step 4: Extract ticket from response body
  const ticketMatch = loginHtml.match(/embed\?ticket=([^"&]+)/);
  if (!ticketMatch) {
    const title = loginHtml.match(/<title>(.*?)<\/title>/)?.[1] || "unknown";
    if (loginHtml.includes("locked")) throw new Error("Account locked by Garmin");
    if (loginHtml.includes("incorrect")) throw new Error("Invalid email/password");
    // Extract any error message from the page
    const errorMsg = loginHtml.match(/data-error="([^"]+)"/)?.[1]
      || loginHtml.match(/class="error"[^>]*>([^<]+)/)?.[1]
      || loginHtml.match(/status-msg[^>]*>([^<]+)/)?.[1]
      || "";
    throw new Error(`Login failed — no ticket (title: ${title}, status: ${loginResp.status}, error: ${errorMsg}, cookies: ${jar.toString().length}ch, csrf: ${csrf.slice(0, 8)}...)`);
  }
  const ticket = ticketMatch[1];

  // Step 5: Fetch OAuth consumer credentials from S3
  const consumerResp = await fetch(CONSUMER_URL);
  if (!consumerResp.ok) throw new Error(`Failed to fetch consumer credentials: ${consumerResp.status}`);
  const consumer = await consumerResp.json();
  const consumerKey = consumer.consumer_key;
  const consumerSecret = consumer.consumer_secret;

  // Step 6: Exchange ticket for OAuth1 token
  const preauthUrl = `${API_BASE}/oauth-service/oauth/preauthorized?ticket=${encodeURIComponent(ticket)}&login-url=${encodeURIComponent(`${SSO_BASE}/embed`)}&accepts-mfa-tokens=true`;

  const preauthHeader = buildOAuth1Header(
    "GET", preauthUrl, consumerKey, consumerSecret, "", "",
  );

  const preauthResp = await fetch(preauthUrl, {
    headers: {
      Authorization: preauthHeader,
      "User-Agent": "com.garmin.android.apps.connectmobile",
    },
  });

  if (!preauthResp.ok) {
    const text = await preauthResp.text();
    throw new Error(`Preauth failed (${preauthResp.status}): ${text.slice(0, 200)}`);
  }

  const preauthBody = await preauthResp.text();
  const preauthParams = new URLSearchParams(preauthBody);
  const oauth1 = {
    oauth_token: preauthParams.get("oauth_token") || "",
    oauth_token_secret: preauthParams.get("oauth_token_secret") || "",
    mfa_token: preauthParams.get("mfa_token") || undefined,
    mfa_expiration_timestamp: preauthParams.get("mfa_expiration_timestamp") || undefined,
    domain: DOMAIN,
  };

  if (!oauth1.oauth_token || !oauth1.oauth_token_secret) {
    throw new Error("No OAuth1 token in preauth response");
  }

  // Step 7: Exchange OAuth1 → OAuth2
  const oauth2 = await exchangeOAuth1ForOAuth2(oauth1);

  return { oauth1, oauth2 };
}

// ── Save tokens to DB ───────────────────────────────────────────────────────

async function saveTokens(
  sql: ReturnType<typeof getDb>,
  oauth1: Record<string, any>,
  oauth2: Record<string, any>,
) {
  const tokens = {
    "oauth1_token.json": oauth1,
    "oauth2_token.json": oauth2,
  };
  await sql`
    INSERT INTO platform_credentials (platform, auth_type, credentials, status)
    VALUES ('garmin_tokens', 'oauth', ${JSON.stringify(tokens)}, 'active')
    ON CONFLICT (platform) DO UPDATE SET credentials = EXCLUDED.credentials
  `;
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function POST(req: Request) {
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
    const tokens = rows[0]?.credentials
      ? (typeof rows[0].credentials === "string" ? JSON.parse(rows[0].credentials) : rows[0].credentials)
      : null;

    const oauth1Raw = tokens?.["oauth1_token.json"] || tokens?.oauth1_token;
    const oauth2Raw = tokens?.["oauth2_token.json"] || tokens?.oauth2_token;
    const oauth1 = oauth1Raw ? (typeof oauth1Raw === "string" ? JSON.parse(oauth1Raw) : oauth1Raw) : null;
    const oauth2 = oauth2Raw ? (typeof oauth2Raw === "string" ? JSON.parse(oauth2Raw) : oauth2Raw) : null;

    // 2. If OAuth2 is still fresh, skip
    const expiresAt = oauth2?.expires_at || 0;
    const hoursRemaining = (expiresAt - Date.now() / 1000) / 3600;
    if (hoursRemaining > 2) {
      return NextResponse.json({
        status: "skipped",
        message: `Token still valid (${hoursRemaining.toFixed(1)}h remaining)`,
      });
    }

    // 3. Try fast path: OAuth1 → OAuth2 exchange
    if (oauth1?.oauth_token && oauth1?.oauth_token_secret) {
      try {
        const newOAuth2 = await exchangeOAuth1ForOAuth2(oauth1);
        await saveTokens(sql, oauth1, newOAuth2);
        return NextResponse.json({
          status: "refreshed",
          method: "oauth1_exchange",
          expires_at: new Date(newOAuth2.expires_at * 1000).toISOString(),
          hours_valid: ((newOAuth2.expires_at - Date.now() / 1000) / 3600).toFixed(1),
        });
      } catch (exchangeErr) {
        const msg = exchangeErr instanceof Error ? exchangeErr.message : String(exchangeErr);
        console.log(`[refresh-tokens] OAuth1 exchange failed: ${msg} — falling back to full login`);
        // Fall through to full login
      }
    }

    // 4. Fallback: full email/password login
    const email = process.env.GARMIN_EMAIL;
    const password = process.env.GARMIN_PASSWORD;
    if (!email || !password) {
      return NextResponse.json({
        error: "OAuth1 exchange failed and GARMIN_EMAIL/GARMIN_PASSWORD not configured",
      }, { status: 500 });
    }

    const { oauth1: newOAuth1, oauth2: newOAuth2 } = await fullLogin(email, password);
    await saveTokens(sql, newOAuth1, newOAuth2);

    return NextResponse.json({
      status: "refreshed",
      method: "full_login",
      expires_at: new Date(newOAuth2.expires_at * 1000).toISOString(),
      hours_valid: ((newOAuth2.expires_at - Date.now() / 1000) / 3600).toFixed(1),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
