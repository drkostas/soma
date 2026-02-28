"use client";
import { motion, AnimatePresence } from "framer-motion";
import PlaylistOnboarding from "@/components/playlist-onboarding";
import PlaylistBuilder from "@/components/playlist-builder";
import { useState, useEffect } from "react";

interface Props {
  spotifyConnected: boolean;
}

export default function PlaylistClient({ spotifyConnected }: Props) {
  const [libraryAnalysed, setLibraryAnalysed] = useState(false);
  const [runSelected, setRunSelected] = useState(false);

  // Check library status on mount
  useEffect(() => {
    if (!spotifyConnected) return;
    fetch("/api/playlist/spotify/library")
      .then((r) => r.json())
      .then((d) => {
        if (Number(d.total_tracks) > 0) setLibraryAnalysed(true);
      })
      .catch(() => {});
  }, [spotifyConnected]);

  const isReady = spotifyConnected && libraryAnalysed && runSelected;

  return (
    <div className="flex flex-col h-full">
      <AnimatePresence mode="wait">
        {!isReady ? (
          <motion.div
            key="onboarding"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <PlaylistOnboarding
              spotifyConnected={spotifyConnected}
              libraryAnalysed={libraryAnalysed}
              onLibraryAnalysed={() => setLibraryAnalysed(true)}
              onRunSelected={() => setRunSelected(true)}
            />
          </motion.div>
        ) : (
          <motion.div
            key="builder"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1"
          >
            <PlaylistBuilder />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
