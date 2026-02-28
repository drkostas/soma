// web/components/playlist-run-selector.tsx
"use client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import { Trash2, Dumbbell, CopyPlus } from "lucide-react";

interface GarminRun { activity_id: string; activity_name: string; start_time: string; distance: number; duration: number; }
interface Session { id: number; created_at: string; garmin_activity_id: string | null; spotify_playlist_url: string | null; spotify_playlist_id: string | null; song_assignments?: Record<string, unknown[]>; source_playlist_ids?: string[]; workout_name?: string | null; }
interface WorkoutPlan { id: number; name: string; sport_type: string; segments: unknown[]; total_duration_s: number; garmin_workout_id: string | null; garmin_push_status: string; created_at: string; }
interface GarminWorkout { workout_id: string; workout_name: string; sport_type: string; steps_summary: string | null; segments: unknown[]; }

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSelect: (run: { type: "garmin" | "plan" | "session"; data: any; segments: any[] }) => void;
}

export default function PlaylistRunSelector({ onSelect }: Props) {
  const [garminRuns, setGarminRuns] = useState<GarminRun[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [garminWorkouts, setGarminWorkouts] = useState<GarminWorkout[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const id = setTimeout(() => {
      fetch(`/api/playlist/garmin-runs?limit=50&q=${encodeURIComponent(search)}`)
        .then(r => r.json()).then(setGarminRuns).catch(() => {});
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    fetch("/api/playlist/sessions").then(r => r.json()).then(setSessions).catch(() => {});
    fetch("/api/playlist/workout-plans").then(r => r.json()).then(setPlans).catch(() => {});
    fetch("/api/playlist/garmin-workouts").then(r => r.json()).then(setGarminWorkouts).catch(() => {});
  }, []);

  async function selectGarminRun(run: GarminRun) {
    const data = await fetch(`/api/playlist/garmin-runs?id=${run.activity_id}`).then(r => r.json());
    onSelect({ type: "garmin", data: run, segments: data.segments ?? [] });
  }

  async function deleteSession(e: React.MouseEvent, sessionId: number) {
    e.stopPropagation();
    await fetch(`/api/playlist/sessions/${sessionId}`, { method: "DELETE" });
    setSessions(prev => prev.filter(s => s.id !== sessionId));
  }

  async function deletePlan(e: React.MouseEvent, planId: number) {
    e.stopPropagation();
    await fetch(`/api/playlist/workout-plans/${planId}`, { method: "DELETE" });
    setPlans(prev => prev.filter(p => p.id !== planId));
  }

  const totalPlans = plans.length + garminWorkouts.length;

  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="past" className="flex-1 flex flex-col">
        <TabsList className="mx-3 mt-2 shrink-0">
          <TabsTrigger value="past" className="text-xs">Past Runs</TabsTrigger>
          <TabsTrigger value="plans" className="text-xs gap-1">
            Saved Plans
            {totalPlans > 0 && <span className="text-muted-foreground">({totalPlans})</span>}
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs gap-1">
            History
            {sessions.length > 0 && <span className="text-muted-foreground">({sessions.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="manual" className="text-xs">Manual</TabsTrigger>
        </TabsList>

        {/* Past Runs */}
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

        {/* Saved Plans — user-created plans + Garmin structured workouts */}
        <TabsContent value="plans" className="flex-1 overflow-hidden flex flex-col px-3 pb-3">
          <div className="flex-1 overflow-y-auto space-y-1">
          {totalPlans === 0 ? (
            <div className="text-xs text-muted-foreground pt-4 text-center space-y-1">
              <p>No saved plans yet.</p>
              <p className="text-muted-foreground/60">Build a plan in the editor and click "Save Plan", or sync Garmin structured workouts.</p>
            </div>
          ) : (
            <>
              {garminWorkouts.length > 0 && (
                <div className="text-xs font-medium text-muted-foreground pt-1 pb-0.5 flex items-center gap-1">
                  <Dumbbell className="h-3 w-3" /> From Garmin Connect
                </div>
              )}
              {garminWorkouts.map(w => (
                <button key={w.workout_id}
                  onClick={() => onSelect({ type: "plan", data: { ...w, source: "garmin_workout" }, segments: (w.segments as unknown[]) ?? [] })}
                  className="w-full text-left p-2.5 rounded-lg border hover:bg-muted transition-colors">
                  <div className="text-sm font-medium truncate">{w.workout_name}</div>
                  {w.steps_summary && <div className="text-xs text-muted-foreground truncate mt-0.5">{w.steps_summary}</div>}
                </button>
              ))}

              {plans.length > 0 && (
                <div className="text-xs font-medium text-muted-foreground pt-2 pb-0.5">Saved in Builder</div>
              )}
              {plans.map(p => (
                <div key={p.id} className="flex items-center gap-1">
                  <button
                    onClick={() => onSelect({ type: "plan", data: { ...p, source: "saved_plan" }, segments: (p.segments as unknown[]) ?? [] })}
                    className="flex-1 text-left p-2.5 rounded-lg border hover:bg-muted transition-colors min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {p.segments.length} {p.segments.length === 1 ? "segment" : "segments"} · {Math.round(p.total_duration_s / 60)} min
                      {p.garmin_push_status === "pushed" && <span className="ml-1 text-green-500">· On Garmin ✓</span>}
                      {p.garmin_push_status === "pending" && <span className="ml-1 text-amber-500">· Syncing to Garmin…</span>}
                      {p.garmin_push_status === "failed" && <span className="ml-1 text-red-400">· Garmin push failed</span>}
                    </div>
                  </button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-red-400"
                    onClick={(e) => deletePlan(e, p.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </>
          )}
          </div>
        </TabsContent>

        {/* History */}
        <TabsContent value="history" className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
          {sessions.length === 0 && <div className="text-xs text-muted-foreground pt-4 text-center">No past sessions yet</div>}
          {sessions.map(s => {
            const totalSongs = Object.values(s.song_assignments ?? {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
            const segments = Object.keys(s.song_assignments ?? {}).length;
            return (
              <div key={s.id} className="flex items-center gap-1">
                <button onClick={() => onSelect({ type: "session", data: s, segments: [] })}
                  className="flex-1 text-left p-2.5 rounded-lg border hover:bg-muted transition-colors min-w-0">
                  <div className="text-xs font-medium truncate">{s.workout_name ?? formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {s.workout_name && <span>{formatDistanceToNow(new Date(s.created_at), { addSuffix: true })} · </span>}
                    {segments > 0 ? `${segments} ${segments === 1 ? "segment" : "segments"} · ${totalSongs} ${totalSongs === 1 ? "song" : "songs"}` : "No songs generated"}
                  </div>
                  {s.spotify_playlist_url && (
                    <a href={s.spotify_playlist_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline mt-0.5 block" onClick={e => e.stopPropagation()}>
                      Open in Spotify ↗
                    </a>
                  )}
                </button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-primary"
                  title="Duplicate as new (won't overwrite existing playlist)"
                  onClick={(e) => { e.stopPropagation(); onSelect({ type: "session", data: { ...s, id: null, spotify_playlist_id: null, spotify_playlist_url: null }, segments: [] }); }}>
                  <CopyPlus className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-red-400"
                  onClick={(e) => deleteSession(e, s.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="manual" className="px-3 pb-3">
          <div className="text-xs text-muted-foreground pt-4 text-center">Manual builder — coming soon</div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
