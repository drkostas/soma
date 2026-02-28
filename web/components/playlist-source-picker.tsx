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
  const [progress, setProgress] = useState<{ stage: string; pct: number } | null>(null);

  useEffect(() => {
    fetch("/api/playlist/spotify/playlists").then(r => r.json()).then(setPlaylists).catch(() => {});
    fetch("/api/playlist/spotify/library").then(r => r.json()).then(setLibraryStatus).catch(() => {});
  }, []);

  const sources: SourceEntry[] = [{ id: "liked", name: "Liked Songs", tracks: libraryStatus?.total_tracks }, ...playlists];

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  }

  async function handleAnalyse() {
    setAnalysing(true);
    setProgress({ stage: "Starting…", pct: 0 });
    try {
      const res = await fetch("/api/playlist/spotify/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_ids: selected }),
      });
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const lines = part.trim().split("\n");
          const eventLine = lines.find((l) => l.startsWith("event: "));
          const dataLine = lines.find((l) => l.startsWith("data: "));
          if (!eventLine || !dataLine) continue;
          const evt = eventLine.slice(7).trim();
          const data = JSON.parse(dataLine.slice(6));
          if (evt === "progress") {
            setProgress({ stage: data.stage, pct: data.pct });
          } else if (evt === "done") {
            setProgress({ stage: `Done — ${data.new} new, ${data.cached} cached`, pct: 100 });
            const status = await fetch("/api/playlist/spotify/library").then(r => r.json());
            setLibraryStatus(status);
          } else if (evt === "error") {
            setProgress({ stage: `Error: ${data.message}`, pct: 0 });
          }
        }
      }
    } catch (err) {
      setProgress({ stage: `Error: ${String(err)}`, pct: 0 });
    } finally {
      setAnalysing(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground mb-2">Select music sources</div>
      <div className="max-h-60 overflow-y-auto space-y-1">
        {sources.map(s => (
          <label key={s.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted cursor-pointer">
            <Checkbox checked={selected.includes(s.id)} onCheckedChange={() => toggle(s.id)} />
            <span className="text-sm flex-1">{s.name}</span>
            {s.tracks != null && <span className="text-xs text-muted-foreground">{s.tracks}</span>}
          </label>
        ))}
      </div>
      <Button size="sm" className="w-full mt-2" disabled={analysing} onClick={handleAnalyse}>
        {analysing ? "Analysing…" : "Analyse Library"}
      </Button>
      {progress && (
        <div className="space-y-1 pt-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="truncate pr-2">{progress.stage}</span>
            <span className="shrink-0">{progress.pct}%</span>
          </div>
          <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
      )}
      {!progress && libraryStatus && (
        <div className="text-xs text-muted-foreground text-center">
          {libraryStatus.tracks_with_bpm} / {libraryStatus.total_tracks} tracks analysed
        </div>
      )}
    </div>
  );
}
