// web/components/playlist-builder.tsx
"use client";
import { useState, useRef, useEffect } from "react";
import PlaylistTopBar from "./playlist-top-bar";
import RunSegmentTimeline from "./run-segment-timeline";
import SongAssignmentPanel from "./song-assignment-panel";
import SpotifyPlayer from "./spotify-player";
import { Segment } from "./segment-editor";
import { SongData } from "./song-card";
import { useUndoRedo } from "@/hooks/use-undo-redo";

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

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // Generate playlist via SSE
  async function generate(segs: Segment[]) {
    setAssignments(Object.fromEntries(segs.map((_, i) => [i, { songs: [], loading: true }])));
    const res = await fetch("/api/playlist/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments: segs, excluded_track_ids: Array.from(excludedIds), genre_selection: genres, genre_threshold: genreThreshold, source_playlist_ids: sources }),
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
        const event = JSON.parse(line.slice(6));
        if (event.type === "segment_done") {
          setAssignments(prev => ({ ...prev, [event.index]: { songs: event.songs, loading: false, poolCount: event.pool_count } }));
        } else if (event.type === "segment_warning") {
          setAssignments(prev => ({ ...prev, [event.index]: { ...prev[event.index], warning: event.message } }));
        } else if (event.type === "done") {
          setSessionId(event.session_id);
        }
      }
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

  function handleExclude(segIdx: number, trackId: string) {
    setExcludedIds(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) { next.delete(trackId); } else { next.add(trackId); }
      return next;
    });
    // Blacklist learning
    void fetch("/api/playlist/blacklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ track_id: trackId }) });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <PlaylistTopBar sources={sources} onSourcesChange={setSources} genres={genres} onGenresChange={setGenres} genreThreshold={genreThreshold} onThresholdChange={setGenreThreshold} workoutName={workoutName} />
      <div className="flex flex-1 overflow-hidden">
        {/* Left: run timeline */}
        <div ref={leftRef} className="w-[40%] border-r overflow-y-auto">
          <RunSegmentTimeline
            segments={segments}
            onChange={(segs) => { setSegments(segs); if (segs.length > 0) void generate(segs); }}
            focusedIdx={focusedIdx}
            onFocus={(i) => setFocusedIdx(i === focusedIdx ? -1 : i)}
            onPumpUp={(_idx) => { /* pump-up modal — Task 12 */ }}
          />
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
