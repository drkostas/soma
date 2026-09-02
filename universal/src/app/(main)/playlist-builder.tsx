import { useEffect, useRef, useState, useCallback } from "react";
import { ScrollView, View, TextInput, Pressable, ActivityIndicator, Linking } from "react-native";
import { router } from "expo-router";
import { Text, Card, Button, Pill, Badge } from "soma-style";
import {
  TYPE_COLORS, parsedToItems, flatItems, segsForGenerate, generatePlaylist,
  fetchGarminRuns, fetchGarminRunDetail, fetchGenres, postBlacklist, saveSpotifyPlaylist,
  type SegmentItem, type Segment, type SongData, type SSEEvent, type GarminRunMeta, type GenreBucket,
} from "../../lib/playlist";
import { fetchJson } from "../../lib/api";

interface PanelState { songs: SongData[]; loading?: boolean; poolCount?: number; warning?: string }
type WorkoutPlan = { id: number; name: string; sport_type: string | null; total_duration_s: number | null; source: string | null };

function mmss(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}
function songDur(ms: number): string {
  const t = Math.round(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---- run selector (Past runs / Saved plans) ---- */
function RunSelector({ onPick }: { onPick: (name: string, garminId: string | null, items: SegmentItem[]) => void }) {
  const [tab, setTab] = useState<"runs" | "plans">("runs");
  const [q, setQ] = useState("");
  const [runs, setRuns] = useState<GarminRunMeta[] | null>(null);
  const [plans, setPlans] = useState<WorkoutPlan[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { fetchGarminRuns(q).then((r) => alive && setRuns(r ?? [])).catch(() => alive && setRuns([])); }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);
  useEffect(() => { fetchJson<WorkoutPlan[]>("/api/playlist/workout-plans").then(setPlans).catch(() => setPlans([])); }, []);

  async function pickRun(r: GarminRunMeta) {
    setBusy(r.activity_id);
    try {
      const d = await fetchGarminRunDetail(r.activity_id);
      onPick(d.activity_name || r.activity_name || "Run", d.activity_id, parsedToItems(d.segments ?? []));
    } catch { /* ignore */ } finally { setBusy(null); }
  }
  async function pickPlan(p: WorkoutPlan) {
    setBusy(`p${p.id}`);
    try {
      const d = await fetchJson<{ segments?: unknown[] }>(`/api/playlist/workout-plans/${p.id}`);
      onPick(p.name, null, parsedToItems((d.segments as never[]) ?? []));
    } catch { /* ignore */ } finally { setBusy(null); }
  }

  return (
    <View className="gap-3">
      <View className="flex-row gap-2">
        <Pill label="Past runs" active={tab === "runs"} onPress={() => setTab("runs")} />
        <Pill label="Saved plans" active={tab === "plans"} onPress={() => setTab("plans")} />
      </View>
      {tab === "runs" ? (
        <>
          <TextInput value={q} onChangeText={setQ} placeholder="Search runs…" placeholderTextColor="#6f8695"
            className="rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-text" style={{ color: "#e6f0f4" }} />
          {runs == null ? <ActivityIndicator color="#77c8d1" /> : runs.length === 0 ? (
            <Text variant="micro" className="text-text-muted">No runs found.</Text>
          ) : runs.map((r) => (
            <Pressable key={r.activity_id} onPress={() => pickRun(r)} disabled={!!busy}
              className="flex-row items-center justify-between border-b border-border-subtle py-2.5">
              <View className="flex-1 pr-2">
                <Text variant="body" className="text-text" numberOfLines={1}>{r.activity_name || "Run"}</Text>
                <Text variant="micro" className="text-text-muted tabular-nums">
                  {r.distance ? `${(Number(r.distance) / 1000).toFixed(1)} km` : ""}{r.duration ? ` · ${Math.round(Number(r.duration) / 60)} min` : ""}
                  {r.start_time ? ` · ${new Date(r.start_time).toLocaleDateString()}` : ""}
                </Text>
              </View>
              {busy === r.activity_id ? <ActivityIndicator color="#77c8d1" /> : <Text variant="body" className="text-teal">›</Text>}
            </Pressable>
          ))}
        </>
      ) : (
        plans == null ? <ActivityIndicator color="#77c8d1" /> : plans.length === 0 ? (
          <Text variant="micro" className="text-text-muted">No saved plans.</Text>
        ) : plans.map((p) => (
          <Pressable key={p.id} onPress={() => pickPlan(p)} disabled={!!busy}
            className="flex-row items-center justify-between border-b border-border-subtle py-2.5">
            <View className="flex-1 pr-2">
              <Text variant="body" className="text-text" numberOfLines={1}>{p.name}</Text>
              <Text variant="micro" className="text-text-muted uppercase">{p.sport_type ?? "running"}</Text>
            </View>
            {busy === `p${p.id}` ? <ActivityIndicator color="#77c8d1" /> : <Text variant="body" className="text-teal">›</Text>}
          </Pressable>
        ))
      )}
    </View>
  );
}

/* ---- genre filter bar ---- */
function GenreBar({ selected, onToggle }: { selected: string[]; onToggle: (g: string) => void }) {
  const [buckets, setBuckets] = useState<{ genre: string; pct: number }[] | null>(null);
  useEffect(() => {
    fetchGenres().then(({ genres, total }) => {
      const t = Number(total) || 1;
      setBuckets((genres ?? []).map((g: GenreBucket) => ({ genre: g.genre, pct: (Number(g.count) || 0) / t })).filter((g) => g.pct >= 0.03));
    }).catch(() => setBuckets([]));
  }, []);
  if (!buckets || buckets.length === 0) return null;
  return (
    <Card className="gap-2">
      <Text variant="eyebrow">Genres {selected.length ? `· ${selected.length} on` : "· all"}</Text>
      <View className="flex-row flex-wrap gap-2">
        {buckets.map((b) => <Pill key={b.genre} label={b.genre} active={selected.includes(b.genre)} onPress={() => onToggle(b.genre)} />)}
      </View>
      <Text variant="micro" className="text-text-muted">Tap to limit picks to those genres. None selected = all.</Text>
    </Card>
  );
}

/* ---- one segment's songs ---- */
function SegmentCard({ seg, index, panel, onExclude, onWiden }: {
  seg: Segment; index: number; panel: PanelState | undefined; onExclude: (t: SongData) => void; onWiden: () => void;
}) {
  const color = TYPE_COLORS[seg.type] ?? "#77c8d1";
  const songs = (panel?.songs ?? []).filter((s) => !s.is_skip);
  const skip = (panel?.songs ?? []).find((s) => s.is_skip);
  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
          <Text variant="body" className="text-text">{index + 1}. {cap(seg.type)}</Text>
        </View>
        <Text variant="micro" className="text-text-muted tabular-nums">{mmss(seg.duration_s)} · {seg.bpm_min}–{seg.bpm_max} bpm</Text>
      </View>
      {!panel?.loading && panel?.poolCount != null ? (
        <Text variant="micro" className="text-text-muted tabular-nums">{songs.length} of {panel.poolCount} matching in pool</Text>
      ) : null}
      {panel?.loading ? (
        <View className="flex-row items-center gap-2 py-2"><ActivityIndicator color={color} /><Text variant="micro" className="text-text-muted">Matching songs…</Text></View>
      ) : (
        <>
          {panel?.warning ? <Text variant="micro" style={{ color: "#e0a458" }}>{panel.warning}</Text> : null}
          {songs.map((s, i) => (
            <View key={`${s.track_id}-${i}`} className="flex-row items-center gap-2 border-t border-border-subtle py-1.5">
              <View className="flex-1">
                <Text variant="caption" className="text-text" numberOfLines={1}>{s.name}</Text>
                <Text variant="micro" className="text-text-muted" numberOfLines={1}>
                  {s.artist_name}{s.tempo ? ` · ${Math.round(s.tempo)} bpm` : ""}{s.is_half_time ? " ·½" : ""} · {songDur(s.duration_ms)}
                </Text>
              </View>
              <Pressable onPress={() => onExclude(s)} hitSlop={8} className="h-6 w-6 items-center justify-center rounded-md active:bg-surface-elevated">
                <Text variant="micro" className="text-text-muted">✕</Text>
              </Pressable>
            </View>
          ))}
          {skip ? <Text variant="micro" className="text-text-muted">↪ transition: {skip.name} · {skip.artist_name}</Text> : null}
          {songs.length === 0 && !panel?.loading ? <Text variant="micro" className="text-text-muted">No songs — try widening the BPM or clearing genres.</Text> : null}
          <Pressable onPress={onWiden} className="self-start pt-1"><Text variant="micro" className="text-teal">Widen BPM (+15)</Text></Pressable>
        </>
      )}
    </Card>
  );
}

export default function PlaylistBuilderScreen() {
  const [items, setItems] = useState<SegmentItem[] | null>(null);
  const [workoutName, setWorkoutName] = useState("Run");
  const [garminId, setGarminId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Record<number, PanelState>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [genres, setGenres] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | number | null>(null);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [spotifyPlaylistId, setSpotifyPlaylistId] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const flat = items ? flatItems(items) : [];

  // Always regenerate ALL segments (matching the web builder, whose POST creates
  // one session per generate). segsForGenerate bundles repeat groups; flatIndexMap
  // fans each API segment's result back onto every flat panel it covers.
  const runGenerate = useCallback((its: SegmentItem[], gsel: string[], excl: Set<string>, gid: string | null) => {
    const { segments, flatIndexMap } = segsForGenerate(its);
    const remap = (apiIdx: number) => flatIndexMap[apiIdx] ?? [apiIdx];
    setAssignments((prev) => {
      const next = { ...prev };
      segments.forEach((_, api) => { for (const fi of remap(api)) next[fi] = { songs: next[fi]?.songs ?? [], loading: true }; });
      return next;
    });
    setGenErr(null);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const body = {
      segments: segments.map((s) => ({ type: s.type, duration_s: s.duration_s, bpm_min: s.bpm_min, bpm_max: s.bpm_max, bpm_tolerance: s.bpm_tolerance, valence_min: s.valence_min, valence_max: s.valence_max })),
      excluded_track_ids: [...excl], genre_selection: gsel, genre_threshold: 0.03, source_playlist_ids: [], garmin_activity_id: gid,
    };
    generatePlaylist(body, (e: SSEEvent) => {
      if (e.type === "segment_done") {
        // Spread the existing panel so a segment_warning that arrived first isn't wiped.
        setAssignments((prev) => { const n = { ...prev }; for (const fi of remap(e.index)) n[fi] = { ...n[fi], songs: e.songs, loading: false, poolCount: e.pool_count }; return n; });
      } else if (e.type === "segment_warning") {
        setAssignments((prev) => { const n = { ...prev }; for (const fi of remap(e.index)) n[fi] = { ...n[fi], loading: false, warning: e.message }; return n; });
      } else if (e.type === "done") {
        setSessionId(e.session_id);
      } else if (e.type === "error") {
        setGenErr(e.message);
        setAssignments((prev) => { const n = { ...prev }; for (const k in n) if (n[k].loading) n[k] = { ...n[k], loading: false }; return n; });
      }
    }, ac.signal).catch((err) => { if (!ac.signal.aborted) { setGenErr(String(err?.message ?? err)); setAssignments((prev) => { const n = { ...prev }; for (const k in n) if (n[k].loading) n[k] = { ...n[k], loading: false }; return n; }); } });
  }, []);

  function onPick(name: string, gid: string | null, its: SegmentItem[]) {
    setWorkoutName(name); setGarminId(gid); setItems(its); setAssignments({}); setSessionId(null); setExcluded(new Set()); setGenres([]);
    setSavedUrl(null); setSpotifyPlaylistId(null); setSaveErr(null);
    runGenerate(its, [], new Set(), gid);
  }

  // Save the generated session to Spotify (POST create, or PUT update if already saved).
  // track_ids = unique non-excluded songs across all segments (incl. transitions), matching web.
  async function saveToSpotify() {
    if (sessionId == null) return;
    setSaving(true); setSaveErr(null);
    const track_ids = [...new Set(Object.values(assignments).flatMap((p) => p.songs.filter((s) => !excluded.has(s.track_id)).map((s) => s.track_id)))];
    const song_assignments: Record<number, SongData[]> = {};
    for (const k in assignments) song_assignments[Number(k)] = assignments[k].songs;
    const r = await saveSpotifyPlaylist({
      session_id: sessionId,
      name: `Soma: ${workoutName} · ${new Date().toLocaleDateString()}`,
      track_ids, song_assignments, playlist_id: spotifyPlaylistId,
    });
    setSaving(false);
    if (r.ok) {
      setSavedUrl(r.playlist_url ?? null);
      if (r.playlist_id) setSpotifyPlaylistId(r.playlist_id);
    } else if (r.status === 401) {
      setSaveErr("Spotify isn't connected. Connect it on the web app (Sources) to save playlists.");
    } else {
      setSaveErr(r.error || `Save failed (${r.status})`);
    }
  }
  function toggleGenre(g: string) {
    const next = genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g];
    setGenres(next);
    if (items) runGenerate(items, next, excluded, garminId);
  }
  function exclude(t: SongData) {
    const next = new Set(excluded); next.add(t.track_id); setExcluded(next);
    setAssignments((prev) => { const n = { ...prev }; for (const k in n) n[k] = { ...n[k], songs: n[k].songs.filter((s) => s.track_id !== t.track_id) }; return n; });
    void postBlacklist(t.track_id);
  }
  // Widen a segment: bump its BPM tolerance (+15, cap 30) on the item itself, then regenerate.
  function widen(flatIdx: number) {
    if (!items) return;
    const target = flat[flatIdx];
    if (!target) return;
    const newTol = Math.min(30, (target.bpm_tolerance ?? 8) + 15);
    const bump = (s: Segment) => (s.id === target.id ? { ...s, bpm_tolerance: newTol } : s);
    const nextItems: SegmentItem[] = items.map((it) =>
      it.type === "repeat" ? { ...it, children: it.children.map(bump) } : bump(it as Segment),
    );
    setItems(nextItems);
    runGenerate(nextItems, genres, excluded, garminId);
  }

  useEffect(() => () => abortRef.current?.abort(), []);

  const totalSongs = Object.values(assignments).reduce((s, p) => s + (p.songs?.filter((x) => !x.is_skip).length ?? 0), 0);

  return (
    <ScrollView className="flex-1 bg-base" contentContainerClassName="items-center px-5 py-6">
      <View className="w-full max-w-2xl gap-4">
        <View className="flex-row items-center justify-between">
          <Text variant="headline">{items ? workoutName : "New playlist"}</Text>
          <Pressable onPress={() => (items ? (abortRef.current?.abort(), setItems(null), setAssignments({}), setSessionId(null)) : router.back())}>
            <Text variant="caption" className="text-teal">{items ? "Change run" : "Close"}</Text>
          </Pressable>
        </View>

        {!items ? (
          <>
            <Text variant="caption" className="text-text-secondary">Pick a run or plan — songs are BPM-matched to each segment.</Text>
            <Card><RunSelector onPick={onPick} /></Card>
          </>
        ) : (
          <>
            <View className="flex-row items-center gap-2">
              <Text variant="micro" className="text-text-muted tabular-nums">{flat.length} segments · {totalSongs} songs</Text>
              {sessionId ? <Badge label="Generated" tone="success" /> : null}
            </View>
            {genErr ? <Card><Text variant="micro" className="text-danger">Generation error: {genErr}</Text></Card> : null}
            <GenreBar selected={genres} onToggle={toggleGenre} />
            {flat.map((seg, i) => (
              <SegmentCard key={seg.id} seg={seg} index={i} panel={assignments[i]} onExclude={exclude} onWiden={() => widen(i)} />
            ))}
            <Card className="gap-2">
              {savedUrl ? (
                <>
                  <View className="flex-row items-center gap-2">
                    <Badge label="On Spotify" tone="success" />
                    <Text variant="caption" className="text-text-secondary">Saved to your Spotify.</Text>
                  </View>
                  <Button label="Open in Spotify" variant="secondary" onPress={() => Linking.openURL(savedUrl)} />
                  <Button label={saving ? "Updating…" : "Update on Spotify"} variant="ghost" disabled={saving} onPress={saveToSpotify} />
                </>
              ) : (
                <Button label={saving ? "Saving…" : "Save to Spotify"} variant="primary" disabled={saving || sessionId == null} onPress={saveToSpotify} />
              )}
              {saveErr ? <Text variant="micro" className="text-danger">{saveErr}</Text> : null}
              {sessionId == null && !savedUrl ? <Text variant="micro" className="text-text-muted">Songs are still loading — save once generation completes.</Text> : null}
            </Card>
          </>
        )}
      </View>
    </ScrollView>
  );
}
