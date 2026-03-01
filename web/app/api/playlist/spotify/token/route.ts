// web/app/api/playlist/spotify/token/route.ts
import { NextResponse } from "next/server";
import { getAccessToken, isSpotifyConnected } from "@/lib/spotify-client";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isSpotifyConnected())) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 });
  }
  // Use getAccessToken() so the token is refreshed if it has expired.
  // The Web Playback SDK calls this repeatedly and needs a valid token each time.
  const token = await getAccessToken();
  return NextResponse.json({ token });
}
