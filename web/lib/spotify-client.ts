/**
 * Spotify for soma: the Web API client lives in run-dj (cached token, refresh
 * on expiry, one retry on 401); this module only says where soma keeps the
 * tokens, the platform_credentials row, and re-exports the client's calls
 * under the names the routes and the DJ daemon already use.
 */
import { getDb } from "@/lib/db";
import { createSpotifyClient, SPOTIFY_SCOPES, type SpotifyClient, type SpotifyTokenStore } from "run-dj/spotify";

export { SPOTIFY_SCOPES };

const store: SpotifyTokenStore = {
  async load() {
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
  },
  async save(patch) {
    const sql = getDb();
    await sql`
      UPDATE platform_credentials
      SET
        credentials = credentials || ${JSON.stringify(patch)}::jsonb,
        expires_at = ${patch.expires_at}
      WHERE platform = 'spotify'
    `;
  },
};

let client: SpotifyClient | null = null;
function spotify(): SpotifyClient {
  return (client ??= createSpotifyClient({ clientId: process.env.SPOTIFY_CLIENT_ID!, store }));
}

export function spotifyFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return spotify().spotifyFetch(path, options);
}
/** Returns a valid access token, refreshing from Spotify if needed. */
export function getAccessToken(): Promise<string> {
  return spotify().getAccessToken();
}
export function isSpotifyConnected(): Promise<boolean> {
  return spotify().isConnected();
}
export function getSpotifyProfile(): Promise<{ id: string; display_name: string } | null> {
  return spotify().getProfile();
}
