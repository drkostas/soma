import { NextResponse } from "next/server";
import { spotifyFetch } from "@/lib/spotify-client";

export const runtime = "nodejs";

export async function GET() {
  // Fetch current user id first so we can filter to owned playlists only.
  // Followed (non-owned) playlists return 403 on /items in Spotify Dev Mode.
  const meRes = await spotifyFetch("/me");
  const userId: string = meRes.ok ? (await meRes.json()).id ?? "" : "";

  const playlists: Array<{ id: string; name: string; tracks: number }> = [];
  let url: string | null = "/me/playlists?limit=50";

  while (url) {
    const res = await spotifyFetch(url);
    if (!res.ok) break;
    const data = await res.json();
    for (const p of data.items ?? []) {
      // Only include playlists owned by the current user — followed playlists
      // from other users return 403 when reading their tracks.
      if (userId && p.owner?.id !== userId) continue;
      playlists.push({ id: p.id, name: p.name, tracks: p.items?.total ?? p.tracks?.total ?? 0 });
    }
    url = data.next
      ? (data.next as string).replace("https://api.spotify.com/v1", "")
      : null;
  }

  return NextResponse.json(playlists);
}
