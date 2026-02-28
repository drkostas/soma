// web/components/playlist-top-bar.tsx
"use client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
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
}

export default function PlaylistTopBar({ sources, onSourcesChange, genres, onGenresChange, genreThreshold, onThresholdChange, workoutName, onChangeRun }: Props) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 p-2 border-b bg-background/80 backdrop-blur-sm">
      {workoutName && onChangeRun ? (
        <button type="button" onClick={onChangeRun} className="text-sm font-medium truncate max-w-[160px] hover:text-muted-foreground transition-colors flex items-center gap-1" title="Change run">
          {workoutName} <span className="text-muted-foreground text-xs">↩</span>
        </button>
      ) : (
        <span className="text-sm font-medium truncate max-w-[160px]">{workoutName ?? "Pick a run ▾"}</span>
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
    </div>
  );
}
