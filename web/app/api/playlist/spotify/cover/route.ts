import { NextRequest, NextResponse } from "next/server";
import { getAccessToken, isSpotifyConnected } from "@/lib/spotify-client";

export const runtime = "nodejs";

export async function PUT(req: NextRequest) {
  try {
    const { playlist_id, image_base64 } = await req.json();

    if (!(await isSpotifyConnected())) {
      return NextResponse.json({ error: "Not connected" }, { status: 401 });
    }

    const token = await getAccessToken();

    const res = await fetch(
      `https://api.spotify.com/v1/playlists/${playlist_id}/images`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "image/jpeg",
        },
        body: image_base64,
      }
    );

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Upload failed: ${res.status} ${err}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
