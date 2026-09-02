import { createElement } from "react";

/** Spotify preview on web — the official embed iframe (30s for free users, full
 *  for Premium). No SDK, no server calls; mirrors web spotify-player.tsx. */
export function SpotifyEmbed({ trackId }: { trackId: string }) {
  return createElement("iframe", {
    src: `https://open.spotify.com/embed/track/${trackId}?utm_source=generator&theme=0&autoplay=1`,
    width: "100%",
    height: 80,
    frameBorder: "0",
    allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
    loading: "eager",
    style: { border: 0, display: "block", borderRadius: 8 },
  });
}
