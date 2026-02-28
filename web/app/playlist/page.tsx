import { isSpotifyConnected } from "@/lib/spotify-client";
import PlaylistClient from "./playlist-client";

export default async function PlaylistPage() {
  const connected = await isSpotifyConnected();
  return <PlaylistClient spotifyConnected={connected} />;
}
