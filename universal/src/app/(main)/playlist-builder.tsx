import { useEffect, useRef, useState, useCallback } from "react";
import { ScrollView, View, TextInput, Pressable, ActivityIndicator, Linking } from "react-native";
import { router } from "expo-router";
import { Text, Card, Button, Pill, Badge, Stepper, Modal } from "soma-style";
import {
  TYPE_COLORS, SEGMENT_TYPES, BPM_DEFAULTS, makeSegment, parsedToItems, flatItems, segsForGenerate,
  generatePlaylist, saveWorkoutPlan, fetchPumpUp, addPumpUp, removePumpUp, fetchSpotifyPlaylists,
  fetchGarminRuns, fetchGarminRunDetail, fetchGenres, postBlacklist, saveSpotifyPlaylist,
  type SegmentItem, type Segment, type SegmentType, type SongData, type SSEEvent, type GarminRunMeta, type GenreBucket, type PumpUpSong, type SpotifyPlaylistMeta,
} from "../../lib/playlist";
import { fetchJson } from "../../lib/api";
import { SpotifyEmbed } from "../../components/spotify-embed";

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

/* ---- run selector (Past Runs / Saved Plans / History / Manual — mirrors web) ---- */
type SelTab = "past" | "plans" | "history" | "manual";
interface SessionMeta { id: number; workout_name: string | null; garmin_activity_id: string | null; spotify_playlist_url: string | null; song_assignments: Record<string, unknown[]> | null; created_at: string }
const sessTrackCount = (a: Record<string, unknown[]> | null) => a ? Object.values(a).reduce((s, v) => s + (Array.isArray(v) ? v.length : 0), 0) : 0;

function RunSelector({ onPick }: { onPick: (name: string, garminId: string | null, items: SegmentItem[]) => void }) {
  const [tab, setTab] = useState<SelTab>("past");
  const [q, setQ] = useState("");
  const [runs, setRuns] = useState<GarminRunMeta[] | null>(null);
  const [plans, setPlans] = useState<WorkoutPlan[] | null>(null);
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { fetchGarminRuns(q).then((r) => alive && setRuns(r ?? [])).catch(() => alive && setRuns([])); }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);
  useEffect(() => { fetchJson<WorkoutPlan[]>("/api/playlist/workout-plans").then(setPlans).catch(() => setPlans([])); }, []);
  useEffect(() => { fetchJson<SessionMeta[]>("/api/playlist/sessions").then(setSessions).catch(() => setSessions([])); }, []);

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
  async function pickSession(s: SessionMeta) {
    if (!s.garmin_activity_id) return;
    setBusy(`s${s.id}`);
    try {
      const d = await fetchGarminRunDetail(s.garmin_activity_id);
      onPick(s.workout_name || d.activity_name || "Run", d.activity_id, parsedToItems(d.segments ?? []));
    } catch { /* ignore */ } finally { setBusy(null); }
  }

  // De-dup history like the read-only playlist screen (real, most-recent per name/day).
  const historyRows = (() => {
    const real = (sessions ?? []).filter((s) => sessTrackCount(s.song_assignments) > 0 || s.spotify_playlist_url);
    const g = new Map<string, SessionMeta>();
    for (const s of real) { const k = `${s.workout_name ?? "Run"}|${(s.created_at ?? "").slice(0, 10)}`; if (!g.has(k)) g.set(k, s); }
    return [...g.values()].sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
  })();

  const TabPill = ({ id, label, n }: { id: SelTab; label: string; n?: number }) => (
    <Pill label={n != null ? `${label} (${n})` : label} active={tab === id} onPress={() => setTab(id)} />
  );

  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-2">
        <TabPill id="past" label="Past Runs" />
        <TabPill id="plans" label="Saved Plans" n={plans?.length} />
        <TabPill id="history" label="History" n={historyRows.length || undefined} />
        <TabPill id="manual" label="Manual" />
      </View>
      {tab === "past" ? (
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
      ) : tab === "plans" ? (
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
      ) : tab === "history" ? (
        sessions == null ? <ActivityIndicator color="#77c8d1" /> : historyRows.length === 0 ? (
          <Text variant="micro" className="text-text-muted">No saved playlists yet.</Text>
        ) : historyRows.map((s) => (
          <Pressable key={s.id} onPress={() => pickSession(s)} disabled={!!busy || !s.garmin_activity_id}
            className="flex-row items-center justify-between border-b border-border-subtle py-2.5">
            <View className="flex-1 pr-2">
              <Text variant="body" className="text-text" numberOfLines={1}>{s.workout_name || "Run"}</Text>
              <Text variant="micro" className="text-text-muted tabular-nums">
                {sessTrackCount(s.song_assignments)} songs{s.spotify_playlist_url ? " · on Spotify" : ""}{s.created_at ? ` · ${new Date(s.created_at).toLocaleDateString()}` : ""}
              </Text>
            </View>
            {busy === `s${s.id}` ? <ActivityIndicator color="#77c8d1" /> : <Text variant="body" className="text-teal">›</Text>}
          </Pressable>
        ))
      ) : (
        <Text variant="micro" className="py-4 text-center text-text-muted">Manual builder — coming soon</Text>
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
/* Inline segment editor (mobile form of web SegmentEditor). */
function SegmentEditor({ seg, onChange }: { seg: Segment; onChange: (s: Segment) => void }) {
  const mins = Math.floor(seg.duration_s / 60);
  const secs = seg.duration_s % 60;
  const setType = (t: SegmentType) => { const b = BPM_DEFAULTS[t]; onChange({ ...seg, type: t, bpm_min: b.min, bpm_max: b.max, valence_min: b.valence_min, valence_max: b.valence_max }); };
  return (
    <View className="gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-3">
      <View className="gap-1">
        <Text variant="eyebrow">Type</Text>
        <View className="flex-row flex-wrap gap-1.5">
          {SEGMENT_TYPES.map((t) => <Pill key={t} label={cap(t)} active={seg.type === t} onPress={() => setType(t)} />)}
        </View>
      </View>
      <View className="flex-row gap-4">
        <View className="gap-1"><Text variant="eyebrow">Min</Text><Stepper value={mins} onChange={(m) => onChange({ ...seg, duration_s: m * 60 + secs })} step={1} min={0} max={180} /></View>
        <View className="gap-1"><Text variant="eyebrow">Sec</Text><Stepper value={secs} onChange={(s) => onChange({ ...seg, duration_s: mins * 60 + s })} step={5} min={0} max={59} /></View>
      </View>
      <View className="flex-row gap-3">
        <View className="gap-1"><Text variant="eyebrow">BPM min</Text><Stepper value={seg.bpm_min} onChange={(v) => onChange({ ...seg, bpm_min: v })} step={1} min={40} max={220} /></View>
        <View className="gap-1"><Text variant="eyebrow">BPM max</Text><Stepper value={seg.bpm_max} onChange={(v) => onChange({ ...seg, bpm_max: v })} step={1} min={40} max={220} /></View>
      </View>
      <View className="flex-row items-center gap-3">
        <View className="gap-1"><Text variant="eyebrow">Tolerance ±</Text><Stepper value={seg.bpm_tolerance} onChange={(v) => onChange({ ...seg, bpm_tolerance: v })} step={1} min={0} max={30} /></View>
      </View>
      <View className="gap-1">
        <View className="flex-row justify-between"><Text variant="eyebrow">Valence (mood)</Text><Text variant="micro" className="text-text-muted tabular-nums">{seg.valence_min.toFixed(1)} – {seg.valence_max.toFixed(1)}</Text></View>
        <View className="flex-row gap-3">
          <Stepper value={Math.round(seg.valence_min * 10)} onChange={(v) => onChange({ ...seg, valence_min: Math.min(v / 10, seg.valence_max) })} step={1} min={0} max={10} />
          <Stepper value={Math.round(seg.valence_max * 10)} onChange={(v) => onChange({ ...seg, valence_max: Math.max(v / 10, seg.valence_min) })} step={1} min={0} max={10} />
        </View>
      </View>
      <View className="gap-1">
        <Text variant="eyebrow">Sync mode</Text>
        <View className="flex-row gap-1.5">
          {(["auto", "sync", "async"] as const).map((m) => <Pill key={m} label={m} active={seg.sync_mode === m} onPress={() => onChange({ ...seg, sync_mode: m })} />)}
        </View>
      </View>
    </View>
  );
}

function SegmentCard({ seg, index, panel, onExclude, onWiden, onEdit, onRemove, onMove, canUp, canDown, onPreview, onBank }: {
  seg: Segment; index: number; panel: PanelState | undefined; onExclude: (t: SongData) => void; onWiden: () => void;
  onEdit: (s: Segment) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void; canUp: boolean; canDown: boolean;
  onPreview: (s: SongData) => void; onBank: (s: SongData) => void;
}) {
  const color = TYPE_COLORS[seg.type] ?? "#77c8d1";
  const [editing, setEditing] = useState(false);
  const songs = (panel?.songs ?? []).filter((s) => !s.is_skip);
  const skip = (panel?.songs ?? []).find((s) => s.is_skip);
  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between">
        <Pressable onPress={() => setEditing((e) => !e)} className="flex-1 flex-row items-center gap-2">
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
          <Text variant="body" className="text-text">{index + 1}. {cap(seg.type)}</Text>
          <Text variant="micro" className="text-teal">{editing ? "▾" : "✎"}</Text>
        </Pressable>
        <View className="flex-row items-center gap-2">
          <Text variant="micro" className="text-text-muted tabular-nums">{mmss(seg.duration_s)} · {seg.bpm_min}–{seg.bpm_max}</Text>
          <Pressable onPress={() => onMove(-1)} disabled={!canUp} hitSlop={6}><Text variant="caption" className={canUp ? "text-text-muted" : "text-border-subtle"}>↑</Text></Pressable>
          <Pressable onPress={() => onMove(1)} disabled={!canDown} hitSlop={6}><Text variant="caption" className={canDown ? "text-text-muted" : "text-border-subtle"}>↓</Text></Pressable>
          <Pressable onPress={onRemove} hitSlop={6}><Text variant="caption" className="text-text-muted">🗑</Text></Pressable>
        </View>
      </View>
      {editing ? <SegmentEditor seg={seg} onChange={onEdit} /> : null}
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
              <Pressable className="flex-1" onPress={() => onPreview(s)}>
                <Text variant="caption" className="text-text" numberOfLines={1}>{s.name}</Text>
                <Text variant="micro" className="text-text-muted" numberOfLines={1}>
                  {s.artist_name}{s.tempo ? ` · ${Math.round(s.tempo)} bpm` : ""}{s.is_half_time ? " ·½" : ""} · {songDur(s.duration_ms)}
                </Text>
              </Pressable>
              <Pressable onPress={() => onBank(s)} hitSlop={8} className="h-6 w-6 items-center justify-center rounded-md active:bg-surface-elevated">
                <Text variant="micro" style={{ color: "#e0c458" }}>⚡</Text>
              </Pressable>
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

/* Sources picker modal (mirrors web playlist-source-picker.tsx: Liked + playlists, searchable). */
function SourcesModal({ visible, onClose, selected, onChange }: { visible: boolean; onClose: () => void; selected: string[]; onChange: (v: string[]) => void }) {
  const [playlists, setPlaylists] = useState<SpotifyPlaylistMeta[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { if (visible && playlists == null) fetchSpotifyPlaylists().then(setPlaylists).catch(() => setPlaylists([])); }, [visible, playlists]);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  const all: { id: string; name: string; tracks?: number }[] = [{ id: "liked", name: "Liked Songs" }, ...(playlists ?? [])];
  const ql = q.trim().toLowerCase();
  const list = ql ? all.filter((s) => s.name.toLowerCase().includes(ql)) : all;
  return (
    <Modal visible={visible} onClose={onClose} title="Sources">
      <Text variant="micro" className="mb-2 text-text-muted">{selected.length} selected · songs are matched from these.</Text>
      <TextInput value={q} onChangeText={setQ} placeholder="Search sources…" placeholderTextColor="#6f8695"
        className="mb-2 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2" style={{ color: "#e6f0f4" }} />
      {playlists == null ? <ActivityIndicator color="#77c8d1" /> : (
        <ScrollView style={{ maxHeight: 360 }}>
          <View className="flex-row flex-wrap gap-2">
            {list.map((s) => <Pill key={s.id} label={s.tracks != null ? `${s.name} (${s.tracks})` : s.name} active={selected.includes(s.id)} onPress={() => toggle(s.id)} />)}
          </View>
        </ScrollView>
      )}
    </Modal>
  );
}

/* Pump-up Bank modal (mirrors web pump-up-modal.tsx). */
function BankModal({ visible, onClose, refreshKey }: { visible: boolean; onClose: () => void; refreshKey: number }) {
  const [songs, setSongs] = useState<PumpUpSong[] | null>(null);
  useEffect(() => { if (!visible) return; setSongs(null); fetchPumpUp().then(setSongs).catch(() => setSongs([])); }, [visible, refreshKey]);
  async function remove(id: string) { setSongs((p) => (p ? p.filter((s) => s.track_id !== id) : p)); await removePumpUp(id); }
  return (
    <Modal visible={visible} onClose={onClose} title="⚡ Pump-up Bank">
      <Text variant="micro" className="mb-2 text-text-muted tabular-nums">{songs?.length ?? 0}/10 songs</Text>
      {songs == null ? <ActivityIndicator color="#77c8d1" /> : songs.length === 0 ? (
        <Text variant="micro" className="py-6 text-center text-text-muted">Bank empty — add songs with ⚡ on any song.</Text>
      ) : songs.map((s) => (
        <View key={s.track_id} className="flex-row items-center gap-2 border-t border-border-subtle py-2">
          <View className="flex-1">
            <Text variant="caption" className="text-text" numberOfLines={1}>{s.name}</Text>
            <Text variant="micro" className="text-text-muted" numberOfLines={1}>{s.artist_name}</Text>
          </View>
          {s.tempo != null ? <Text variant="micro" className="text-text-muted tabular-nums">{Math.round(s.tempo)} BPM</Text> : null}
          <View style={{ width: 56, height: 6, borderRadius: 3, backgroundColor: "#22323a", overflow: "hidden" }}>
            <View style={{ width: `${Math.round((s.energy ?? 0) * 100)}%`, height: "100%", backgroundColor: "#e0c458" }} />
          </View>
          <Pressable onPress={() => remove(s.track_id)} hitSlop={8}><Text variant="micro" className="text-text-muted">✕</Text></Pressable>
        </View>
      ))}
    </Modal>
  );
}

export default function PlaylistBuilderScreen() {
  const [items, setItems] = useState<SegmentItem[] | null>(null);
  const [workoutName, setWorkoutName] = useState("Run");
  const [garminId, setGarminId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Record<number, PanelState>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [genres, setGenres] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>(["liked"]);
  const sourcesRef = useRef<string[]>(["liked"]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  useEffect(() => { sourcesRef.current = sources; }, [sources]);
  const [sessionId, setSessionId] = useState<string | number | null>(null);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [spotifyPlaylistId, setSpotifyPlaylistId] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [planInput, setPlanInput] = useState(false);
  const [planName, setPlanName] = useState("");
  const [planSaving, setPlanSaving] = useState(false);
  const [planSaved, setPlanSaved] = useState(false);
  const [previewSong, setPreviewSong] = useState<SongData | null>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const [bankRefresh, setBankRefresh] = useState(0);
  const [bankToast, setBankToast] = useState<string | null>(null);
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
      excluded_track_ids: [...excl], genre_selection: gsel, genre_threshold: 0.03, source_playlist_ids: sourcesRef.current, garmin_activity_id: gid,
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
    // Flatten repeat groups into individual segments so the timeline is fully editable.
    const flatIts: SegmentItem[] = flatItems(its);
    setWorkoutName(name); setGarminId(gid); setItems(flatIts); setAssignments({}); setSessionId(null); setExcluded(new Set()); setGenres([]);
    setSavedUrl(null); setSpotifyPlaylistId(null); setSaveErr(null); setDirty(false);
    runGenerate(flatIts, [], new Set(), gid);
  }

  /* ---- editable timeline ---- */
  function editSeg(i: number, s: Segment) { setItems((prev) => (prev ? prev.map((x, idx) => (idx === i ? s : x)) : prev)); setDirty(true); }
  function removeSeg(i: number) { setItems((prev) => (prev ? prev.filter((_, idx) => idx !== i) : prev)); setAssignments({}); setSessionId(null); setDirty(true); }
  function moveSeg(i: number, dir: -1 | 1) {
    const j = i + dir;
    setItems((prev) => { if (!prev || j < 0 || j >= prev.length) return prev; const n = [...prev]; [n[i], n[j]] = [n[j], n[i]]; return n; });
    setAssignments({}); setSessionId(null); setDirty(true);
  }
  function addSeg() { setItems((prev) => [...(prev ?? []), makeSegment({ type: "easy", duration_s: 600 })]); setDirty(true); }
  function regenerate() { if (items) { runGenerate(items, genres, excluded, garminId); setDirty(false); } }
  async function bankSong(s: SongData) {
    const r = await addPumpUp({ track_id: s.track_id, name: s.name, artist_name: s.artist_name, tempo: s.tempo, energy: s.energy });
    setBankRefresh((k) => k + 1);
    setBankToast(r.ok ? `Added “${s.name}” to the bank` : r.error || "Couldn't add to bank");
    setTimeout(() => setBankToast(null), 2500);
  }
  async function savePlan() {
    const name = planName.trim();
    if (!name || !items) return;
    setPlanSaving(true);
    const ok = await saveWorkoutPlan(name, items, garminId);
    setPlanSaving(false);
    if (ok) { setPlanInput(false); setPlanName(""); setPlanSaved(true); setTimeout(() => setPlanSaved(false), 2000); }
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
  const totalSkip = Object.values(assignments).reduce((s, p) => s + (p.songs?.filter((x) => x.is_skip).length ?? 0), 0);

  return (
    <ScrollView className="flex-1 bg-base" contentContainerClassName="items-center px-5 py-6">
      <View className="w-full max-w-2xl gap-4">
        <View className="flex-row items-center justify-between">
          <Text variant="headline">{items ? workoutName : "New playlist"}</Text>
          <View className="flex-row items-center gap-3">
            {items ? <Pressable onPress={() => setSourcesOpen(true)}><Text variant="caption" className="text-teal">Sources ({sources.length})</Text></Pressable> : null}
            {items ? <Pressable onPress={() => setBankOpen(true)}><Text variant="caption" style={{ color: "#e0c458" }}>⚡ Bank</Text></Pressable> : null}
            <Pressable onPress={() => (items ? (abortRef.current?.abort(), setItems(null), setAssignments({}), setSessionId(null)) : router.back())}>
              <Text variant="caption" className="text-teal">{items ? "Change run" : "Close"}</Text>
            </Pressable>
          </View>
        </View>
        <SourcesModal visible={sourcesOpen} onClose={() => setSourcesOpen(false)} selected={sources} onChange={setSources} />
        <BankModal visible={bankOpen} onClose={() => setBankOpen(false)} refreshKey={bankRefresh} />
        {bankToast ? <Card className="border-teal-dim"><Text variant="micro" className="text-teal">{bankToast}</Text></Card> : null}

        {!items ? (
          <>
            <Text variant="caption" className="text-text-secondary">Pick a run or plan — songs are BPM-matched to each segment.</Text>
            <Card><RunSelector onPick={onPick} /></Card>
          </>
        ) : (
          <>
            <View className="flex-row items-center gap-2">
              <Text variant="micro" className="text-text-muted tabular-nums">{flat.length} segments · {totalSongs} songs · {totalSkip} skip songs</Text>
              {sessionId && !dirty ? <Badge label="Generated" tone="success" /> : null}
              {dirty ? <Badge label="Edited" tone="warm" /> : null}
            </View>
            {genErr ? <Card><Text variant="micro" className="text-danger">Generation error: {genErr}</Text></Card> : null}
            {dirty ? <Button label="Regenerate playlist" variant="primary" onPress={regenerate} /> : null}
            <GenreBar selected={genres} onToggle={toggleGenre} />
            {flat.map((seg, i) => (
              <SegmentCard key={seg.id} seg={seg} index={i} panel={assignments[i]} onExclude={exclude} onWiden={() => widen(i)}
                onEdit={(s) => editSeg(i, s)} onRemove={() => removeSeg(i)} onMove={(d) => moveSeg(i, d)} canUp={i > 0} canDown={i < flat.length - 1}
                onPreview={setPreviewSong} onBank={bankSong} />
            ))}
            {/* Timeline footer: add / save-plan / total */}
            <Card className="gap-2">
              <View className="flex-row items-center justify-between">
                <Button label="+ Add segment" variant="secondary" onPress={addSeg} />
                <Text variant="micro" className="text-text-muted tabular-nums">Total: {Math.round(flat.reduce((s, x) => s + x.duration_s, 0) / 60)} min</Text>
              </View>
              {planInput ? (
                <View className="flex-row items-center gap-2">
                  <TextInput value={planName} onChangeText={setPlanName} placeholder="Plan name…" placeholderTextColor="#6f8695"
                    className="flex-1 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2" style={{ color: "#e6f0f4" }} />
                  <Button label={planSaving ? "Saving…" : "Save"} variant="primary" disabled={!planName.trim() || planSaving} onPress={savePlan} />
                  <Pressable onPress={() => { setPlanInput(false); setPlanName(""); }}><Text variant="caption" className="text-text-muted">Cancel</Text></Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setPlanInput(true)} className="self-start"><Text variant="caption" className="text-teal">{planSaved ? "✓ Saved!" : "＋ Save as plan"}</Text></Pressable>
              )}
            </Card>
            {/* Preview player (tap any song) — Spotify embed, mirrors web SpotifyPlayer */}
            <Card className="gap-2">
              {previewSong ? (
                <>
                  <View className="flex-row items-center justify-between">
                    <Text variant="eyebrow">Preview</Text>
                    <Pressable onPress={() => setPreviewSong(null)} hitSlop={8}><Text variant="micro" className="text-text-muted">✕ close</Text></Pressable>
                  </View>
                  <SpotifyEmbed key={previewSong.track_id} trackId={previewSong.track_id} />
                </>
              ) : (
                <Text variant="micro" className="text-center text-text-muted">Tap a song to preview it.</Text>
              )}
            </Card>
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
