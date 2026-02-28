// web/components/spotify-player.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { motion, AnimatePresence } from "motion/react";
import { SongData } from "./song-card";

interface Props { currentSong: SongData | null; }

export default function SpotifyPlayer({ currentSong }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const playerRef = useRef<Spotify.Player | null>(null);
  const deviceIdRef = useRef<string | null>(null); // Fix 3: capture device_id on ready
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    // Fix 6: guard against SDK already loaded
    const initPlayer = () => {
      const player = new window.Spotify.Player({
        name: "Soma Playlist Builder",
        // Fix 4: always fetch a fresh token rather than capturing a stale closure value
        getOAuthToken: (cb: (t: string) => void) => {
          fetch("/api/playlist/spotify/token")
            .then(r => r.json())
            .then((d: { token: string }) => cb(d.token))
            .catch(() => cb(""));
        },
        volume,
      });

      player.addListener("player_state_changed", (state) => {
        if (!state) return;
        setIsPlaying(!state.paused);
        setPosition(state.position);
        setDuration(state.duration);
      });

      // Fix 3: store device_id when player is ready
      player.addListener("ready", ({ device_id }: { device_id: string }) => {
        deviceIdRef.current = device_id;
      });

      void player.connect();
      playerRef.current = player;
    };

    // Fix 6: if SDK is already loaded, init directly; otherwise inject script
    if (window.Spotify) {
      initPlayer();
    } else {
      // Only inject if the script tag isn't already in the DOM
      const existing = document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]');
      if (!existing) {
        const script = document.createElement("script");
        script.src = "https://sdk.scdn.co/spotify-player.js";
        script.async = true;
        document.head.appendChild(script);
      }
      (window as { onSpotifyWebPlaybackSDKReady?: () => void }).onSpotifyWebPlaybackSDKReady = initPlayer;
    }

    // Fix 5: disconnect player on cleanup
    return () => {
      playerRef.current?.disconnect();
      playerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll position while playing
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => setPosition(p => p + 1000), 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [isPlaying]);

  // Play song when it changes
  // Fix 3: include device_id query param so Spotify targets the SDK player
  useEffect(() => {
    if (!currentSong || !playerRef.current) return;
    const deviceParam = deviceIdRef.current ? `?device_id=${deviceIdRef.current}` : "";
    void fetch(`/api/playlist/spotify/play${deviceParam}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: [`spotify:track:${currentSong.track_id}`] }),
    });
  }, [currentSong?.track_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

  return (
    <div className="border-t bg-card px-4 py-2 flex items-center gap-4">
      <AnimatePresence mode="wait">
        {currentSong ? (
          <motion.div key={currentSong.track_id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-48 min-w-0">
            <div className="text-xs font-medium truncate">{currentSong.name}</div>
            <div className="text-xs text-muted-foreground truncate">{currentSong.artist_name}</div>
          </motion.div>
        ) : (
          <div className="w-48 text-xs text-muted-foreground">No song selected</div>
        )}
      </AnimatePresence>

      <button type="button" onClick={() => { void playerRef.current?.[isPlaying ? "pause" : "resume"](); }} className="text-foreground hover:text-primary transition-colors">
        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
      </button>

      <div className="flex-1 flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-10 text-right">{formatTime(position)}</span>
        <Slider min={0} max={duration || 1} step={1000} value={[position]}
          onValueChange={([v]) => { setPosition(v); void playerRef.current?.seek(v); }} className="flex-1" />
        <span className="text-xs text-muted-foreground w-10">{formatTime(duration)}</span>
      </div>

      {currentSong && <span className="text-xs text-muted-foreground">{currentSong.tempo.toFixed(0)} BPM</span>}

      <div className="flex items-center gap-1.5 w-24">
        <Volume2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <Slider min={0} max={1} step={0.05} value={[volume]}
          onValueChange={([v]) => { setVolume(v); void playerRef.current?.setVolume(v); }} />
      </div>
    </div>
  );
}
