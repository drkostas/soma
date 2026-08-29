import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function GET() {
  const sql = getDb();

  try {
    const credentials = await sql`
      SELECT platform, auth_type, status, connected_at, expires_at,
             credentials->>'athlete_name' as athlete_name
      FROM platform_credentials
      ORDER BY platform
    `;

    const rules = await sql`
      SELECT id, source_platform, activity_type, preprocessing, destinations, enabled, priority
      FROM sync_rules
      ORDER BY priority DESC, id
    `;

    // Spotify library status (features cached for tempo-matched playlists).
    const spotifyRows = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM spotify_track_features)  AS tracks,
        (SELECT COUNT(*)::int FROM spotify_artist_genres)   AS artists,
        (SELECT MAX(cached_at) FROM spotify_track_features) AS last_sync
    `;
    const sp = (spotifyRows as Record<string, unknown>[])[0] ?? null;
    const spotify = sp && Number(sp.tracks) > 0
      ? { tracks: Number(sp.tracks), artists: Number(sp.artists), last_sync: (sp.last_sync as string | null) ?? null }
      : null;

    // Build platform status including non-connected ones
    const platforms = ["garmin", "hevy", "strava", "surfr"];
    const credMap = Object.fromEntries(
      (credentials as any[]).map((c: any) => [c.platform, c])
    );

    const status = platforms.map((p) => ({
      platform: p,
      status: credMap[p]?.status || "disconnected",
      connected_at: credMap[p]?.connected_at || null,
      athlete_name: credMap[p]?.athlete_name || null,
      auth_type:
        credMap[p]?.auth_type ||
        (p === "garmin"
          ? "token_cache"
          : p === "hevy"
            ? "api_key"
            : "oauth2"),
      can_connect: p === "strava",
    }));

    return NextResponse.json({ platforms: status, rules, spotify });
  } catch (err) {
    console.error("Error fetching connections status:", err);
    return NextResponse.json(
      { error: "Failed to fetch connections status" },
      { status: 500 },
    );
  }
}
