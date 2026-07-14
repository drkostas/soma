/**
 * Facterino Garmin bridge (garth-oauth2) — TS port of sync/src/strava_bridge.py.
 *
 * soma has no Strava upload API, so a finalized FIT is uploaded to the dedicated
 * "facterino" Garmin account, which Garmin auto-forwards to the connected Strava
 * (a Garmin→Strava direct integration, exempt from the paywall + intermediary ban).
 *
 * Auth is garth's token bundle (base64(json([oauth1, oauth2]))) stored in the DB
 * (platform=garmin_facterino_bridge). The oauth2 access token authenticates the
 * upload; when it expires garth re-exchanges via an OAuth1-signed request (NOT the
 * oauth2 refresh_token), so this mirrors that exactly.
 */
import crypto from "node:crypto";
import OAuth from "oauth-1.0a";

const DOMAIN = "garmin.com";
const CONNECTAPI = `https://connectapi.${DOMAIN}`;
const UPLOAD_UA = "GCM-iOS-5.7.2.1";
const EXCHANGE_UA = "com.garmin.android.apps.connectmobile";
const EXCHANGE_URL = `${CONNECTAPI}/oauth-service/oauth/exchange/user/2.0`;
const UPLOAD_URL = `${CONNECTAPI}/upload-service/upload`;
const CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json";

export interface OAuth1Token {
  oauth_token: string;
  oauth_token_secret: string;
  mfa_token?: string | null;
  mfa_expiration_timestamp?: string | null;
  domain?: string | null;
}
export interface OAuth2Token {
  scope?: string;
  jti?: string;
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number; // epoch seconds
  refresh_token_expires_in?: number;
  refresh_token_expires_at?: number;
}
export interface GarthBundle { oauth1: OAuth1Token; oauth2: OAuth2Token; }

/** Parse a garth dump (base64 of json([oauth1, oauth2])) into a bundle. */
export function parseGarthDump(dump: string): GarthBundle {
  const [oauth1, oauth2] = JSON.parse(Buffer.from(dump, "base64").toString("utf8"));
  return { oauth1, oauth2 };
}

/** Serialize a bundle back to a garth dump string. */
export function serializeGarthDump(b: GarthBundle): string {
  return Buffer.from(JSON.stringify([b.oauth1, b.oauth2])).toString("base64");
}

/** Is the oauth2 access token expired (with a small safety margin)? */
export function isOauth2Expired(oauth2: OAuth2Token, nowSec: number = Date.now() / 1000): boolean {
  return !oauth2.expires_at || oauth2.expires_at <= nowSec + 60;
}

let consumerCache: { consumer_key: string; consumer_secret: string } | null = null;
async function fetchConsumer(): Promise<{ consumer_key: string; consumer_secret: string }> {
  if (consumerCache) return consumerCache;
  const r = await fetch(CONSUMER_URL);
  if (!r.ok) throw new Error(`consumer fetch ${r.status}`);
  consumerCache = (await r.json()) as { consumer_key: string; consumer_secret: string };
  return consumerCache;
}

function setExpirations(token: any, nowSec: number): OAuth2Token {
  return {
    ...token,
    expires_at: Math.floor(nowSec) + Number(token.expires_in),
    refresh_token_expires_at: token.refresh_token_expires_in
      ? Math.floor(nowSec) + Number(token.refresh_token_expires_in)
      : undefined,
  };
}

/**
 * Refresh the oauth2 token via garth's OAuth1-signed exchange (HMAC-SHA1). Mirrors
 * garth.sso.exchange: sign with the consumer creds + oauth1 resource-owner token,
 * POST to the exchange endpoint (mfa_token in the body if present).
 */
export async function refreshOauth2(oauth1: OAuth1Token, nowSec: number = Date.now() / 1000): Promise<OAuth2Token> {
  const consumer = await fetchConsumer();
  const oauth = new OAuth({
    consumer: { key: consumer.consumer_key, secret: consumer.consumer_secret },
    signature_method: "HMAC-SHA1",
    hash_function: (base, key) => crypto.createHmac("sha1", key).update(base).digest("base64"),
  });
  const token = { key: oauth1.oauth_token, secret: oauth1.oauth_token_secret };
  const body: Record<string, string> = oauth1.mfa_token ? { mfa_token: oauth1.mfa_token } : {};
  const requestData = { url: EXCHANGE_URL, method: "POST", data: body };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

  const resp = await fetch(EXCHANGE_URL, {
    method: "POST",
    headers: {
      ...authHeader,
      "User-Agent": EXCHANGE_UA,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!resp.ok) throw new Error(`oauth2 exchange ${resp.status}: ${(await resp.text()).slice(0, 120)}`);
  return setExpirations(await resp.json(), nowSec);
}

/** Upload a FIT to facterino Garmin (multipart). Garmin forwards it to Strava. */
export async function uploadFit(accessToken: string, fit: Uint8Array, filename: string): Promise<any> {
  const form = new FormData();
  form.append("file", new Blob([fit as unknown as BlobPart], { type: "application/octet-stream" }), filename);
  const resp = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": UPLOAD_UA, NK: "NT" },
    body: form,
  });
  // 200 or 201/202 (async) are all success.
  if (![200, 201, 202].includes(resp.status)) {
    throw new Error(`facterino upload ${resp.status}: ${(await resp.text()).slice(0, 120)}`);
  }
  return resp.json().catch(() => ({}));
}
