// web/lib/lastfm-client.ts

/** Get top tags for an artist from Last.fm (used as genre fallback when Spotify has none) */
export async function getArtistTopTags(artistName: string): Promise<string[]> {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return [];

  const params = new URLSearchParams({
    method: "artist.getTopTags",
    artist: artistName,
    api_key: apiKey,
    format: "json",
    limit: "10",
  });

  try {
    const res = await fetch(
      `https://ws.audioscrobbler.com/2.0/?${params}`,
      { cache: "no-store" }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const tags = (data?.toptags?.tag ?? []) as Array<{ name: string }>;
    return tags.map((t) => t.name.toLowerCase());
  } catch {
    return [];
  }
}
