// web/components/song-alternatives-strip.tsx
"use client";
import { motion, AnimatePresence } from "motion/react";
import { Play, Plus, ChevronRight } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { SongData } from "./song-card";

interface Props {
  segmentConfig: {
    bpm_min: number; bpm_max: number; bpm_tolerance: number;
    valence_min: number; valence_max: number; min_energy: number;
    genres: string[];
  };
  placedIds: Set<string>;
  excludedIds: Set<string>;
  onPreview: (song: SongData) => void;
  onPlace: (song: SongData) => void;
}

// Interleaved partition shuffle: spaces same-artist songs evenly.
// Feels more random than Fisher-Yates because it prevents clustering.
function interleavedShuffle<T extends { artist_name: string | null | undefined }>(songs: T[]): T[] {
  if (!songs.length) return [];
  // Partition by artist
  const byArtist = new Map<string, T[]>();
  for (const song of songs) {
    const key = (song.artist_name ?? "").toLowerCase();
    if (!byArtist.has(key)) byArtist.set(key, []);
    byArtist.get(key)!.push(song);
  }
  // Shuffle within each partition (Fisher-Yates)
  for (const partition of byArtist.values()) {
    for (let i = partition.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [partition[i], partition[j]] = [partition[j], partition[i]];
    }
  }
  // Interleave partitions evenly (largest first) — O(n) with index pointers
  const partitions = [...byArtist.values()].sort((a, b) => b.length - a.length);
  const ptrs = new Array<number>(partitions.length).fill(0);
  const result: T[] = [];
  let remaining = songs.length;
  while (remaining > 0) {
    for (let i = 0; i < partitions.length; i++) {
      if (ptrs[i] < partitions[i].length) {
        result.push(partitions[i][ptrs[i]++]);
        remaining--;
      }
    }
  }
  return result;
}

const PAGE_SIZE = 12;

export default function SongAlternativesStrip({ segmentConfig, placedIds, excludedIds, onPreview, onPlace }: Props) {
  const [allSongs, setAllSongs] = useState<SongData[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stripRef = useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = useState(false);

  // Fetch and shuffle full pool on config/filter changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams({
        bpm_min: segmentConfig.bpm_min.toString(),
        bpm_max: segmentConfig.bpm_max.toString(),
        bpm_tol: segmentConfig.bpm_tolerance.toString(),
        energy_min: (segmentConfig.min_energy - 0.2).toString(),
        valence_min: segmentConfig.valence_min.toString(),
        valence_max: segmentConfig.valence_max.toString(),
        half_time: "true",
        exclude: [...placedIds, ...excludedIds].join(","),
        ...(segmentConfig.genres.length > 0 ? { genres: segmentConfig.genres.join(",") } : {}),
      });
      try {
        const data = await fetch(`/api/playlist/tracks?${params}`).then(r => r.json());
        const filtered = (data ?? []).filter(
          (s: SongData) => !placedIds.has(s.track_id) && !excludedIds.has(s.track_id)
        );
        // Shuffle on every fetch so alternatives feel fresh
        const shuffled = interleavedShuffle<SongData>(filtered);
        setAllSongs(shuffled);
        setVisibleCount(PAGE_SIZE);
        setPreviewUrls({});
      } catch {
        // ignore fetch errors
      }
      setLoading(false);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(segmentConfig), [...placedIds].sort().join(","), [...excludedIds].sort().join(",")]);

  // Prefetch preview URLs for currently visible songs
  useEffect(() => {
    const visible = allSongs.slice(0, visibleCount);
    const unfetched = visible.filter(s => !(s.track_id in previewUrls));
    if (!unfetched.length) return;
    const ids = unfetched.map(s => s.track_id).join(",");
    fetch(`/api/playlist/spotify/preview?ids=${ids}`)
      .then(r => r.json())
      .then((map: Record<string, string | null>) => setPreviewUrls(prev => ({ ...prev, ...map })))
      .catch(() => {});
  }, [allSongs, visibleCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll handler: show fade indicator + load more on reaching end
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const check = () => {
      const atEnd = el.scrollLeft >= el.scrollWidth - el.clientWidth - 10;
      setShowFade(!atEnd && el.scrollWidth > el.clientWidth);
      if (atEnd && visibleCount < allSongs.length) {
        setVisibleCount(v => Math.min(v + PAGE_SIZE, allSongs.length));
      }
    };
    check();
    el.addEventListener("scroll", check);
    return () => el.removeEventListener("scroll", check);
  }, [allSongs, visibleCount]);

  // Merge fetched preview_url into displayed songs
  const displaySongs = allSongs.slice(0, visibleCount).map(s => ({
    ...s,
    preview_url: s.track_id in previewUrls ? previewUrls[s.track_id] : undefined,
  }));

  return (
    <div className="relative">
      <div ref={stripRef} className="flex gap-2 overflow-x-auto scrollbar-none py-1 pr-6">
        <AnimatePresence>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <motion.div key={`sk-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-40 h-14 rounded-lg bg-muted animate-pulse shrink-0" />
            ))
          ) : displaySongs.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs text-muted-foreground italic py-1 px-1 shrink-0">
              No alternatives — try widening BPM or changing genres
            </motion.div>
          ) : (
            displaySongs.map((song) => (
              <motion.div
                key={song.track_id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="shrink-0"
              >
                <div
                  className="w-44 rounded-lg border bg-card p-2 flex flex-col gap-1 cursor-grab active:cursor-grabbing"
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData("application/soma-song", JSON.stringify(song));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <div className="text-xs font-medium truncate">{song.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{song.artist_name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    {(() => {
                      const lo = segmentConfig.bpm_min - segmentConfig.bpm_tolerance;
                      const hi = segmentConfig.bpm_max + segmentConfig.bpm_tolerance;
                      const inFull = song.tempo >= lo && song.tempo <= hi;
                      const inHalf = song.tempo >= lo / 2 && song.tempo <= hi / 2;
                      return !inFull && inHalf ? (
                        <span title={`${song.tempo.toFixed(0)} BPM — half-time match at ${(song.tempo * 2).toFixed(0)} SPM`} className="border rounded px-0.5 text-[10px] leading-tight cursor-help">½</span>
                      ) : null;
                    })()}
                    {song.tempo.toFixed(0)} BPM
                  </div>
                  <div className="flex gap-1 mt-auto">
                    <button type="button" onClick={() => onPreview(song)} className="flex-1 flex items-center justify-center gap-1 text-xs border rounded hover:bg-muted py-0.5 transition-colors">
                      <Play className="w-3 h-3" /> Preview
                    </button>
                    <button type="button" onClick={() => onPlace(song)} className="flex-1 flex items-center justify-center gap-1 text-xs border rounded hover:bg-primary hover:text-primary-foreground py-0.5 transition-colors">
                      <Plus className="w-3 h-3" /> Place
                    </button>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
      {showFade && (
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent flex items-center justify-end pr-0.5 pointer-events-none">
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
