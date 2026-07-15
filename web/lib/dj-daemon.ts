/**
 * Live DJ daemon — TS port of sync/src/dj_daemon.py. Polls Garmin HR + Spotify
 * every 30 s and dynamically queues BPM-matched songs. Long-running process:
 * spawned by /api/playlist/dj/start, writes status JSON the UI polls, exits on
 * SIGTERM. Reuses the ported bpm-formula + dj-shuffle, spotify-client, garmin-auth
 * and Neon. Stage: sync cutover (#187).
 */
import { writeFileSync, renameSync, readFileSync, unlinkSync } from "fs";
import { GarminAuth, DBTokenStore } from "garmin-auth";
import { getDb } from "./db";
import { spotifyFetch } from "./spotify-client";
import { hrrToBpm, latestHrFromGarminData } from "./bpm-formula";
import { SessionState, interleavedShuffle, type Song } from "./dj-shuffle";

const POLL_INTERVAL = 30_000;
const QUEUE_AHEAD_MS = 45_000;
const HR_SHIFT_THRESHOLD = 8;
const HR_WINDOW_SECONDS = 86_400; // Garmin syncs infrequently
const SOURCE_REFRESH_INTERVAL = 20;
const HR_HISTORY_MAX_SECONDS = 7_200;
const PLAYED_HISTORY_FILE = "/tmp/soma-dj-played.json";
const PROFILE_URL = "/userprofile-service/socialProfile";

const nowS = () => Date.now() / 1000;

// ---- Spotify helpers (via the shared token-managing spotifyFetch) ----
async function sGet(path: string): Promise<any> {
  const res = await spotifyFetch(path);
  if (res.status === 204) return {};
  if (!res.ok) throw new Error(`Spotify GET ${path} → ${res.status}`);
  return res.json();
}
async function sPost(path: string): Promise<void> {
  const res = await spotifyFetch(path, { method: "POST" });
  if (![200, 201, 204].includes(res.status)) throw new Error(`Spotify POST ${path} → ${res.status}`);
}
async function sPut(path: string, body: unknown): Promise<void> {
  const res = await spotifyFetch(path, { method: "PUT", body: JSON.stringify(body) });
  if (![200, 202, 204].includes(res.status)) throw new Error(`Spotify PUT ${path} → ${res.status}`);
}

function albumImageUrl(item: any): string | null {
  const images = item?.album?.images || [];
  if (!images.length) return null;
  return images[Math.min(1, images.length - 1)].url;
}

async function fetchTrackDetails(trackId: string): Promise<{ duration_ms: number | null; image_url: string | null }> {
  try {
    const data = await sGet(`/tracks/${trackId}`);
    return { duration_ms: data.duration_ms ?? null, image_url: albumImageUrl(data) };
  } catch {
    return { duration_ms: null, image_url: null };
  }
}

/** Track IDs allowed by the given sources. null = 'liked'/full library (no filter). */
async function fetchSourceTrackIds(sources: string[]): Promise<Set<string> | null> {
  if (!sources.length || sources.includes("liked")) return null;
  const ids = new Set<string>();
  for (const source of sources) {
    let offset = 0;
    for (;;) {
      let data: any;
      try { data = await sGet(`/playlists/${source}/items?limit=50&offset=${offset}`); }
      catch (e) { console.log(`[dj] Cannot read playlist ${source}: ${(e as Error).message}`); break; }
      const items = data.items || [];
      for (const item of items) {
        const track = item.item || item.track || {};
        if (track.id) ids.add(track.id);
      }
      if (items.length < 50 || !data.next) break;
      offset += 50;
    }
  }
  return ids.size ? ids : null;
}

async function fetchAlbumTrackIds(albumId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  for (;;) {
    const data = await sGet(`/albums/${albumId}/tracks?limit=50&offset=${offset}`);
    const items = data.items || [];
    for (const item of items) if (item.id) ids.add(item.id);
    if (items.length < 50 || !data.next) break;
    offset += 50;
  }
  return ids;
}

// ---- Track query (Neon; port of _query_tracks) ----
export async function queryTracks(
  targetBpm: number, genres: string[], excludeIds: string[],
  allowedIds: Set<string> | null, bpmWindow = 5,
): Promise<Song[]> {
  // Neon's client also exposes .query(text, params) for parameterized dynamic
  // SQL (the QueryFn type only declares the tagged-template form).
  const sql = getDb() as unknown as { query(text: string, params: unknown[]): Promise<Song[]> };
  const bpmTargets = new Set<number>([targetBpm]);
  for (const mult of [0.5, 2.0]) {
    const alt = Math.round(targetBpm * mult);
    if (alt >= 60 && alt <= 200) bpmTargets.add(alt);
  }

  const conds: string[] = [];
  const params: any[] = [];
  const p = (v: any) => { params.push(v); return `$${params.length}`; };

  if (allowedIds !== null) {
    conds.push(`track_id = ANY(${p([...allowedIds])}::text[])`);
  } else {
    const sorted = [...bpmTargets].sort((a, b) => a - b);
    conds.push("(" + sorted.map((t) => `tempo BETWEEN ${p(t - bpmWindow)} AND ${p(t + bpmWindow)}`).join(" OR ") + ")");
  }
  if (genres.length) conds.push(`genres && ${p(genres)}`);
  conds.push("track_id NOT IN (SELECT track_id FROM user_blacklist)");
  if (excludeIds.length) conds.push(`track_id != ALL(${p(excludeIds)}::text[])`);

  let order = "";
  if (allowedIds !== null) order = `ORDER BY ABS(tempo - ${p(targetBpm)})`;

  const text = `SELECT track_id, name, artist_name, artist_name AS artist_id, tempo, energy
                FROM spotify_track_features WHERE ${conds.join(" AND ")} ${order} LIMIT 200`;
  return (await sql.query(text, params)) as Song[];
}

function writeStatus(statusFile: string, status: Record<string, unknown>): void {
  const tmp = statusFile + ".tmp";
  writeFileSync(tmp, JSON.stringify(status));
  renameSync(tmp, statusFile);
}

export interface DaemonOpts {
  hrRest: number; hrMax: number; offset: number;
  genres: string[]; sources: string[];
  statusFile: string; pidFile: string;
}

/** Main daemon loop. Resolves when stopped (SIGTERM). */
export async function runDaemon(opts: DaemonOpts): Promise<void> {
  const { hrRest, hrMax, offset, genres, sources, statusFile, pidFile } = opts;
  writeFileSync(pidFile, String(process.pid));

  let stop = false;
  const onStop = () => { stop = true; };
  process.on("SIGTERM", onStop);
  process.on("SIGINT", onStop);

  const auth = new GarminAuth({ store: new DBTokenStore(process.env.DATABASE_URL!) });
  const garmin = await auth.client();
  const profile = (await garmin.connectapi(PROFILE_URL)) as { displayName?: string };
  const display = profile?.displayName;
  if (!display) throw new Error("Garmin profile has no displayName");

  const session = new SessionState();
  try {
    const prev = JSON.parse(readFileSync(PLAYED_HISTORY_FILE, "utf8"));
    if (Array.isArray(prev)) for (const tid of prev.slice(-200)) session.played.add(tid);
  } catch { /* no prior history */ }

  let lastHr: number | null = null;
  let lastHrTs: number | null = null;
  let lastTargetBpm: number | null = null;
  let queuedTrackId: string | null = null;
  let queuedTrackName: string | null = null;
  let firstQueueDone = false;
  let lastCurrentTrackId: string | null = null;
  let allowedIds: Set<string> | null = null;
  let observationFallback = false;
  let sourceIdsLoaded = false;
  let sourceRefreshCounter = 0;
  let lastContextUri: string | null = null;
  const observedContextTracks = new Set<string>();
  let queueHistory: any[] = [];
  let playHistory: any[] = [];
  let hrHistory: any[] = [];

  writeStatus(statusFile, { state: "starting", hr: null, target_bpm: null });

  const todayNyc = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  while (!stop) {
    try {
      // 0. Refresh source track IDs periodically (explicit sources only).
      const autoDetect = !sources.length || (sources.length === 1 && sources[0] === "auto");
      if (!autoDetect) {
        if (!sourceIdsLoaded || sourceRefreshCounter === 0) {
          try { allowedIds = await fetchSourceTrackIds(sources); sourceIdsLoaded = true; } catch { /* keep prev */ }
        }
        sourceRefreshCounter = (sourceRefreshCounter + 1) % SOURCE_REFRESH_INTERVAL;
      }

      // 1. Poll Garmin HR.
      const today = todayNyc();
      const hrData = (await garmin.connectapi(`/wellness-service/wellness/dailyHeartRate/${display}?date=${today}`)) as any;
      const hrResult = latestHrFromGarminData(hrData, HR_WINDOW_SECONDS);
      if (hrResult) [lastHr, lastHrTs] = hrResult;
      const targetBpm = lastHr !== null ? hrrToBpm(lastHr, hrRest, hrMax, offset) : null;

      // 2. Poll currently-playing.
      const nowPlaying = await sGet("/me/player/currently-playing");
      let currentTrackId: string | null = null;
      let currentTrackName: string | null = null;
      let msRemaining: number | null = null;
      let item: any = {};
      let progressMs = 0, durationMs = 0;
      const prevQueuedTrackId = queuedTrackId;

      if (nowPlaying && nowPlaying.is_playing && nowPlaying.item) {
        item = nowPlaying.item;
        currentTrackId = item.id;
        currentTrackName = item.name;
        durationMs = item.duration_ms;
        progressMs = nowPlaying.progress_ms || 0;
        msRemaining = durationMs - progressMs;
        const artistKey = () => (item.artists?.[0]?.id) || (item.artists?.[0]?.name || "").toLowerCase().replace(/ /g, "_");
        if (currentTrackId && currentTrackId !== queuedTrackId) { session.markPlayed(currentTrackId); session.lastPlayedArtistId = artistKey(); }
        if (currentTrackId && currentTrackId === queuedTrackId) {
          session.markPlayed(currentTrackId); session.lastPlayedArtistId = artistKey();
          queuedTrackId = null; queuedTrackName = null;
        }
      }

      const trackJustChanged = currentTrackId !== null && currentTrackId !== lastCurrentTrackId && lastCurrentTrackId !== null;
      lastCurrentTrackId = currentTrackId;

      // 2c. play_history maintenance.
      if (currentTrackId && item) {
        const actualStartedAt = nowS() - progressMs / 1000;
        const artistName = item.artists?.[0]?.name || "";
        const mkEntry = (status: string) => ({
          track_id: currentTrackId, name: currentTrackName || "", artist: artistName,
          track_bpm: null, target_bpm: targetBpm, started_at: actualStartedAt,
          duration_ms: durationMs || null, image_url: albumImageUrl(item), status,
        });
        if (!playHistory.length) {
          playHistory.push(mkEntry("current"));
        } else if (trackJustChanged) {
          const cur = playHistory.find((e) => e.status === "current"); if (cur) cur.status = "played";
          if (currentTrackId === prevQueuedTrackId) {
            const promoted = playHistory.find((e) => e.status === "queued" && e.track_id === currentTrackId);
            if (promoted) {
              promoted.status = "current"; promoted.started_at = actualStartedAt;
              promoted.image_url = albumImageUrl(item) || promoted.image_url;
              promoted.duration_ms = durationMs || promoted.duration_ms;
            } else playHistory.push(mkEntry("current"));
          } else {
            playHistory = playHistory.filter((e) => e.status !== "queued");
            playHistory.push(mkEntry("current"));
          }
        } else {
          const cur = playHistory.find((e) => e.status === "current" && e.track_id === currentTrackId);
          if (cur) { cur.started_at = actualStartedAt; cur.duration_ms = durationMs || cur.duration_ms; }
        }
        playHistory = playHistory.slice(-20);
      }

      // 2b. Auto-detect source context.
      let currentContextName: string | null = null;
      if (autoDetect && nowPlaying) {
        const ctx = nowPlaying.context || {};
        const ctxUri: string = ctx.uri || "";
        const ctxType: string = ctx.type || "";
        if (ctxUri !== lastContextUri) {
          lastContextUri = ctxUri; sourceIdsLoaded = false; observedContextTracks.clear();
          allowedIds = null; observationFallback = false;
        }
        if (ctxUri && !sourceIdsLoaded) {
          const ctxId = ctxUri.split(":").pop() as string;
          let fetchOk = false;
          try {
            if (ctxType === "playlist") {
              const fetched = await fetchSourceTrackIds([ctxId]);
              if (fetched) { allowedIds = fetched; observationFallback = false; fetchOk = true; }
            } else if (ctxType === "album") {
              const a = await fetchAlbumTrackIds(ctxId); allowedIds = a.size ? a : null; observationFallback = false; fetchOk = allowedIds !== null;
            } else { allowedIds = null; observationFallback = false; fetchOk = true; }
          } catch (e) { console.log(`[dj] Auto-detect source fetch failed: ${(e as Error).message}`); }
          if (!fetchOk && ctxType === "playlist") {
            try {
              const recent = await sGet("/me/player/recently-played?limit=50");
              for (const it of recent.items || []) if ((it.context || {}).uri === ctxUri) { const tid = (it.track || {}).id; if (tid) observedContextTracks.add(tid); }
            } catch { /* ignore */ }
            observationFallback = true;
          }
          sourceIdsLoaded = true;
        }
        if (autoDetect && ctxUri && currentTrackId && observationFallback) observedContextTracks.add(currentTrackId);
        if (observationFallback && observedContextTracks.size) allowedIds = new Set(observedContextTracks);
        if (ctxType === "playlist") {
          try { const m = await sGet(`/playlists/${ctxUri.split(":").pop()}?fields=name`); currentContextName = m.name || `playlist:${ctxUri.split(":").pop()}`; }
          catch { currentContextName = `playlist:${ctxUri.split(":").pop()}`; }
        } else if (ctxType === "album") {
          try { const m = await sGet(`/albums/${ctxUri.split(":").pop()}`); currentContextName = m.name; } catch { currentContextName = "album"; }
        } else if (!ctxUri) allowedIds = null;
      }

      // HR history snapshot.
      if (lastHr !== null) {
        hrHistory.push({ ts: nowS(), hr: lastHr, target_bpm: targetBpm });
        const cutoff = nowS() - HR_HISTORY_MAX_SECONDS;
        hrHistory = hrHistory.filter((x) => x.ts >= cutoff);
      }

      // 3. Decide whether to queue.
      let shouldQueue = false;
      let replaceReason: string | null = null;
      let noQueueReason: string | null = null;
      const isPlaying = Boolean(nowPlaying && nowPlaying.is_playing && nowPlaying.item);
      if (targetBpm === null) noQueueReason = "no_hr";
      else if (!firstQueueDone) { shouldQueue = true; replaceReason = "initial"; }
      else if (queuedTrackId !== null) noQueueReason = "already_queued";
      else if (trackJustChanged) { shouldQueue = true; replaceReason = "track_started"; }
      else if (msRemaining !== null) {
        if (msRemaining < QUEUE_AHEAD_MS) { shouldQueue = true; replaceReason = "45s_remaining"; }
        else if (lastTargetBpm !== null && Math.abs(targetBpm - lastTargetBpm) >= HR_SHIFT_THRESHOLD) { shouldQueue = true; replaceReason = `hr_shift_${lastTargetBpm}_to_${targetBpm}`; }
      }

      if (shouldQueue && targetBpm !== null) {
        const excludeIds = [...session.played, ...session.skipped];
        if (currentTrackId) excludeIds.push(currentTrackId);
        let candidates = await queryTracks(targetBpm, genres, excludeIds, allowedIds, 5);
        if (!candidates.length) candidates = await queryTracks(targetBpm, genres, excludeIds, allowedIds, 15);
        if (!candidates.length && observationFallback) candidates = await queryTracks(targetBpm, genres, excludeIds, null, 15);
        const shuffled = interleavedShuffle(session.filterCandidates(candidates), session);

        if (shuffled.length) {
          const next = shuffled[0];
          const nextId = next.track_id;
          if (!firstQueueDone && !isPlaying) await sPut("/me/player/play", { uris: [`spotify:track:${nextId}`] });
          else await sPost(`/me/player/queue?uri=spotify:track:${nextId}`);
          queuedTrackId = nextId; queuedTrackName = next.name;
          queueHistory.push({ name: next.name, artist: next.artist_name || "", target_bpm: targetBpm, track_bpm: Math.round(next.tempo || 0), reason: replaceReason || "queued", ts: nowS() });
          queueHistory = queueHistory.slice(-10);
          firstQueueDone = true; noQueueReason = null;

          const curPh = playHistory.find((e) => e.status === "current");
          const estStart = curPh && curPh.duration_ms ? curPh.started_at + curPh.duration_ms / 1000 : nowS() + (msRemaining ? msRemaining / 1000 : 300);
          const details = await fetchTrackDetails(nextId);
          playHistory = playHistory.filter((e) => e.status !== "queued");
          playHistory.push({ track_id: nextId, name: next.name, artist: next.artist_name || "", track_bpm: Math.round(next.tempo || 0) || null, target_bpm: targetBpm, started_at: estStart, duration_ms: details.duration_ms, image_url: details.image_url, status: "queued" });
          playHistory = playHistory.slice(-20);
          session.markPlayed(nextId);
          try { writeFileSync(PLAYED_HISTORY_FILE, JSON.stringify([...session.played].slice(-200))); } catch { /* ignore */ }
        } else {
          queuedTrackId = null; queuedTrackName = null; noQueueReason = "no_candidates";
        }
      }

      if (targetBpm !== null) lastTargetBpm = targetBpm;

      // 4. Write status.
      writeStatus(statusFile, {
        state: "running", hr: lastHr, hr_age_s: lastHrTs ? Math.round(nowS() - lastHrTs) : null,
        target_bpm: targetBpm, offset, current_track: currentTrackName, current_track_id: currentTrackId,
        ms_remaining: msRemaining, queued_track: queuedTrackName, queued_track_id: queuedTrackId,
        replace_reason: replaceReason, no_queue_reason: noQueueReason, session_played_count: session.played.size,
        allowed_track_count: allowedIds !== null ? allowedIds.size : null, auto_detect: autoDetect,
        context_name: autoDetect ? currentContextName : null, queue_history: queueHistory,
        play_history: playHistory, hr_history: hrHistory, ts: nowS(),
      });
    } catch (exc) {
      writeStatus(statusFile, { state: "error", error: (exc as Error).message, hr_history: hrHistory, queue_history: queueHistory, play_history: playHistory, ts: nowS() });
    }
    await new Promise<void>((r) => { const t = setTimeout(r, POLL_INTERVAL); if (stop) { clearTimeout(t); r(); } });
  }

  writeStatus(statusFile, { state: "stopped" });
  try { unlinkSync(pidFile); } catch { /* ignore */ }
}
