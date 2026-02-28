// web/components/playlist-source-picker.tsx
"use client";
import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

interface SpotifyPlaylist { id: string; name: string; tracks: number; }
interface LibraryStatus { total_tracks: number; tracks_with_bpm: number; }
interface SourceEntry { id: string; name: string; tracks?: number; }

interface Props {
  selected: string[];
  onChange: (v: string[]) => void;
}

export default function PlaylistSourcePicker({ selected, onChange }: Props) {
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus | null>(null);
  const [analysing, setAnalysing] = useState(false);

  useEffect(() => {
    fetch("/api/playlist/spotify/playlists").then(r => r.json()).then(setPlaylists).catch(() => {});
    fetch("/api/playlist/spotify/library").then(r => r.json()).then(setLibraryStatus).catch(() => {});
  }, []);

  const sources: SourceEntry[] = [{ id: "liked", name: "Liked Songs", tracks: libraryStatus?.total_tracks }, ...playlists];

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground mb-2">Select music sources</div>
      <div className="max-h-60 overflow-y-auto space-y-1">
        {sources.map(s => (
          <label key={s.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted cursor-pointer">
            <Checkbox checked={selected.includes(s.id)} onCheckedChange={() => toggle(s.id)} />
            <span className="text-sm flex-1">{s.name}</span>
            {s.tracks && <span className="text-xs text-muted-foreground">{s.tracks}</span>}
          </label>
        ))}
      </div>
      <Button size="sm" className="w-full mt-2" disabled={analysing} onClick={async () => {
        setAnalysing(true);
        await fetch("/api/playlist/spotify/library", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ source_ids: selected }) });
        const status = await fetch("/api/playlist/spotify/library").then(r => r.json());
        setLibraryStatus(status);
        setAnalysing(false);
      }}>
        {analysing ? "Analysing…" : "Analyse Library"}
      </Button>
      {libraryStatus && (
        <div className="text-xs text-muted-foreground text-center">
          {libraryStatus.tracks_with_bpm} / {libraryStatus.total_tracks} tracks analysed
        </div>
      )}
    </div>
  );
}
