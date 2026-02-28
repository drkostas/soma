// web/components/song-assignment-panel.tsx
"use client";
import { motion, AnimatePresence, Reorder } from "motion/react";
import { Zap, AlertTriangle, ChevronDown } from "lucide-react";
import SongCard, { SongData } from "./song-card";
import SongAlternativesStrip from "./song-alternatives-strip";
import { Segment } from "./segment-editor";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface SegmentSongs {
  songs: SongData[];
  loading?: boolean;
  poolCount?: number;
  warning?: string;
}

interface Props {
  segments: Segment[];
  assignments: Record<number, SegmentSongs>;
  excludedIds: Set<string>;
  selectedGenres: string[];
  focusedIdx: number;
  onFocus: (idx: number) => void;
  onExclude: (segIdx: number, trackId: string) => void;
  onPlace: (segIdx: number, song: SongData) => void;
  onReorder: (segIdx: number, songs: SongData[]) => void;
  onPreview: (song: SongData) => void;
  onPumpUp: (segIdx: number) => void;
  onSave: () => void;
  saving: boolean;
  savedUrl?: string;
}

export default function SongAssignmentPanel({
  segments, assignments, excludedIds, selectedGenres,
  focusedIdx, onFocus, onExclude, onPlace, onReorder,
  onPreview, onPumpUp, onSave, saving, savedUrl
}: Props) {
  const [showExcluded, setShowExcluded] = useState<Record<number, boolean>>({});
  const allPlacedIds = new Set(
    Object.values(assignments).flatMap(a => a.songs.map(s => s.track_id))
  );

  const totalPlaced = Object.values(assignments).reduce((s, a) => s + a.songs.filter(x => !x.is_skip && !excludedIds.has(x.track_id)).length, 0);
  const totalTracks = Object.values(assignments).reduce((s, a) => s + a.songs.length, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {segments.map((seg, idx) => {
          const assignment = assignments[idx];
          const isFocused = focusedIdx === idx;
          const songs = assignment?.songs ?? [];
          const excluded = songs.filter(s => excludedIds.has(s.track_id));
          const placed = songs.filter(s => !excludedIds.has(s.track_id));
          const nonSkip = placed.filter(s => !s.is_skip);
          const skipSong = placed.find(s => s.is_skip);

          return (
            <motion.div key={seg.id} layout animate={{ opacity: focusedIdx !== -1 && !isFocused ? 0.5 : 1 }}>
              {/* Segment header — outer div to avoid nested buttons */}
              <div className="w-full flex items-center gap-2 text-left mb-2 cursor-pointer" role="button" tabIndex={0} onClick={() => onFocus(isFocused ? -1 : idx)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFocus(isFocused ? -1 : idx); } }}>
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground capitalize">{seg.type}</span>
                <span className="text-xs text-muted-foreground">{Math.floor(seg.duration_s/60)} min</span>
                <span className="text-xs text-muted-foreground">{seg.bpm_min}–{seg.bpm_max} BPM</span>
                {assignment?.warning && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                <button type="button" onClick={(e) => { e.stopPropagation(); onPumpUp(idx); }} className="ml-auto text-muted-foreground hover:text-amber-400 transition-colors">
                  <Zap className="w-3.5 h-3.5" />
                </button>
                {assignment && <span className="text-xs text-muted-foreground">Pool: {assignment.poolCount ?? "?"} · {nonSkip.length} placed</span>}
              </div>

              {/* Song list */}
              <Reorder.Group axis="y" values={nonSkip} onReorder={(reordered) => onReorder(idx, [...reordered, ...(skipSong ? [skipSong] : [])])} className="space-y-1.5">
                {assignment?.loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-12 rounded-lg bg-muted animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
                  ))
                ) : (
                  nonSkip.map(song => (
                    <Reorder.Item key={song.track_id} value={song} as="div">
                      <SongCard song={song} onExclude={() => onExclude(idx, song.track_id)} onPreview={() => onPreview(song)} draggable />
                    </Reorder.Item>
                  ))
                )}
              </Reorder.Group>

              {skipSong && !assignment?.loading && (
                <div className="mt-1.5">
                  <SongCard song={skipSong} onExclude={() => onExclude(idx, skipSong.track_id)} onPreview={() => onPreview(skipSong)} />
                </div>
              )}

              {/* Alternatives strip */}
              <div className="mt-2">
                <SongAlternativesStrip
                  segmentConfig={{ bpm_min: seg.bpm_min, bpm_max: seg.bpm_max, bpm_tolerance: seg.bpm_tolerance, valence_min: seg.valence_min, valence_max: seg.valence_max, min_energy: 0.5, genres: selectedGenres }}
                  placedIds={allPlacedIds}
                  onPreview={onPreview}
                  onPlace={(song) => onPlace(idx, song)}
                />
              </div>

              {/* Excluded songs collapsible */}
              {excluded.length > 0 && (
                <div className="mt-2">
                  <button type="button" onClick={() => setShowExcluded(p => ({ ...p, [idx]: !p[idx] }))} className="text-xs text-muted-foreground flex items-center gap-1">
                    Excluded ({excluded.length}) <ChevronDown className={`w-3 h-3 transition-transform ${showExcluded[idx] ? "rotate-180" : ""}`} />
                  </button>
                  <AnimatePresence>
                    {showExcluded[idx] && (
                      <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden mt-1 space-y-1">
                        {excluded.map(s => (
                          <div key={s.track_id} className="flex items-center gap-2 p-1.5 rounded bg-muted/30 text-xs">
                            <span className="flex-1 truncate text-muted-foreground">{s.name} — {s.artist_name}</span>
                            <button type="button" onClick={() => onExclude(idx, s.track_id)} className="text-xs text-primary hover:underline">↩ Restore</button>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Footer: pool stats + save button */}
      <div className="p-3 border-t flex items-center gap-3">
        <span className="text-xs text-muted-foreground flex-1">
          {totalPlaced} songs · {totalTracks - totalPlaced} skip songs
        </span>
        {savedUrl ? (
          <Button size="sm" asChild className="text-xs h-7">
            <a href={savedUrl} target="_blank" rel="noopener noreferrer">✓ Open in Spotify ↗</a>
          </Button>
        ) : (
          <Button size="sm" onClick={onSave} disabled={saving || totalPlaced === 0} className="text-xs h-7">
            {saving ? "Saving…" : "Save to Spotify →"}
          </Button>
        )}
      </div>
    </div>
  );
}
