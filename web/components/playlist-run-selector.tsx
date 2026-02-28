// web/components/playlist-run-selector.tsx
"use client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";

interface GarminRun { activity_id: string; activity_name: string; start_time: string; distance: number; duration: number; }
interface Session { id: number; created_at: string; garmin_activity_id: string | null; spotify_playlist_url: string | null; song_assignments?: Record<string, unknown[]>; source_playlist_ids?: string[]; }

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSelect: (run: { type: "garmin" | "plan" | "session"; data: any; segments: any[] }) => void;
}

export default function PlaylistRunSelector({ onSelect }: Props) {
  const [garminRuns, setGarminRuns] = useState<GarminRun[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const id = setTimeout(() => {
      fetch(`/api/playlist/garmin-runs?limit=50&q=${encodeURIComponent(search)}`)
        .then(r => r.json())
        .then(setGarminRuns)
        .catch(() => {});
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    fetch("/api/playlist/sessions").then(r => r.json()).then(setSessions).catch(() => {});
  }, []);

  async function selectGarminRun(run: GarminRun) {
    const data = await fetch(`/api/playlist/garmin-runs?id=${run.activity_id}`).then(r => r.json());
    onSelect({ type: "garmin", data: run, segments: data.segments ?? [] });
  }

  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="past" className="flex-1 flex flex-col">
        <TabsList className="mx-3 mt-2 shrink-0">
          <TabsTrigger value="past" className="text-xs">Past Runs</TabsTrigger>
          <TabsTrigger value="plans" className="text-xs">Saved Plans</TabsTrigger>
          <TabsTrigger value="manual" className="text-xs">Manual</TabsTrigger>
          <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
        </TabsList>

        <TabsContent value="past" className="flex-1 overflow-hidden flex flex-col px-3 pb-3">
          <Input placeholder="Search runs…" value={search} onChange={e => setSearch(e.target.value)} className="my-2 h-7 text-xs" />
          <div className="flex-1 overflow-y-auto space-y-1">
            {garminRuns.length === 0 && <div className="text-xs text-muted-foreground text-center pt-6">No runs found{search ? ` for "${search}"` : ""}</div>}
            {garminRuns.map(run => (
              <button key={run.activity_id} onClick={() => selectGarminRun(run)}
                className="w-full text-left p-2.5 rounded-lg border hover:bg-muted transition-colors">
                <div className="text-sm font-medium truncate">{run.activity_name}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(run.start_time.replace(" ", "T")), { addSuffix: true })} · {(run.distance / 1000).toFixed(1)} km · {Math.round(run.duration / 60)} min
                </div>
              </button>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="history" className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
          {sessions.length === 0 && <div className="text-xs text-muted-foreground pt-4 text-center">No past sessions yet</div>}
          {sessions.map(s => {
            const totalSongs = Object.values(s.song_assignments ?? {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
            const segments = Object.keys(s.song_assignments ?? {}).length;
            return (
              <button key={s.id} onClick={() => { onSelect({ type: "session", data: s, segments: [] }); }}
                className="w-full text-left p-2.5 rounded-lg border hover:bg-muted transition-colors">
                <div className="text-xs font-medium">{formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {segments > 0 ? `${segments} ${segments === 1 ? "segment" : "segments"} · ${totalSongs} ${totalSongs === 1 ? "song" : "songs"}` : "No songs generated"}
                </div>
                {s.spotify_playlist_url && <a href={s.spotify_playlist_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline mt-0.5 block" onClick={e => e.stopPropagation()}>Open in Spotify ↗</a>}
              </button>
            );
          })}
        </TabsContent>

        <TabsContent value="plans" className="px-3 pb-3">
          <div className="text-xs text-muted-foreground pt-4 text-center">No saved plans yet</div>
        </TabsContent>

        <TabsContent value="manual" className="px-3 pb-3">
          <div className="text-xs text-muted-foreground pt-4 text-center">Manual builder — coming soon</div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
