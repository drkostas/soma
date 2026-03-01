import type { Metadata } from "next";
import { isSpotifyConnected } from "@/lib/spotify-client";
import PlaylistClient from "./playlist-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Playlist" };

export default async function PlaylistPage() {
  const connected = await isSpotifyConnected();
  return <PlaylistClient spotifyConnected={connected} />;
}
