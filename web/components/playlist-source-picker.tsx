// web/components/playlist-source-picker.tsx
"use client";
import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface SpotifyPlaylist { id: string; name: string; tracks: number; }
interface LibraryStatus { total_tracks: number; tracks_with_bpm: number; }
interface SourceEntry { id: string; name: string; tracks?: number; }

interface Props {
  selected: string[];
  onChange: (v: string[]) => void;
}

function formatRateLimitError(msg: string): string {
  const match = msg.match(/rate-limited for (\d+) min/i);
  if (!match) return msg;
  const mins = parseInt(match[1], 10);
  const until = new Date(Date.now() + mins * 60 * 1000);
  const timeStr = until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dateStr = until.toLocaleDateString([], { month: "short", day: "numeric" });
  const sameDay = until.toDateString() === new Date().toDateString();
  return `Spotify rate limit — try again after ${sameDay ? timeStr : `${dateStr} at ${timeStr}`}`;
}

export default function PlaylistSourcePicker({ selected, onChange }: Props) {
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(true);
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; pct: number } | null>(null);

  useEffect(() => {
    fetch("/api/playlist/spotify/playlists")
      .then(r => r.json())
      .then(setPlaylists)
      .catch(() => {})
      .finally(() => setLoadingPlaylists(false));
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
            setProgress({ stage: `Done — ${data.new} new tracks analysed`, pct: 100 });
            const status = await fetch("/api/playlist/spotify/library").then(r => r.json());
            setLibraryStatus(status);
          } else if (evt === "error") {
            setProgress({ stage: formatRateLimitError(data.message), pct: 0 });
          }
        }
      }
    } catch (err) {
      setProgress({ stage: `Error: ${String(err)}`, pct: 0 });
    } finally {
      setAnalysing(false);
    }
  }

  const bpmWithData = libraryStatus ? Number(libraryStatus.tracks_with_bpm) : 0;
  const bpmTotal = libraryStatus ? Number(libraryStatus.total_tracks) : 0;
  const bpmPct = bpmTotal > 0 ? Math.round((bpmWithData / bpmTotal) * 100) : 0;
  const needsAnalysis = libraryStatus && bpmWithData === 0;

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground mb-1">Music sources</div>
      <div className="max-h-52 overflow-y-auto space-y-0.5">
        {loadingPlaylists && playlists.length === 0 ? (
          <>
            {[0, 1, 2].map(i => (
              <div key={i} className="flex items-center gap-2 p-1.5 rounded animate-pulse">
                <div className="h-4 w-4 rounded bg-muted shrink-0" />
                <div className="h-3 rounded bg-muted flex-1" style={{ width: `${60 + i * 15}%` }} />
              </div>
            ))}
          </>
        ) : (
          sources.map(s => (
            <label key={s.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted cursor-pointer">
              <Checkbox checked={selected.includes(s.id)} onCheckedChange={() => toggle(s.id)} />
              <span className="text-sm flex-1">{s.name}</span>
              {s.tracks != null && <span className="text-xs text-muted-foreground">{s.tracks.toLocaleString()}</span>}
            </label>
          ))
        )}
      </div>

      <div className="border-t pt-2 space-y-1.5">
        <div className="text-xs text-muted-foreground">
          {libraryStatus ? (
            needsAnalysis ? (
              <span className="text-amber-500">⚠ No BPM data yet — click Analyse to enable song matching</span>
            ) : (
              <span>{bpmPct}% of tracks have BPM data ({bpmWithData.toLocaleString()} / {bpmTotal.toLocaleString()})</span>
            )
          ) : (
            <span className="text-muted-foreground/60">Loading library status…</span>
          )}
        </div>
        <Button size="sm" className="w-full" disabled={analysing} onClick={handleAnalyse}>
          {analysing ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Analysing…</> : "Analyse Library (fetch BPM data)"}
        </Button>
      </div>

      {progress && (
        <div className="space-y-1 pt-0.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="truncate pr-2">{progress.stage}</span>
            {progress.pct > 0 && <span className="shrink-0">{progress.pct}%</span>}
          </div>
          {progress.pct > 0 && (
            <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress.pct}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
