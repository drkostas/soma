// web/app/api/playlist/spotify/play/route.ts
import { NextRequest, NextResponse } from "next/server";
import { spotifyFetch } from "@/lib/spotify-client";

export const runtime = "nodejs";

// PUT /api/playlist/spotify/play?device_id=XXX
// Body: { uris: ["spotify:track:TRACK_ID"] }
// Tells Spotify to start playing on the Web Playback SDK device in the browser.
export async function PUT(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get("device_id");
  const body = await req.json().catch(() => ({}));
  const { uris } = body as { uris?: string[] };

  if (!uris?.length) {
    return NextResponse.json({ error: "uris required" }, { status: 400 });
  }

  const url = deviceId
    ? `/me/player/play?device_id=${deviceId}`
    : "/me/player/play";

  const res = await spotifyFetch(url, {
    method: "PUT",
    body: JSON.stringify({ uris }),
  });

  // 204 = success (no content), pass it through
  if (res.status === 204 || res.ok) {
    return new NextResponse(null, { status: 204 });
  }

  const err = await res.text().catch(() => "");
  return NextResponse.json(
    { error: `Spotify ${res.status}: ${err.slice(0, 200)}` },
    { status: res.status }
  );
}
