import type { Metadata } from "next";
import { isSpotifyConnected } from "@/lib/spotify-client";
import PlaylistClient from "./playlist-client";
import { connection } from "next/server";

// Off the demo this renders dynamically from live Spotify state. The public demo
// has one fixed dataset and no live connection, so it prerenders instead.
export const metadata: Metadata = { title: "Playlist" };

export default async function PlaylistPage() {
  if (process.env.DEMO_MODE?.trim() !== "true") await connection();
  const connected = await isSpotifyConnected();
  return <PlaylistClient spotifyConnected={connected} />;
}
