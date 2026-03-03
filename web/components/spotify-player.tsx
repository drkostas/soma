// web/components/spotify-player.tsx
"use client";
import { AnimatePresence, motion } from "motion/react";
import { SongData } from "./song-card";

interface Props { currentSong: SongData | null; }

// Uses Spotify's official embed widget — no SDK, no Premium required.
// Free users get a 30s preview; Premium users get the full song.
// All playback happens inside the iframe; no server calls needed.
export default function SpotifyPlayer({ currentSong }: Props) {
  return (
    <div className="border-t bg-card">
      <AnimatePresence mode="wait">
        {currentSong ? (
          <motion.div
            key={currentSong.track_id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
          >
            <iframe
              src={`https://open.spotify.com/embed/track/${currentSong.track_id}?utm_source=generator&theme=0&autoplay=1`}
              width="100%"
              height="80"
              frameBorder="0"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="eager"
              className="block"
            />
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-[80px] flex items-center justify-center text-xs text-muted-foreground"
          >
            Click a song to preview
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
