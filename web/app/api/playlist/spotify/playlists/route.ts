import { NextResponse } from "next/server";
import { spotifyFetch } from "@/lib/spotify-client";

export const runtime = "nodejs";

export async function GET() {
  const playlists: Array<{ id: string; name: string; tracks: number }> = [];
  let url: string | null = "/me/playlists?limit=50";

  while (url) {
    const res = await spotifyFetch(url);
    if (!res.ok) break;
    const data = await res.json();
    for (const p of data.items ?? []) {
      playlists.push({ id: p.id, name: p.name, tracks: p.tracks?.total ?? 0 });
    }
    url = data.next
      ? (data.next as string).replace("https://api.spotify.com/v1", "")
      : null;
  }

  return NextResponse.json(playlists);
}
