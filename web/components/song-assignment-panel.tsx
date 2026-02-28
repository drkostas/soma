// web/components/song-assignment-panel.tsx
"use client";
import { motion, AnimatePresence, Reorder } from "motion/react";
import { Zap, AlertTriangle, ChevronDown, Repeat2 } from "lucide-react";
import SongCard, { SongData } from "./song-card";
import SongAlternativesStrip from "./song-alternatives-strip";
import { Segment, SegmentItem, RepeatGroup, TYPE_COLORS } from "./segment-editor";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";

interface SegmentSongs {
  songs: SongData[];
  loading?: boolean;
  poolCount?: number;
  warning?: string;
}

interface Props {
  items: SegmentItem[];
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

interface SectionProps {
  seg: Segment;
  flatIdx: number;
  label?: string;
  assignment: SegmentSongs | undefined;
  excludedIds: Set<string>;
  allPlacedIds: Set<string>;
  selectedGenres: string[];
  isFocused: boolean;
  showExcluded: boolean;
  onFocus: () => void;
  onPumpUp: () => void;
  onReorder: (songs: SongData[]) => void;
  onExclude: (trackId: string) => void;
  onPlace: (song: SongData) => void;
  onPreview: (song: SongData) => void;
  onToggleExcluded: () => void;
}

function SegmentSection({
  seg, flatIdx, label, assignment, excludedIds, allPlacedIds, selectedGenres,
  isFocused, showExcluded, onFocus, onPumpUp, onReorder, onExclude, onPlace, onPreview, onToggleExcluded
}: SectionProps) {
  const songs = assignment?.songs ?? [];
  const excluded = songs.filter(s => excludedIds.has(s.track_id));
  const placed = songs.filter(s => !excludedIds.has(s.track_id));
  const nonSkip = placed.filter(s => !s.is_skip);
  const skipSong = placed.find(s => s.is_skip);
  const displayLabel = label ?? seg.type;
  const durationMin = Math.round(seg.duration_s / 60);

  return (
    <div>
      {/* Section header */}
      <div
        className="w-full flex items-center gap-2 text-left mb-2 cursor-pointer"
        role="button" tabIndex={0}
        onClick={onFocus}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFocus(); } }}
      >
        <div className={`w-1 h-4 rounded-full shrink-0 ${TYPE_COLORS[seg.type] ?? "bg-muted"}`} />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground capitalize">{displayLabel}</span>
        <span className="text-xs text-muted-foreground">{durationMin} min</span>
        <span className="text-xs text-muted-foreground">{seg.bpm_min}–{seg.bpm_max} BPM</span>
        {assignment?.warning && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
        <button type="button" onClick={(e) => { e.stopPropagation(); onPumpUp(); }} className="ml-auto text-muted-foreground hover:text-amber-400 transition-colors shrink-0">
          <Zap className="w-3.5 h-3.5" />
        </button>
        {assignment && <span className="text-xs text-muted-foreground shrink-0">Pool: {assignment.poolCount ?? "?"} · {nonSkip.length} placed</span>}
      </div>

      {/* Song list */}
      <Reorder.Group
        axis="y"
        values={nonSkip}
        onReorder={(reordered) => onReorder([...reordered, ...(skipSong ? [skipSong] : [])])}
        className="space-y-1.5"
      >
        {assignment?.loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-12 rounded-lg bg-muted animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
          ))
        ) : (
          nonSkip.map(song => (
            <Reorder.Item key={song.track_id} value={song} as="div">
              <SongCard song={song} onExclude={() => onExclude(song.track_id)} onPreview={() => onPreview(song)} draggable />
            </Reorder.Item>
          ))
        )}
      </Reorder.Group>

      {skipSong && !assignment?.loading && (
        <div className="mt-1.5">
          <SongCard song={skipSong} onExclude={() => onExclude(skipSong.track_id)} onPreview={() => onPreview(skipSong)} />
        </div>
      )}

      {/* Alternatives strip */}
      <div className="mt-2">
        <SongAlternativesStrip
          segmentConfig={{ bpm_min: seg.bpm_min, bpm_max: seg.bpm_max, bpm_tolerance: seg.bpm_tolerance, valence_min: seg.valence_min, valence_max: seg.valence_max, min_energy: 0.5, genres: selectedGenres }}
          placedIds={allPlacedIds}
          onPreview={onPreview}
          onPlace={onPlace}
        />
      </div>

      {/* Excluded songs collapsible */}
      {excluded.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={onToggleExcluded} className="text-xs text-muted-foreground flex items-center gap-1">
            Excluded ({excluded.length}) <ChevronDown className={`w-3 h-3 transition-transform ${showExcluded ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence>
            {showExcluded && (
              <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden mt-1 space-y-1">
                {excluded.map(s => (
                  <div key={s.track_id} className="flex items-center gap-2 p-1.5 rounded bg-muted/30 text-xs">
                    <span className="flex-1 truncate text-muted-foreground">{s.name} — {s.artist_name}</span>
                    <button type="button" onClick={() => onExclude(s.track_id)} className="text-xs text-primary hover:underline">↩ Restore</button>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

export default function SongAssignmentPanel({
  items, assignments, excludedIds, selectedGenres,
  focusedIdx, onFocus, onExclude, onPlace, onReorder,
  onPreview, onPumpUp, onSave, saving, savedUrl
}: Props) {
  const [showExcluded, setShowExcluded] = useState<Record<number, boolean>>({});

  const flatStarts = useMemo(() => {
    const starts: number[] = [];
    let idx = 0;
    for (const item of items) {
      starts.push(idx);
      idx += item.type === "repeat" ? item.children.length : 1;
    }
    return starts;
  }, [items]);

  const allPlacedIds = useMemo(() => new Set(
    Object.values(assignments).flatMap(a => a.songs.map(s => s.track_id))
  ), [assignments]);

  // Deduplicate by track_id for footer counts
  const uniqueSongs = useMemo(() => {
    const seen = new Map<string, SongData>();
    for (const a of Object.values(assignments)) {
      for (const s of a.songs) {
        if (!seen.has(s.track_id)) seen.set(s.track_id, s);
      }
    }
    return [...seen.values()];
  }, [assignments]);

  const totalPlaced = uniqueSongs.filter(s => !s.is_skip && !excludedIds.has(s.track_id)).length;
  const totalSkip = uniqueSongs.filter(s => s.is_skip && !excludedIds.has(s.track_id)).length;

  function sectionProps(seg: Segment, flatIdx: number): Omit<SectionProps, "seg" | "flatIdx" | "label"> {
    return {
      assignment: assignments[flatIdx],
      excludedIds,
      allPlacedIds,
      selectedGenres,
      isFocused: focusedIdx === flatIdx,
      showExcluded: !!showExcluded[flatIdx],
      onFocus: () => onFocus(focusedIdx === flatIdx ? -1 : flatIdx),
      onPumpUp: () => onPumpUp(flatIdx),
      onReorder: (songs) => onReorder(flatIdx, songs),
      onExclude: (trackId) => onExclude(flatIdx, trackId),
      onPlace: (song) => onPlace(flatIdx, song),
      onPreview,
      onToggleExcluded: () => setShowExcluded(p => ({ ...p, [flatIdx]: !p[flatIdx] })),
    };
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {items.map((item, itemIdx) => {
          const flatStart = flatStarts[itemIdx];

          if (item.type === "repeat") {
            const group = item as RepeatGroup;
            const template = group.children.slice(0, group.template_size);
            const allShort = template.every(s => s.duration_s <= 120);
            const totalDuration = group.children.reduce((s, c) => s + c.duration_s, 0);
            const groupFocused = focusedIdx >= flatStart && focusedIdx < flatStart + group.children.length;

            return (
              <motion.div key={group.id} layout animate={{ opacity: focusedIdx !== -1 && !groupFocused ? 0.5 : 1 }}>
                <div className="rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 overflow-hidden">
                  {/* Group header */}
                  <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-dashed border-muted-foreground/20 select-none">
                    <Repeat2 className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="text-xs font-bold text-foreground">{group.repeat_count}×</span>
                    <span className="text-xs text-muted-foreground">repeat</span>
                    <span className="text-xs text-muted-foreground ml-auto">{Math.round(totalDuration / 60)} min total</span>
                  </div>

                  <div className="px-3 py-3 space-y-4">
                    {allShort ? (
                      // Entire group bundled into one song block
                      <SegmentSection
                        key={flatStart}
                        seg={{ ...template[0], duration_s: totalDuration }}
                        flatIdx={flatStart}
                        label={`${group.repeat_count}× ${template[0].type}`}
                        {...sectionProps({ ...template[0], duration_s: totalDuration }, flatStart)}
                      />
                    ) : (
                      // One section per template step, bundled across iterations
                      template.map((step, t) => (
                        <SegmentSection
                          key={step.id}
                          seg={{ ...step, duration_s: step.duration_s * group.repeat_count }}
                          flatIdx={flatStart + t}
                          label={`${step.type} (${group.repeat_count}×)`}
                          {...sectionProps({ ...step, duration_s: step.duration_s * group.repeat_count }, flatStart + t)}
                        />
                      ))
                    )}
                  </div>
                </div>
              </motion.div>
            );
          }

          const seg = item as Segment;
          const isFocused = focusedIdx === flatStart;
          return (
            <motion.div key={seg.id} layout animate={{ opacity: focusedIdx !== -1 && !isFocused ? 0.5 : 1 }}>
              <SegmentSection
                seg={seg}
                flatIdx={flatStart}
                {...sectionProps(seg, flatStart)}
              />
            </motion.div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="p-3 border-t flex items-center gap-3">
        <span className="text-xs text-muted-foreground flex-1">
          {totalPlaced} songs · {totalSkip} skip songs
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
