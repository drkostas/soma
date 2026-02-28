// web/components/song-card.tsx
"use client";
import { motion } from "motion/react";
import { X, SkipForward, Info, Zap } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

export interface SongData {
  track_id: string; name: string; artist_name: string;
  tempo: number; energy: number; duration_ms: number;
  is_skip?: boolean; is_half_time?: boolean; has_genre_warning?: boolean;
}

interface Props {
  song: SongData;
  onExclude: () => void;
  onPreview: () => void;
  draggable?: boolean;
  onAddToPumpUp?: () => void;
}

export default function SongCard({ song, onExclude, onPreview, draggable: _draggable, onAddToPumpUp }: Props) {
  const durationStr = `${Math.floor(song.duration_ms / 60000)}:${String(Math.floor((song.duration_ms % 60000) / 1000)).padStart(2, "0")}`;
  const energyWidth = `${Math.round(song.energy * 100)}%`;

  if (song.is_skip) {
    return (
      <motion.div
        layout
        className="rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 p-2.5"
      >
        <div className="flex items-center gap-2">
          <SkipForward className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{song.name}</div>
            <div className="text-xs text-muted-foreground truncate">{song.artist_name}</div>
          </div>
          {song.tempo > 0 && <div className="text-xs text-muted-foreground whitespace-nowrap">{song.tempo.toFixed(0)} BPM</div>}
          <Badge variant="outline" className="text-xs shrink-0">SKIP</Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-muted-foreground">
                <Info className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              Start this song before your segment ends. Skip it when your watch transitions — the next segment&apos;s music starts immediately.
            </TooltipContent>
          </Tooltip>
          <button type="button" onClick={onExclude} className="text-muted-foreground hover:text-destructive p-0.5">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      whileHover={{ scale: 1.01 }}
      className="group rounded-lg border bg-card p-2.5 cursor-pointer"
      onClick={onPreview}
    >
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{song.name}</div>
          <div className="text-xs text-muted-foreground truncate">{song.artist_name}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {song.is_half_time && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] px-1 py-0">½</Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                This song runs at {song.tempo.toFixed(0)} BPM but feels right at {(song.tempo * 2).toFixed(0)} SPM — your foot lands on every other beat.
              </TooltipContent>
            </Tooltip>
          )}
          {song.has_genre_warning && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-400 text-amber-400">⚠</Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">Outside current genre filter — placed intentionally</TooltipContent>
            </Tooltip>
          )}
          {song.tempo > 0 && <span className="text-xs text-muted-foreground">{song.tempo.toFixed(0)} BPM</span>}
          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary/60 rounded-full" style={{ width: energyWidth }} />
          </div>
          {song.duration_ms > 0 && (
            <span className="text-xs text-muted-foreground hidden group-hover:block">{durationStr}</span>
          )}
        </div>
        {onAddToPumpUp && (
          <button
            type="button"
            aria-label="Add to pump-up bank"
            onClick={(e) => { e.stopPropagation(); onAddToPumpUp(); }}
            className="text-muted-foreground hover:text-amber-400 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Zap className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onExclude(); }}
          className="text-muted-foreground hover:text-destructive p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
