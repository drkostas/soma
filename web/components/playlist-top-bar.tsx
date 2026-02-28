// web/components/playlist-top-bar.tsx
"use client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronLeft, Zap } from "lucide-react";
import PlaylistSourcePicker from "./playlist-source-picker";
import PlaylistGenrePicker from "./playlist-genre-picker";

interface Props {
  sources: string[];
  onSourcesChange: (v: string[]) => void;
  genres: string[];
  onGenresChange: (v: string[]) => void;
  genreThreshold: number;
  onThresholdChange: (v: number) => void;
  workoutName?: string;
  onChangeRun?: () => void;
  onOpenBank: () => void;
}

export default function PlaylistTopBar({ sources, onSourcesChange, genres, onGenresChange, genreThreshold, onThresholdChange, workoutName, onChangeRun, onOpenBank }: Props) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 p-2 border-b bg-background/80 backdrop-blur-sm">
      {workoutName && onChangeRun ? (
        <div className="flex items-center gap-1 min-w-0">
          <Button type="button" variant="ghost" size="sm" onClick={onChangeRun} className="h-7 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0">
            <ChevronLeft className="h-3.5 w-3.5" />
            Change run
          </Button>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium truncate max-w-[200px]">{workoutName}</span>
        </div>
      ) : (
        <span className="text-sm font-medium truncate max-w-[160px] text-muted-foreground">{workoutName ?? "No run selected"}</span>
      )}
      <div className="flex-1" />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
            Sources <span className="text-muted-foreground">({sources.length})</span> <ChevronDown className="w-3 h-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-3">
          <PlaylistSourcePicker selected={sources} onChange={onSourcesChange} />
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
            Genres <span className="text-muted-foreground">({genres.length})</span> <ChevronDown className="w-3 h-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-3">
          <PlaylistGenrePicker selected={genres} onChange={onGenresChange} threshold={genreThreshold} onThresholdChange={onThresholdChange} />
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onOpenBank}>
        <Zap className="w-3 h-3" /> Bank
      </Button>
    </div>
  );
}
