// web/components/playlist-builder.tsx
"use client";
import { useState, useRef, useEffect } from "react";
import PlaylistTopBar from "./playlist-top-bar";
import RunSegmentTimeline from "./run-segment-timeline";
import SongAssignmentPanel from "./song-assignment-panel";
import SpotifyPlayer from "./spotify-player";
import PlaylistRunSelector from "./playlist-run-selector";
import PumpUpModal from "./pump-up-modal";
import { Segment, SegmentItem, RepeatGroup, SegmentType, BPM_DEFAULTS } from "./segment-editor";
import { flatItems } from "./run-segment-timeline";
import { SongData } from "./song-card";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import { nanoid } from "nanoid";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ParsedStep = { type?: string; duration_s?: number } | { type: "repeat"; repeat_count: number; children: ParsedStep[] };

function makeSegment(p: { type?: string; duration_s?: number }): Segment {
  const type = (p.type as SegmentType) ?? "easy";
  const bpm = BPM_DEFAULTS[type] ?? { min: 125, max: 145, valence_min: 0.3, valence_max: 0.7 };
  return { id: nanoid(), type, duration_s: p.duration_s ?? 600, bpm_min: bpm.min, bpm_max: bpm.max, bpm_tolerance: 8, sync_mode: "auto" as const, valence_min: bpm.valence_min, valence_max: bpm.valence_max };
}

function parsedToItems(parsed: ParsedStep[]): SegmentItem[] {
  return parsed.map(p => {
    if (p.type === "repeat" && "children" in p) {
      const repeatCount = (p as { repeat_count: number }).repeat_count ?? 1;
      const rawChildren = (p as { children: ParsedStep[] }).children;
      // Flatten any nested repeats in template (simplified: treat nested as individual steps)
      const templateSegs = rawChildren
        .filter(c => c.type !== "repeat")
        .map(c => makeSegment(c as { type?: string; duration_s?: number }));
      if (!templateSegs.length) return makeSegment({ type: "easy", duration_s: 600 });
      const allChildren: Segment[] = [];
      for (let i = 0; i < repeatCount; i++) {
        for (const seg of templateSegs) {
          allChildren.push(i === 0 ? seg : { ...seg, id: nanoid() });
        }
      }
      return { id: nanoid(), type: "repeat" as const, repeat_count: repeatCount, template_size: templateSegs.length, children: allChildren } satisfies RepeatGroup;
    }
    return makeSegment(p as { type?: string; duration_s?: number });
  });
}

// Song generation bundling:
// - Short repeat groups (all template steps ≤120s, e.g. strides): collapse ENTIRE group
//   into ONE segment (total duration, dominant BPM) → one continuous music block
// - Long repeat groups (any template step >120s, e.g. 5×1000m): bundle BY TEMPLATE TYPE
//   across iterations → "Interval (5×)" gets one pool, "Recovery (5×)" gets another
// - Regular segments: 1-to-1 (unchanged)
// flatIndexMap[apiIdx] = flat panel indices that receive songs from that API segment.
function segsForGenerate(items: SegmentItem[]): { segments: Segment[]; flatIndexMap: number[][] } {
  const segments: Segment[] = [];
  const flatIndexMap: number[][] = [];
  let flatIdx = 0;
  for (const item of items) {
    if (item.type === "repeat") {
      const group = item as RepeatGroup;
      const template = group.children.slice(0, group.template_size);
      const allShort = template.every(s => s.duration_s <= 120);
      if (allShort) {
        // One bundle for the whole group (strides, short drills)
        const dominant = template.find(s => s.type !== "recovery" && s.type !== "rest") ?? template[0];
        const totalDuration = group.children.reduce((s, c) => s + c.duration_s, 0);
        segments.push({ ...dominant, id: nanoid(), duration_s: totalDuration });
        const indices = Array.from({ length: group.children.length }, (_, i) => flatIdx + i);
        flatIndexMap.push(indices);
        flatIdx += group.children.length;
      } else {
        // Bundle each template step type across all iterations
        // e.g. 5×[interval+recovery] → one "interval" bundle + one "recovery" bundle
        for (let t = 0; t < template.length; t++) {
          const step = template[t];
          segments.push({ ...step, id: nanoid(), duration_s: step.duration_s * group.repeat_count });
          const indices: number[] = [];
          for (let r = 0; r < group.repeat_count; r++) {
            indices.push(flatIdx + r * group.template_size + t);
          }
          flatIndexMap.push(indices);
        }
        flatIdx += group.children.length;
      }
    } else {
      segments.push(item as Segment);
      flatIndexMap.push([flatIdx]);
      flatIdx++;
    }
  }
  return { segments, flatIndexMap };
}

interface SegmentSongs { songs: SongData[]; loading?: boolean; poolCount?: number; warning?: string; }

export default function PlaylistBuilder() {
  const [items, setItems, undo, redo] = useUndoRedo<SegmentItem[]>([]);
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
  const [pumpUpModalOpen, setPumpUpModalOpen] = useState(false);
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
    if (run.type === "session") {
      const garminId = run.data?.garmin_activity_id ?? null;
      const songAssignments = run.data?.song_assignments ?? {};
      const hasAssignments = Object.keys(songAssignments).length > 0;

      if (hasAssignments && garminId) {
        // Restore session: fetch timeline segments, restore stored song assignments
        fetch(`/api/playlist/garmin-runs?id=${garminId}`)
          .then(r => r.json())
          .then(data => {
            const newItems = parsedToItems(data.segments ?? []);
            if (!newItems.length) return;
            const restoredAssignments: Record<number, SegmentSongs> = {};
            for (const [k, v] of Object.entries(songAssignments as Record<string, SongData[]>)) {
              restoredAssignments[Number(k)] = { songs: v as SongData[] };
            }
            garminActivityIdRef.current = garminId;
            setItems(newItems);
            setAssignments(restoredAssignments);
            setSessionId(run.data.id);
            setWorkoutName(data.activity_name ?? "Run");
            setHasRun(true);
          })
          .catch(() => {});
        return;
      }

      // No stored assignments or no garmin ID — re-generate
      if (!garminId) return;
      fetch(`/api/playlist/garmin-runs?id=${garminId}`)
        .then(r => r.json())
        .then(data => {
          const newItems = parsedToItems(data.segments ?? []);
          if (!newItems.length) return;
          garminActivityIdRef.current = garminId;
          setItems(newItems);
          setWorkoutName(data.activity_name ?? "Run");
          setHasRun(true);
          abortRef.current?.abort();
          abortRef.current = new AbortController();
          void generate(segsForGenerate(newItems), abortRef.current.signal);
        })
        .catch(() => {});
      return;
    }

    if (run.segments?.length > 0) {
      const newItems = parsedToItems(run.segments);
      garminActivityIdRef.current = run.type === "garmin" ? (run.data?.activity_id ?? null) : null;
      setItems(newItems);
      setWorkoutName(run.data?.activity_name ?? run.data?.name ?? "Run");
      setHasRun(true);
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      void generate(segsForGenerate(newItems), abortRef.current.signal);
    }
  }

  // Generate playlist via SSE — collapses short repeat groups via segsForGenerate
  async function generate({ segments: segs, flatIndexMap }: { segments: Segment[]; flatIndexMap: number[][] }, signal?: AbortSignal) {
    const flatCount = flatIndexMap.flat().length;
    setAssignments(Object.fromEntries(Array.from({ length: flatCount }, (_, i) => [i, { songs: [], loading: true }])));
    setSavedUrl(undefined);
    setSessionId(null);
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
              // Spread songs to all flat panel indices mapped from this API segment index
              const flatIndices = flatIndexMap[event.index] ?? [event.index];
              setAssignments(prev => {
                const next = { ...prev };
                for (const fi of flatIndices) {
                  next[fi] = { songs: event.songs, loading: false, poolCount: event.pool_count, warning: undefined };
                }
                return next;
              });
            } else if (event.type === "segment_warning") {
              const flatIndices = flatIndexMap[event.index] ?? [event.index];
              setAssignments(prev => {
                const next = { ...prev };
                for (const fi of flatIndices) {
                  next[fi] = { ...next[fi], warning: event.message };
                }
                return next;
              });
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

  // Per-segment regeneration: runs the SSE API for a single segment only.
  // Does NOT reset other assignments — only marks the targeted flat indices as loading.
  async function generateSegmentOnly(flatIdx: number, toleranceBoost = 0) {
    const { segments: allSegs, flatIndexMap } = segsForGenerate(items);
    const apiIdx = flatIndexMap.findIndex(indices => indices.includes(flatIdx));
    if (apiIdx === -1) return;

    const flatIndices = flatIndexMap[apiIdx];
    const seg = allSegs[apiIdx];
    const segWithBoost = toleranceBoost > 0
      ? { ...seg, bpm_tolerance: seg.bpm_tolerance + toleranceBoost }
      : seg;

    // Mark only the targeted flat indices as loading
    setAssignments(prev => {
      const next = { ...prev };
      for (const fi of flatIndices) {
        next[fi] = { ...next[fi], loading: true };
      }
      return next;
    });

    try {
      const ac = new AbortController();
      const res = await fetch("/api/playlist/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: [segWithBoost],
          excluded_track_ids: Array.from(excludedIds),
          genre_selection: genres,
          genre_threshold: genreThreshold,
          source_playlist_ids: sources,
          garmin_activity_id: garminActivityIdRef.current,
        }),
        signal: ac.signal,
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
              // event.index is 0 (only one segment sent) — map to the real flat indices
              setAssignments(prev => {
                const next = { ...prev };
                for (const fi of flatIndices) {
                  next[fi] = { songs: event.songs, loading: false, poolCount: event.pool_count, warning: undefined };
                }
                return next;
              });
            } else if (event.type === "segment_warning") {
              setAssignments(prev => {
                const next = { ...prev };
                for (const fi of flatIndices) {
                  next[fi] = { ...next[fi], warning: event.message };
                }
                return next;
              });
            } else if (event.type === "error") {
              console.error("Segment regeneration error:", event.message);
              setAssignments(prev => {
                const next = { ...prev };
                for (const fi of flatIndices) {
                  if (next[fi]?.loading) next[fi] = { ...next[fi], loading: false, warning: "Generation failed" };
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
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("Segment regeneration failed:", err);
      setAssignments(prev => {
        const next = { ...prev };
        for (const fi of flatIndices) {
          if (next[fi]?.loading) next[fi] = { ...next[fi], loading: false, warning: "Generation failed" };
        }
        return next;
      });
    }
  }

  function handleWidenBpm(flatIdx: number) {
    // Persist the updated bpm_tolerance in items state, then regenerate only that segment
    const flat = flatItems(items);
    const seg = flat[flatIdx];
    if (!seg) return;
    setItems(items.map(item => {
      if (item.type === "repeat") {
        const group = item as RepeatGroup;
        return { ...group, children: group.children.map(child =>
          (child as Segment).id === seg.id ? { ...child, bpm_tolerance: (child as Segment).bpm_tolerance + 15 } : child
        )};
      }
      const s = item as Segment;
      return s.id === seg.id ? { ...s, bpm_tolerance: s.bpm_tolerance + 15 } : s;
    }));
    void generateSegmentOnly(flatIdx, 15);
  }

  async function handleSave() {
    if (!sessionId) return;
    setSaving(true);
    const allTracks = [...new Set(Object.values(assignments).flatMap(a => a.songs.filter(s => !excludedIds.has(s.track_id)).map(s => s.track_id)))];
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

  async function handlePumpUp(flatIdx: number) {
    let bankSongs: { track_id: string; name: string; artist_name: string; tempo: number | null; energy: number | null }[] = [];
    try {
      const res = await fetch("/api/playlist/pump-up");
      bankSongs = await res.json();
    } catch {
      return;
    }
    if (!bankSongs.length) {
      console.warn("Pump-up bank is empty");
      return;
    }
    // Collect all currently placed track IDs across all segments
    const allPlacedIds = new Set(
      Object.values(assignments).flatMap(a => a.songs.map(s => s.track_id))
    );
    // Find first bank song not already placed and not excluded
    const song = bankSongs.find(s => !allPlacedIds.has(s.track_id) && !excludedIds.has(s.track_id));
    if (!song) {
      console.warn("Pump-up bank: all songs already placed or excluded");
      return;
    }
    // Inject pump-up song before skip song, after other placed songs
    setAssignments(prev => {
      const existing = prev[flatIdx]?.songs ?? [];
      const nonSkip = existing.filter(s => !s.is_skip);
      const skip = existing.filter(s => s.is_skip);
      const pumpSong: SongData = {
        track_id: song.track_id,
        name: song.name,
        artist_name: song.artist_name,
        tempo: song.tempo ?? 0,
        energy: song.energy ?? 0,
        duration_ms: 0,
        is_skip: false,
      };
      return { ...prev, [flatIdx]: { ...prev[flatIdx], songs: [...nonSkip, pumpSong, ...skip] } };
    });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <PlaylistTopBar sources={sources} onSourcesChange={setSources} genres={genres} onGenresChange={setGenres} genreThreshold={genreThreshold} onThresholdChange={setGenreThreshold} workoutName={workoutName} onChangeRun={() => { abortRef.current?.abort(); garminActivityIdRef.current = null; setHasRun(false); setItems([]); setAssignments({}); setWorkoutName(undefined); }} onOpenBank={() => setPumpUpModalOpen(true)} />
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
              items={items}
              onSavePlan={async (name) => {
                // Store template-only hierarchical format (strip IDs)
                function serializeItems(its: SegmentItem[]) {
                  return its.map(it => {
                    if (it.type === "repeat") {
                      const { id: _id, children, ...rest } = it;
                      return { ...rest, children: children.slice(0, it.template_size).map(({ id: _cid, ...cr }) => cr) };
                    }
                    const { id: _id, ...rest } = it as Segment;
                    return rest;
                  });
                }
                const flat = flatItems(items);
                await fetch("/api/playlist/workout-plans", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name,
                    segments: serializeItems(items),
                    sport_type: "running",
                    total_duration_s: flat.reduce((s, seg) => s + seg.duration_s, 0),
                    source: "builder",
                    garmin_activity_id: garminActivityIdRef.current,
                  }),
                });
              }}
              onChange={(newItems) => {
                setItems(newItems);
                if (flatItems(newItems).length > 0) {
                  clearTimeout(generateDebounceRef.current);
                  generateDebounceRef.current = setTimeout(() => {
                    abortRef.current?.abort();
                    abortRef.current = new AbortController();
                    void generate(segsForGenerate(newItems), abortRef.current.signal);
                  }, 600);
                }
              }}
              focusedIdx={focusedIdx}
              onFocus={(i) => setFocusedIdx(i === focusedIdx ? -1 : i)}
              onPumpUp={handlePumpUp}
            />
          )}
        </div>
        {/* Right: song assignment */}
        <div ref={rightRef} className="flex-1 overflow-y-auto">
          <SongAssignmentPanel
            items={items}
            assignments={assignments}
            excludedIds={excludedIds}
            selectedGenres={genres}
            focusedIdx={focusedIdx}
            onFocus={(i) => setFocusedIdx(i === focusedIdx ? -1 : i)}
            onExclude={handleExclude}
            onPlace={(idx, song) => setAssignments(prev => ({ ...prev, [idx]: { ...prev[idx], songs: [...(prev[idx]?.songs ?? []).filter(s => !s.is_skip), song, ...(prev[idx]?.songs ?? []).filter(s => s.is_skip)] } }))}
            onReorder={(idx, songs) => setAssignments(prev => ({ ...prev, [idx]: { ...prev[idx], songs } }))}
            onPreview={setPreviewSong}
            onPumpUp={handlePumpUp}
            onWidenBpm={handleWidenBpm}
            onAddPlaylists={(_idx) => { /* TODO: open source picker */ }}
            onSave={handleSave}
            saving={saving}
            savedUrl={savedUrl}
          />
        </div>
      </div>
      {/* Mini player */}
      <SpotifyPlayer currentSong={previewSong} />
      {/* Pump-up bank modal */}
      <PumpUpModal open={pumpUpModalOpen} onClose={() => setPumpUpModalOpen(false)} />
    </div>
  );
}
