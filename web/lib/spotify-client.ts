import { getDb } from "@/lib/db";

export const SPOTIFY_SCOPES =
  "user-library-read playlist-read-private playlist-modify-private user-modify-playback-state user-read-playback-state";

async function getCredentials() {
  const sql = getDb();
  const rows = await sql`
    SELECT credentials, expires_at FROM platform_credentials WHERE platform = 'spotify'
  `;
  if (!rows[0]) return null;
  const creds = rows[0].credentials as {
    access_token: string;
    refresh_token: string;
    expires_at?: string;
    display_name?: string;
    spotify_user_id?: string;
  };
  return { ...creds, db_expires_at: rows[0].expires_at as Date };
}

async function doRefresh(refreshToken: string): Promise<string> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.SPOTIFY_CLIENT_ID!,
    }),
  });

  if (!res.ok) throw new Error(`Spotify token refresh failed: ${res.status}`);
  const data = await res.json();

  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  const sql = getDb();
  await sql`
    UPDATE platform_credentials
    SET
      credentials = credentials
        || ${JSON.stringify({ access_token: data.access_token, expires_at: newExpiresAt, ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}) })}::jsonb,
      expires_at = ${newExpiresAt}
    WHERE platform = 'spotify'
  `;

  return data.access_token;
}

export async function spotifyFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const creds = await getCredentials();
  if (!creds) throw new Error("Spotify not connected");

  let token = creds.access_token;

  // Refresh if expires within 60 seconds (use JSONB expires_at as source of truth)
  const expiresAt = creds.expires_at
    ? new Date(creds.expires_at).getTime()
    : new Date(creds.db_expires_at).getTime();

  if (expiresAt - Date.now() < 60_000) {
    token = await doRefresh(creds.refresh_token);
  }

  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  // Retry once on 401 (token invalidated mid-request)
  if (res.status === 401) {
    const newToken = await doRefresh(creds.refresh_token);
    return fetch(`https://api.spotify.com/v1${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${newToken}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
  }

  return res;
}

export async function isSpotifyConnected(): Promise<boolean> {
  const creds = await getCredentials();
  return creds !== null;
}

export async function getSpotifyProfile(): Promise<{ id: string; display_name: string } | null> {
  const creds = await getCredentials();
  if (!creds) return null;
  if (creds.spotify_user_id && creds.display_name) {
    return { id: creds.spotify_user_id, display_name: creds.display_name };
  }
  // Fallback: fetch from API
  try {
    const res = await spotifyFetch("/me");
    if (!res.ok) return null;
    const data = await res.json();
    return { id: data.id, display_name: data.display_name };
  } catch {
    return null;
  }
}
