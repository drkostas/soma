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
  onPreview: (song: SongData) => void;
  onPlace: (song: SongData) => void;
}

export default function SongAlternativesStrip({ segmentConfig, placedIds, onPreview, onPlace }: Props) {
  const [songs, setSongs] = useState<SongData[]>([]);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stripRef = useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = useState(false);

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
        exclude: Array.from(placedIds).join(","),
        ...(segmentConfig.genres.length > 0 ? { genres: segmentConfig.genres.join(",") } : {}),
      });
      try {
        const data = await fetch(`/api/playlist/tracks?${params}`).then(r => r.json());
        setSongs((data ?? []).filter((s: SongData) => !placedIds.has(s.track_id)).slice(0, 12));
      } catch {
        // ignore fetch errors
      }
      setLoading(false);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(segmentConfig), [...placedIds].sort().join(",")]);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const check = () => setShowFade(el.scrollWidth > el.clientWidth && el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
    check();
    el.addEventListener("scroll", check);
    return () => el.removeEventListener("scroll", check);
  }, [songs]);

  return (
    <div className="relative">
      <div ref={stripRef} className="flex gap-2 overflow-x-auto scrollbar-none py-1 pr-6">
        <AnimatePresence>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <motion.div key={`sk-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-40 h-14 rounded-lg bg-muted animate-pulse shrink-0" />
            ))
          ) : (
            songs.map((song) => (
              <motion.div
                key={song.track_id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="w-44 shrink-0 rounded-lg border bg-card p-2 flex flex-col gap-1"
              >
                <div className="text-xs font-medium truncate">{song.name}</div>
                <div className="text-xs text-muted-foreground truncate">{song.artist_name}</div>
                <div className="text-xs text-muted-foreground">{song.tempo.toFixed(0)} BPM</div>
                <div className="flex gap-1 mt-auto">
                  <button type="button" onClick={() => onPreview(song)} className="flex-1 flex items-center justify-center gap-1 text-xs border rounded hover:bg-muted py-0.5 transition-colors">
                    <Play className="w-3 h-3" /> Preview
                  </button>
                  <button type="button" onClick={() => onPlace(song)} className="flex-1 flex items-center justify-center gap-1 text-xs border rounded hover:bg-primary hover:text-primary-foreground py-0.5 transition-colors">
                    <Plus className="w-3 h-3" /> Place
                  </button>
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
