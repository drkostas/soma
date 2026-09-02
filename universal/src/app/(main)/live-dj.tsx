import { useEffect, useRef, useState, useCallback } from "react";
import { ScrollView, View, Pressable } from "react-native";
import { router } from "expo-router";
import { Text, Card, Button, Pill, Stepper } from "soma-style";
import {
  fetchDjStatus, fetchDjHrDefaults, startDj, stopDj, fetchGenres, fetchSpotifyPlaylists,
  type DjStatus, type DjStartBody, type GenreBucket, type SpotifyPlaylistMeta,
} from "../../lib/playlist";

/* Offset modes — verbatim from web live-dj-tab.tsx. */
type OffsetMode = "pump_up" | "normal" | "wind_down";
const DEFAULT_OFFSETS: Record<OffsetMode, number> = { pump_up: 12, normal: 0, wind_down: -12 };
const OFFSET_ICONS: Record<OffsetMode, string> = { pump_up: "⬆", normal: "●", wind_down: "⬇" };
const OFFSET_NAMES: Record<OffsetMode, string> = { pump_up: "Pump up", normal: "Normal", wind_down: "Wind down" };
const OFFSET_RANGE: Record<OffsetMode, [number, number]> = { pump_up: [0, 30], normal: [-15, 15], wind_down: [-30, 0] };
type SourceMode = "auto" | "manual";

function msToMinSec(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
function hrAgeLabel(sec: number): string {
  if (sec < 120) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago — stale`;
}
const formatReason = (r: string) => r.replace(/_/g, " ");

export default function LiveDjScreen() {
  const [hrRest, setHrRest] = useState(60);
  const [hrMax, setHrMax] = useState(190);
  const [hrFromGarmin, setHrFromGarmin] = useState(false);
  const [offsetMode, setOffsetMode] = useState<OffsetMode>("normal");
  const [offsetValues, setOffsetValues] = useState<Record<OffsetMode, number>>({ ...DEFAULT_OFFSETS });
  const [sourceMode, setSourceMode] = useState<SourceMode>("auto");
  const [sources, setSources] = useState<string[]>(["liked"]);
  const [genres, setGenres] = useState<string[]>([]);
  const [status, setStatus] = useState<DjStatus>({ state: "stopped" });
  const [busy, setBusy] = useState(false);
  const [ctrlErr, setCtrlErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  const [, setTick] = useState(0);

  const isRunning = status.state === "running";
  const isLive = status.state !== "stopped";

  const poll = useCallback(async () => {
    try {
      const s = await fetchDjStatus();
      setStatus(s);
      if (s.state === "running" || s.state === "starting") { if (sessionStartRef.current === null) sessionStartRef.current = Date.now(); }
      else sessionStartRef.current = null;
      if (s.state === "stopped" && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    } catch { /* keep last */ }
  }, []);
  const startPolling = useCallback(() => { if (!pollRef.current) pollRef.current = setInterval(poll, 5000); }, [poll]);

  useEffect(() => {
    fetchDjHrDefaults().then((d) => {
      if (d.hr_rest) setHrRest(d.hr_rest);
      if (d.hr_max) setHrMax(d.hr_max);
      if (d.hr_rest || d.hr_max) setHrFromGarmin(true);
    }).catch(() => {});
    fetchDjStatus().then((s) => { setStatus(s); if (s.state === "running" || s.state === "starting") startPolling(); }).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [startPolling]);

  // 1s ticker while live — animates "Session:", "polled Ns ago", and the countdown.
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  async function onStart() {
    setBusy(true); setCtrlErr(null);
    const body: DjStartBody = {
      hr_rest: hrRest, hr_max: hrMax, offset: offsetValues[offsetMode],
      genres: sourceMode === "auto" ? [] : genres,
      sources: sourceMode === "auto" ? ["auto"] : sources,
    };
    const r = await startDj(body);
    setBusy(false);
    if (r.ok) { setStatus({ state: "starting" }); startPolling(); void poll(); }
    else if (r.status === 403) setCtrlErr("This server is read-only (demo mode) — start the DJ from your own soma instance.");
    else if (r.status === 401) setCtrlErr("Not authorized. Connect Spotify + Garmin on the web app first.");
    else setCtrlErr(r.error || `Couldn't start the DJ (${r.status}).`);
  }
  async function onStop() {
    setBusy(true); setCtrlErr(null);
    const r = await stopDj();
    setBusy(false);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    sessionStartRef.current = null;
    if (r.ok || r.status === 403) setStatus({ state: "stopped" });
    else setCtrlErr(r.error || `Couldn't stop the DJ (${r.status}).`);
  }

  // Live-card derived stats (port of the web summary line).
  const played = (status.play_history ?? []).filter((e) => e.status !== "queued");
  const matchPcts = played.filter((e) => e.track_bpm && e.target_bpm).map((e) => Math.round(100 - (Math.abs((e.track_bpm as number) - (e.target_bpm as number)) / (e.target_bpm as number)) * 100));
  const avgMatch = matchPcts.length ? Math.round(matchPcts.reduce((a, b) => a + b, 0) / matchPcts.length) : null;
  const hrs = (status.hr_history ?? []).map((p) => p.hr).filter((h) => h > 0);
  const hrLo = hrs.length ? Math.min(...hrs) : null;
  const hrHi = hrs.length ? Math.max(...hrs) : null;
  const polledAgo = status.ts ? Math.max(0, Math.floor(Date.now() / 1000 - status.ts)) : null;

  const dotColor = status.state === "error" ? "#e06060" : status.state === "starting" ? "#e0c458" : "#6ad4a0";
  const stateLabel = status.state === "error" ? "ERROR" : status.state === "starting" ? "STARTING…" : "LIVE";

  return (
    <ScrollView className="flex-1 bg-base" contentContainerClassName="items-center px-5 py-6">
      <View className="w-full max-w-2xl gap-4">
        <View className="flex-row items-center justify-between">
          <Text variant="headline">Live DJ</Text>
          <Pressable onPress={() => router.back()}><Text variant="caption" className="text-teal">Close</Text></Pressable>
        </View>
        <Text variant="caption" className="text-text-secondary">
          Polls your Garmin HR in real time and automatically queues songs that match your effort.
        </Text>

        {ctrlErr ? <Card><Text variant="micro" className="text-danger">{ctrlErr}</Text></Card> : null}

        {/* Controls (disabled while running, like web) */}
        <Card className="gap-4">
          <View className="flex-row gap-6">
            <View className="gap-1">
              <View className="flex-row items-center gap-1.5">
                <Text variant="eyebrow">Resting HR</Text>
                {hrFromGarmin ? <Text variant="micro" className="italic text-text-muted">Garmin</Text> : null}
              </View>
              <Stepper value={hrRest} onChange={setHrRest} step={1} min={30} max={100} />
            </View>
            <View className="gap-1">
              <View className="flex-row items-center gap-1.5">
                <Text variant="eyebrow">Max HR</Text>
                {hrFromGarmin ? <Text variant="micro" className="italic text-text-muted">Garmin</Text> : null}
              </View>
              <Stepper value={hrMax} onChange={setHrMax} step={1} min={140} max={220} />
            </View>
          </View>

          {/* Mode cards */}
          <View className="gap-1.5">
            <Text variant="eyebrow">Mode</Text>
            <View className="flex-row gap-1">
              {(["pump_up", "normal", "wind_down"] as OffsetMode[]).map((mode) => {
                const val = offsetValues[mode];
                const active = offsetMode === mode;
                return (
                  <Pressable key={mode} disabled={isRunning} onPress={() => setOffsetMode(mode)}
                    className={`flex-1 items-center gap-0.5 rounded-lg border py-2 ${active ? "border-teal bg-teal-bg" : "border-border-glow active:bg-surface-hover"} ${isRunning ? "opacity-50" : ""}`}>
                    <Text variant="caption" className={`font-semibold ${active ? "text-teal" : "text-text-muted"}`}>{OFFSET_ICONS[mode]} {OFFSET_NAMES[mode]}</Text>
                    <Text variant="micro" className="text-text-muted tabular-nums">{val > 0 ? "+" : ""}{val} BPM</Text>
                  </Pressable>
                );
              })}
            </View>
            {!isRunning ? (
              <View className="flex-row items-center gap-2">
                <Text variant="micro" className="w-24 text-text-muted">{OFFSET_NAMES[offsetMode]} offset</Text>
                <View className="flex-1 items-center">
                  <Stepper value={offsetValues[offsetMode]} onChange={(v) => setOffsetValues((p) => ({ ...p, [offsetMode]: v }))} step={1} min={OFFSET_RANGE[offsetMode][0]} max={OFFSET_RANGE[offsetMode][1]} />
                </View>
                <Pressable onPress={() => setOffsetValues((p) => ({ ...p, [offsetMode]: DEFAULT_OFFSETS[offsetMode] }))} hitSlop={8}>
                  <Text variant="body" className="text-text-muted">↺</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {/* Source mode */}
          <View className="gap-1">
            <Text variant="eyebrow">Source</Text>
            <View className="flex-row gap-1">
              {(["auto", "manual"] as SourceMode[]).map((mode) => {
                const active = sourceMode === mode;
                return (
                  <Pressable key={mode} disabled={isRunning} onPress={() => setSourceMode(mode)}
                    className={`flex-1 items-center rounded-lg border py-2 ${active ? "border-teal bg-teal-bg" : "border-border-glow active:bg-surface-hover"} ${isRunning ? "opacity-50" : ""}`}>
                    <Text variant="caption" className={`font-semibold ${active ? "text-teal" : "text-text-muted"}`}>{mode === "auto" ? "⟳ Auto (from Spotify)" : "▤ Manual"}</Text>
                  </Pressable>
                );
              })}
            </View>
            {sourceMode === "auto" && !isRunning ? (
              <Text variant="micro" className="text-text-muted">Play any playlist or album on Spotify — DJ will match songs from it.</Text>
            ) : null}
          </View>

          {sourceMode === "manual" && !isRunning ? (
            <ManualPickers sources={sources} onSources={setSources} genres={genres} onGenres={setGenres} />
          ) : null}
        </Card>

        {isRunning ? (
          <Button label={busy ? "Stopping…" : "■ Stop Live DJ"} variant="warm" disabled={busy} onPress={onStop} />
        ) : (
          <Button label={busy ? "Starting…" : "▶ Start Live DJ"} variant="primary" disabled={busy} onPress={onStart} />
        )}

        {/* LIVE card */}
        {isLive ? (
          <Card className="gap-2">
            <View className="flex-row items-center gap-2">
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
              <Text variant="caption" className="font-semibold" style={{ color: dotColor }}>{stateLabel}</Text>
              <View className="ml-auto flex-row items-center gap-2">
                {sessionStartRef.current !== null ? <Text variant="micro" className="text-text-muted">Session: {formatElapsed(Date.now() - sessionStartRef.current)}</Text> : null}
                {polledAgo != null ? <Text variant="micro" className="text-text-muted">polled {polledAgo < 60 ? `${polledAgo}s ago` : `${Math.floor(polledAgo / 60)}m ago`}</Text> : null}
              </View>
            </View>

            {played.length ? (
              <Text variant="micro" className="text-text-muted">
                {played.length} song{played.length !== 1 ? "s" : ""}{avgMatch != null ? ` · avg match: ${avgMatch}%` : ""}{hrLo != null && hrHi != null ? ` · HR range: ${hrLo}–${hrHi}` : ""}
              </Text>
            ) : null}

            {status.state === "error" && status.error ? <Text variant="micro" className="text-danger">{status.error}</Text> : null}

            <View className="flex-row items-center gap-3">
              {status.hr ? (
                <Text variant="caption" className="text-text-secondary">HR <Text variant="caption" className="text-text">{status.hr} bpm</Text>{status.hr_age_s != null ? ` (${hrAgeLabel(status.hr_age_s)})` : ""}</Text>
              ) : <Text variant="caption" className="italic text-text-muted">Waiting for Garmin HR…</Text>}
              {status.target_bpm ? <Text variant="caption" className="text-text-secondary">→ target <Text variant="caption" className="text-teal">{status.target_bpm} BPM</Text></Text> : null}
            </View>

            {status.no_queue_reason && status.no_queue_reason !== "already_queued" ? (
              <Text variant="micro" style={{ color: "#e0a458" }}>
                {status.no_queue_reason === "no_hr" ? "⚠ No HR data — will queue once Garmin syncs"
                  : status.no_queue_reason === "no_candidates" ? `⚠ No tracks match ${status.target_bpm ?? "?"} BPM — widen genres or sources`
                  : `⚠ ${formatReason(status.no_queue_reason)}`}
              </Text>
            ) : null}

            {status.current_track ? (
              <Text variant="caption" className="text-text-secondary" numberOfLines={1}>▶ <Text variant="caption" className="text-text">{status.current_track}</Text>{status.ms_remaining != null ? ` (${msToMinSec(status.ms_remaining)} left)` : ""}</Text>
            ) : status.state === "running" ? <Text variant="micro" className="italic text-text-muted">Nothing playing on Spotify</Text> : null}

            {status.queued_track ? <Text variant="caption" className="text-text-secondary" numberOfLines={1}>⏭ <Text variant="caption" className="text-text">{status.queued_track}</Text> (queued)</Text> : null}

            {status.auto_detect ? (
              <Text variant="micro" className="text-text-muted">
                {status.context_name ? `Auto: sourcing from ${status.context_name}${status.allowed_track_count != null ? ` (${status.allowed_track_count} tracks)` : ""}` : "Auto-detect: play something on Spotify to set source"}
              </Text>
            ) : status.allowed_track_count != null ? <Text variant="micro" className="text-text-muted">Pool: {status.allowed_track_count} tracks from selected source</Text> : null}

            {(status.queue_history ?? []).length ? (
              <View className="gap-1 border-t border-border-subtle pt-2">
                <Text variant="eyebrow">Queued this session</Text>
                {[...(status.queue_history ?? [])].reverse().slice(0, 10).map((e, i) => (
                  <View key={i} className="flex-row items-baseline gap-1.5">
                    <Text variant="micro" className="flex-1 text-text" numberOfLines={1}>{e.name}</Text>
                    <Text variant="micro" className="text-text-muted" numberOfLines={1}>{e.artist}</Text>
                    <Text variant="micro" className="text-text-secondary tabular-nums">{e.track_bpm} BPM</Text>
                    <Text variant="micro" className="text-text-muted">{formatReason(e.reason)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Card>
        ) : null}

        <Text variant="micro" className="text-text-muted">Play any song on Spotify first, then start — the DJ takes over the queue.</Text>
      </View>
    </ScrollView>
  );
}

/* Manual source + genre pickers (mobile inline form of the web popovers). */
function ManualPickers({ sources, onSources, genres, onGenres }: {
  sources: string[]; onSources: (v: string[]) => void; genres: string[]; onGenres: (v: string[]) => void;
}) {
  const [playlists, setPlaylists] = useState<SpotifyPlaylistMeta[] | null>(null);
  const [genreBuckets, setGenreBuckets] = useState<string[] | null>(null);
  useEffect(() => {
    fetchSpotifyPlaylists().then(setPlaylists).catch(() => setPlaylists([]));
    fetchGenres().then(({ genres: g, total }) => {
      const t = Number(total) || 1;
      setGenreBuckets((g ?? []).filter((b: GenreBucket) => (Number(b.count) || 0) / t >= 0.03).map((b) => b.genre));
    }).catch(() => setGenreBuckets([]));
  }, []);
  const toggle = (arr: string[], v: string, set: (x: string[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <View className="gap-3">
      <View className="gap-2">
        <Text variant="eyebrow">Sources {sources.length ? `· ${sources.length}` : ""}</Text>
        <View className="flex-row flex-wrap gap-2">
          <Pill label="Liked Songs" active={sources.includes("liked")} onPress={() => toggle(sources, "liked", onSources)} />
          {(playlists ?? []).map((p) => (
            <Pill key={p.id} label={`${p.name} (${p.tracks})`} active={sources.includes(p.id)} onPress={() => toggle(sources, p.id, onSources)} />
          ))}
        </View>
      </View>
      {genreBuckets && genreBuckets.length ? (
        <View className="gap-2">
          <Text variant="eyebrow">Genres {genres.length ? `· ${genres.length}` : "· any"}</Text>
          <View className="flex-row flex-wrap gap-2">
            {genreBuckets.map((g) => <Pill key={g} label={g} active={genres.includes(g)} onPress={() => toggle(genres, g, onGenres)} />)}
          </View>
        </View>
      ) : null}
    </View>
  );
}
