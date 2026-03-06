"use client";
import { motion, AnimatePresence } from "framer-motion";
import PlaylistOnboarding from "@/components/playlist-onboarding";
import PlaylistBuilder from "@/components/playlist-builder";
import LiveDjTab from "@/components/live-dj-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";

interface Props {
  spotifyConnected: boolean;
}

export default function PlaylistClient({ spotifyConnected }: Props) {
  const [libraryAnalysed, setLibraryAnalysed] = useState(false);
  const [activeTab, setActiveTab] = useState<"playlist" | "dj">("playlist");

  // Restore persisted tab after mount to avoid hydration mismatch
  useEffect(() => {
    const stored = localStorage.getItem("playlist_active_tab");
    if (stored === "dj") setActiveTab("dj");
  }, []);

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

  useEffect(() => {
    localStorage.setItem("playlist_active_tab", activeTab);
  }, [activeTab]);

  const isReady = spotifyConnected && libraryAnalysed;

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as "playlist" | "dj")}
      className="flex flex-col h-full"
    >
      <TabsList variant="line" className="w-full justify-start shrink-0 rounded-none border-b border-border bg-transparent px-0 h-auto">
        <TabsTrigger value="playlist" className="rounded-none px-4 py-2 text-sm font-medium">
          Playlist Builder
        </TabsTrigger>
        <TabsTrigger value="dj" className="rounded-none px-4 py-2 text-sm font-medium">
          Live DJ
        </TabsTrigger>
      </TabsList>

      <TabsContent value="playlist" className="flex-1 overflow-hidden mt-0">
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
              />
            </motion.div>
          ) : (
            <motion.div
              key="builder"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="h-full"
            >
              <PlaylistBuilder />
            </motion.div>
          )}
        </AnimatePresence>
      </TabsContent>

      <TabsContent value="dj" className="flex-1 overflow-y-auto mt-0">
        <LiveDjTab />
      </TabsContent>
    </Tabs>
  );
}
