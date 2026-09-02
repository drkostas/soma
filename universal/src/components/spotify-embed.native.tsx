import { WebView } from "react-native-webview";

/** Spotify preview on native — the official embed in a WebView (30s for free
 *  users, full for Premium). Mirrors the web spotify-player.tsx iframe. */
export function SpotifyEmbed({ trackId }: { trackId: string }) {
  return (
    <WebView
      source={{ uri: `https://open.spotify.com/embed/track/${trackId}?utm_source=generator&theme=0&autoplay=1` }}
      style={{ height: 80, backgroundColor: "transparent" }}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      scrollEnabled={false}
    />
  );
}
