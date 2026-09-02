import { useEffect, useRef, useState, useCallback } from "react";
import { ScrollView, View, Pressable } from "react-native";
import { router } from "expo-router";
import { Text, Card, Button, Pill, Badge, SegmentedControl, Stepper } from "soma-style";
import {
  fetchDjStatus, fetchDjHrDefaults, startDj, stopDj, fetchGenres,
  type DjStatus, type DjStartBody, type GenreBucket,
} from "../../lib/playlist";

type OffsetMode = "Wind down" | "Steady" | "Pump up";
const OFFSETS: Record<OffsetMode, number> = { "Wind down": -12, Steady: 0, "Pump up": 12 };
type SourceMode = "Whole library" | "Auto-detect";

function mmss(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Compact genre picker (same 3% threshold as the builder). */
function GenrePicker({ selected, onToggle }: { selected: string[]; onToggle: (g: string) => void }) {
  const [buckets, setBuckets] = useState<string[] | null>(null);
  useEffect(() => {
    fetchGenres().then(({ genres, total }) => {
      const t = Number(total) || 1;
      setBuckets((genres ?? []).filter((g: GenreBucket) => (Number(g.count) || 0) / t >= 0.03).map((g) => g.genre));
    }).catch(() => setBuckets([]));
  }, []);
  if (!buckets || buckets.length === 0) return null;
  return (
    <View className="gap-2">
      <Text variant="eyebrow">Genres {selected.length ? `· ${selected.length}` : "· all"}</Text>
      <View className="flex-row flex-wrap gap-2">
        {buckets.map((g) => <Pill key={g} label={g} active={selected.includes(g)} onPress={() => onToggle(g)} />)}
      </View>
    </View>
  );
}

export default function LiveDjScreen() {
  const [hrRest, setHrRest] = useState(60);
  const [hrMax, setHrMax] = useState(190);
  const [hrFromGarmin, setHrFromGarmin] = useState(false);
  const [offsetMode, setOffsetMode] = useState<OffsetMode>("Steady");
  const [sourceMode, setSourceMode] = useState<SourceMode>("Whole library");
  const [genres, setGenres] = useState<string[]>([]);
  const [status, setStatus] = useState<DjStatus>({ state: "stopped" });
  const [busy, setBusy] = useState(false);
  const [ctrlErr, setCtrlErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Local ms countdown between polls, for a smooth "time left" readout.
  const [tick, setTick] = useState(0);
  const lastPollRef = useRef<number>(Date.now());

  const isLive = status.state === "running" || status.state === "starting";

  const poll = useCallback(async () => {
    try {
      const s = await fetchDjStatus();
      setStatus(s);
      lastPollRef.current = Date.now();
      if (s.state === "stopped" && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    } catch { /* keep last status */ }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(poll, 5000);
  }, [poll]);

  // Prefill HR from Garmin, and adopt an already-running daemon on mount.
  useEffect(() => {
    fetchDjHrDefaults().then((d) => {
      if (d.hr_rest) setHrRest(d.hr_rest);
      if (d.hr_max) setHrMax(d.hr_max);
      if (d.hr_rest || d.hr_max) setHrFromGarmin(true);
    }).catch(() => {});
    fetchDjStatus().then((s) => {
      setStatus(s);
      if (s.state === "running" || s.state === "starting") startPolling();
    }).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [startPolling]);

  // 1s ticker (only while live) to animate the countdown between 5s polls.
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  async function onStart() {
    setBusy(true); setCtrlErr(null);
    const body: DjStartBody = {
      hr_rest: hrRest, hr_max: hrMax, offset: OFFSETS[offsetMode],
      genres: sourceMode === "Auto-detect" ? [] : genres,
      sources: sourceMode === "Auto-detect" ? ["auto"] : ["liked"],
    };
    const r = await startDj(body);
    setBusy(false);
    if (r.ok) {
      setStatus({ state: "starting" });
      startPolling();
      void poll();
    } else if (r.status === 403) {
      setCtrlErr("This server is read-only (demo mode) — start the DJ from your own soma instance.");
    } else if (r.status === 401) {
      setCtrlErr("Not authorized. Connect Spotify + Garmin on the web app first.");
    } else {
      setCtrlErr(r.error || `Couldn't start the DJ (${r.status}).`);
    }
  }
  async function onStop() {
    setBusy(true); setCtrlErr(null);
    const r = await stopDj();
    setBusy(false);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (r.ok || r.status === 403) setStatus({ state: "stopped" });
    else setCtrlErr(r.error || `Couldn't stop the DJ (${r.status}).`);
  }

  const toggleGenre = (g: string) => setGenres((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));

  // Smoothed ms remaining (decrement locally since the last poll).
  const liveMsRemaining = status.ms_remaining != null
    ? Math.max(0, status.ms_remaining - (Date.now() - lastPollRef.current))
    : null;
  void tick; // re-render dependency

  const recentQueue = (status.queue_history ?? []).slice(-4).reverse();

  return (
    <ScrollView className="flex-1 bg-base" contentContainerClassName="items-center px-5 py-6">
      <View className="w-full max-w-2xl gap-4">
        <View className="flex-row items-center justify-between">
          <Text variant="headline">Live DJ</Text>
          <Pressable onPress={() => router.back()}><Text variant="caption" className="text-teal">Close</Text></Pressable>
        </View>
        <Text variant="caption" className="text-text-secondary">
          Auto-queues BPM-matched songs to your live heart rate. Runs on your soma host; control it from here.
        </Text>

        {ctrlErr ? <Card><Text variant="micro" className="text-danger">{ctrlErr}</Text></Card> : null}

        {isLive ? (
          <>
            {/* Live status */}
            <Card className="gap-3">
              <View className="flex-row items-center justify-between">
                <Badge label={status.state === "starting" ? "Starting" : "Running"} tone={status.state === "starting" ? "warm" : "success"} />
                <Text variant="micro" className="text-text-muted tabular-nums">
                  {status.session_played_count != null ? `${status.session_played_count} played` : ""}
                  {status.auto_detect && status.context_name ? ` · ${status.context_name}` : status.allowed_track_count != null ? ` · ${status.allowed_track_count} in pool` : ""}
                </Text>
              </View>
              <View className="flex-row gap-3">
                <View className="flex-1 gap-1">
                  <Text variant="headline" className="text-warm tabular-nums">{status.hr != null ? status.hr : "—"}</Text>
                  <Text variant="micro">bpm heart rate{status.hr_age_s != null && status.hr_age_s > 120 ? ` · ${Math.round(status.hr_age_s / 60)}m old` : ""}</Text>
                </View>
                <View className="flex-1 gap-1">
                  <Text variant="headline" className="text-teal tabular-nums">{status.target_bpm != null ? status.target_bpm : "—"}</Text>
                  <Text variant="micro">target song bpm{status.offset ? ` · ${status.offset > 0 ? "+" : ""}${status.offset}` : ""}</Text>
                </View>
              </View>
            </Card>

            {/* Now playing / up next */}
            <Card className="gap-2">
              <Text variant="eyebrow">Now playing</Text>
              {status.current_track ? (
                <View className="flex-row items-center justify-between">
                  <Text variant="body" className="text-text flex-1 pr-2" numberOfLines={1}>{status.current_track}</Text>
                  {liveMsRemaining != null ? <Text variant="micro" className="text-text-muted tabular-nums">{mmss(liveMsRemaining)} left</Text> : null}
                </View>
              ) : <Text variant="micro" className="text-text-muted">Nothing playing — start playback on Spotify.</Text>}
              {status.queued_track ? (
                <View className="border-t border-border-subtle pt-2">
                  <Text variant="eyebrow">Up next</Text>
                  <Text variant="caption" className="text-text-secondary" numberOfLines={1}>↪ {status.queued_track}</Text>
                </View>
              ) : status.no_queue_reason ? (
                <Text variant="micro" className="text-text-muted">Waiting to queue ({status.no_queue_reason.replace(/_/g, " ")}).</Text>
              ) : null}
            </Card>

            {recentQueue.length ? (
              <Card className="gap-1">
                <Text variant="eyebrow">Recently queued</Text>
                {recentQueue.map((q, i) => (
                  <View key={`${q.ts}-${i}`} className="flex-row items-center justify-between border-t border-border-subtle py-1.5">
                    <View className="flex-1 pr-2">
                      <Text variant="caption" className="text-text" numberOfLines={1}>{q.name}</Text>
                      <Text variant="micro" className="text-text-muted" numberOfLines={1}>{q.artist}{q.track_bpm ? ` · ${q.track_bpm} bpm` : ""}</Text>
                    </View>
                    <Text variant="micro" className="text-text-muted tabular-nums">→{q.target_bpm ?? "—"}</Text>
                  </View>
                ))}
              </Card>
            ) : null}

            <Button label={busy ? "Stopping…" : "Stop DJ"} variant="warm" disabled={busy} onPress={onStop} />
          </>
        ) : (
          <>
            {/* Setup */}
            <Card className="gap-4">
              <View className="gap-2">
                <View className="flex-row items-center justify-between">
                  <Text variant="eyebrow">Resting HR</Text>
                  <Stepper value={hrRest} onChange={setHrRest} step={1} min={20} max={120} />
                </View>
                <View className="flex-row items-center justify-between">
                  <Text variant="eyebrow">Max HR</Text>
                  <Stepper value={hrMax} onChange={setHrMax} step={1} min={140} max={230} />
                </View>
                {hrFromGarmin ? <Text variant="micro" className="text-text-muted">Prefilled from your Garmin history.</Text> : null}
              </View>

              <View className="gap-2">
                <Text variant="eyebrow">Energy</Text>
                <SegmentedControl options={["Wind down", "Steady", "Pump up"] as const} value={offsetMode} onChange={setOffsetMode} />
                <Text variant="micro" className="text-text-muted">Shifts target BPM {OFFSETS[offsetMode] > 0 ? "+" : ""}{OFFSETS[offsetMode]} for the whole session.</Text>
              </View>

              <View className="gap-2">
                <Text variant="eyebrow">Song source</Text>
                <SegmentedControl options={["Whole library", "Auto-detect"] as const} value={sourceMode} onChange={setSourceMode} />
                <Text variant="micro" className="text-text-muted">
                  {sourceMode === "Auto-detect" ? "Match within whatever playlist/album you're already playing." : "Pull from your whole liked library, optionally by genre."}
                </Text>
              </View>

              {sourceMode === "Whole library" ? <GenrePicker selected={genres} onToggle={toggleGenre} /> : null}
            </Card>

            <Button label={busy ? "Starting…" : "Start DJ"} variant="primary" disabled={busy} onPress={onStart} />
            <Text variant="micro" className="text-text-muted">Play any song on Spotify first, then start — the DJ takes over the queue.</Text>
          </>
        )}
      </View>
    </ScrollView>
  );
}
