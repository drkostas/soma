import { NextRequest, NextResponse } from "next/server";
import { spotifyFetch, isSpotifyConnected } from "@/lib/spotify-client";

export const runtime = "nodejs";

// GET /api/playlist/spotify/preview?ids=id1,id2,...
// Returns { [trackId]: preview_url | null } for up to 50 track IDs.
export async function GET(req: NextRequest) {
  const ids = req.nextUrl.searchParams.get("ids");
  if (!ids) return NextResponse.json({});
  if (!(await isSpotifyConnected())) return NextResponse.json({}, { status: 401 });
  const idList = ids.split(",").filter(Boolean).slice(0, 50);
  const res = await spotifyFetch(`/tracks?ids=${idList.join(",")}&market=US`);
  if (!res.ok) return NextResponse.json({});
  const data = await res.json();
  const map: Record<string, string | null> = {};
  for (const track of (data.tracks ?? [])) {
    if (track?.id) map[track.id] = track.preview_url ?? null;
  }
  return NextResponse.json(map);
}
