// web/components/playlist-builder.tsx
"use client";
import { useState, useRef, useEffect } from "react";
import PlaylistTopBar from "./playlist-top-bar";
import RunSegmentTimeline from "./run-segment-timeline";
import SongAssignmentPanel from "./song-assignment-panel";
import SpotifyPlayer from "./spotify-player";
import PlaylistRunSelector from "./playlist-run-selector";
import { Segment, SegmentType, BPM_DEFAULTS } from "./segment-editor";
import { SongData } from "./song-card";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import { nanoid } from "nanoid";

function parsedToSegments(parsed: Array<{ type?: string; duration_s: number }>): Segment[] {
  return parsed.map((p) => {
    const type = (p.type as SegmentType) ?? "easy";
    const bpm = BPM_DEFAULTS[type] ?? { min: 125, max: 145 };
    return { id: nanoid(), type, duration_s: p.duration_s, bpm_min: bpm.min, bpm_max: bpm.max, bpm_tolerance: 8, sync_mode: "auto" as const, valence_min: 0.3, valence_max: 0.7 };
  });
}

interface SegmentSongs { songs: SongData[]; loading?: boolean; poolCount?: number; warning?: string; }

export default function PlaylistBuilder() {
  const [segments, setSegments, undo, redo] = useUndoRedo<Segment[]>([]);
  const [assignments, setAssignments] = useState<Record<number, SegmentSongs>>({});
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const [sources, setSources] = useState<string[]>(["liked"]);
  const [genres, setGenres] = useState<string[]>([]);
  const [genreThreshold, setGenreThreshold] = useState(0.03);
  const [previewSong, setPreviewSong] = useState<SongData | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | undefined>();
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [workoutName, setWorkoutName] = useState<string | undefined>();
  const [hasRun, setHasRun] = useState(false);
  const garminActivityIdRef = useRef<string | null>(null);

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const generateDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Scroll sync between panels
  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;
    const syncLeft = () => { if (syncingRef.current) return; syncingRef.current = true; right.scrollTop = left.scrollTop; syncingRef.current = false; };
    const syncRight = () => { if (syncingRef.current) return; syncingRef.current = true; left.scrollTop = right.scrollTop; syncingRef.current = false; };
    left.addEventListener("scroll", syncLeft);
    right.addEventListener("scroll", syncRight);
    return () => { left.removeEventListener("scroll", syncLeft); right.removeEventListener("scroll", syncRight); };
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleRunSelect(run: { type: "garmin" | "plan" | "session"; data: any; segments: any[] }) {
    if (run.type === "session" && !run.segments?.length) {
      // Restore session via its Garmin activity
      const garminId = run.data?.garmin_activity_id;
      if (!garminId) return;
      fetch(`/api/playlist/garmin-runs?id=${garminId}`)
        .then(r => r.json())
        .then(data => {
          const segs = parsedToSegments(data.segments ?? []);
          if (!segs.length) return;
          garminActivityIdRef.current = garminId;
          setSegments(segs);
          setWorkoutName(run.data?.activity_name ?? "Run");
          setHasRun(true);
          abortRef.current?.abort();
          abortRef.current = new AbortController();
          void generate(segs, abortRef.current.signal);
        })
        .catch(() => {});
      return;
    }
    if (run.segments?.length > 0) {
      const segs = parsedToSegments(run.segments);
      garminActivityIdRef.current = run.type === "garmin" ? (run.data?.activity_id ?? null) : null;
      setSegments(segs);
      setWorkoutName(run.data?.activity_name ?? run.data?.name ?? "Run");
      setHasRun(true);
      // Trigger initial playlist generation
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      void generate(segs, abortRef.current.signal);
    }
  }

  // Generate playlist via SSE
  async function generate(segs: Segment[], signal?: AbortSignal) {
    setAssignments(Object.fromEntries(segs.map((_, i) => [i, { songs: [], loading: true }])));
    setSavedUrl(undefined);  // Reset stale Spotify URL
    setSessionId(null);       // Reset stale session
    try {
      const res = await fetch("/api/playlist/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: segs, excluded_track_ids: Array.from(excludedIds), genre_selection: genres, genre_threshold: genreThreshold, source_playlist_ids: sources, garmin_activity_id: garminActivityIdRef.current }),
        signal,
      });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "segment_done") {
              setAssignments(prev => ({ ...prev, [event.index]: { songs: event.songs, loading: false, poolCount: event.pool_count } }));
            } else if (event.type === "segment_warning") {
              setAssignments(prev => ({ ...prev, [event.index]: { ...prev[event.index], warning: event.message } }));
            } else if (event.type === "done") {
              setSessionId(event.session_id);
            } else if (event.type === "error") {
              console.error("Playlist generation error:", event.message);
              setAssignments(prev => {
                const next = { ...prev };
                for (const k in next) {
                  if (next[k].loading) next[k] = { ...next[k], loading: false, warning: "Generation failed" };
                }
                return next;
              });
            }
          } catch (err) {
            console.error("SSE parse error:", err);
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return; // Ignore cancellation
      console.error("Generate failed:", err);
      setAssignments(prev => {
        const next = { ...prev };
        for (const k in next) {
          if (next[k].loading) next[k] = { ...next[k], loading: false, warning: "Generation failed" };
        }
        return next;
      });
    }
  }

  async function handleSave() {
    if (!sessionId) return;
    setSaving(true);
    const allTracks = Object.values(assignments).flatMap(a => a.songs.filter(s => !excludedIds.has(s.track_id)).map(s => s.track_id));
    const name = `Soma: ${workoutName ?? "Run"} · ${new Date().toLocaleDateString()}`;
    try {
      const res = await fetch("/api/playlist/spotify/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, name, track_ids: allTracks }),
      });
      const data = await res.json();
      setSavedUrl(data.playlist_url);
    } catch {
      console.error("Failed to save playlist");
    } finally {
      setSaving(false);
    }
  }

  function handleExclude(_segIdx: number, trackId: string) {
    const isExcluding = !excludedIds.has(trackId);
    setExcludedIds(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) { next.delete(trackId); } else { next.add(trackId); }
      return next;
    });
    // Blacklist learning — only call API when actually excluding, not restoring
    if (isExcluding) {
      void fetch("/api/playlist/blacklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ track_id: trackId }) });
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <PlaylistTopBar sources={sources} onSourcesChange={setSources} genres={genres} onGenresChange={setGenres} genreThreshold={genreThreshold} onThresholdChange={setGenreThreshold} workoutName={workoutName} onChangeRun={() => { abortRef.current?.abort(); garminActivityIdRef.current = null; setHasRun(false); setSegments([]); setAssignments({}); setWorkoutName(undefined); }} />
      <div className="flex flex-1 overflow-hidden">
        {/* Left: run selector (first time) or run timeline */}
        <div ref={leftRef} className="w-[40%] border-r overflow-y-auto">
          {!hasRun ? (
            <div className="h-full flex flex-col">
              <div className="px-3 py-2 border-b text-xs font-medium text-muted-foreground">Select a run to get started</div>
              <div className="flex-1 overflow-hidden">
                <PlaylistRunSelector onSelect={handleRunSelect} />
              </div>
            </div>
          ) : (
            <RunSegmentTimeline
              segments={segments}
              onChange={(segs) => {
                setSegments(segs);
                if (segs.length > 0) {
                  clearTimeout(generateDebounceRef.current);
                  generateDebounceRef.current = setTimeout(() => {
                    abortRef.current?.abort();
                    abortRef.current = new AbortController();
                    void generate(segs, abortRef.current.signal);
                  }, 600);
                }
              }}
              focusedIdx={focusedIdx}
              onFocus={(i) => setFocusedIdx(i === focusedIdx ? -1 : i)}
              onPumpUp={(_idx) => { /* pump-up modal — Task 12 */ }}
            />
          )}
        </div>
        {/* Right: song assignment */}
        <div ref={rightRef} className="flex-1 overflow-y-auto">
          <SongAssignmentPanel
            segments={segments}
            assignments={assignments}
            excludedIds={excludedIds}
            selectedGenres={genres}
            focusedIdx={focusedIdx}
            onFocus={(i) => setFocusedIdx(i === focusedIdx ? -1 : i)}
            onExclude={handleExclude}
            onPlace={(idx, song) => setAssignments(prev => ({ ...prev, [idx]: { ...prev[idx], songs: [...(prev[idx]?.songs ?? []).filter(s => !s.is_skip), song, ...(prev[idx]?.songs ?? []).filter(s => s.is_skip)] } }))}
            onReorder={(idx, songs) => setAssignments(prev => ({ ...prev, [idx]: { ...prev[idx], songs } }))}
            onPreview={setPreviewSong}
            onPumpUp={(_idx) => { /* pump-up modal — Task 12 */ }}
            onSave={handleSave}
            saving={saving}
            savedUrl={savedUrl}
          />
        </div>
      </div>
      {/* Mini player */}
      <SpotifyPlayer currentSong={previewSong} />
    </div>
  );
}
