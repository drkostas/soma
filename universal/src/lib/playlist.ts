/**
 * Playlist builder core — ported faithfully from the web `playlist-builder.tsx`
 * + `segment-editor.tsx`. All song scoring happens server-side in
 * POST /api/playlist/sessions (which streams SSE); this file only builds the
 * segment payload, runs the stream (via expo/fetch, whose FetchResponse.body is
 * a real ReadableStream unlike RN's global fetch), and exposes GET helpers.
 */
import { fetch as streamFetch } from "expo/fetch";
import { API_BASE, AUTH_HEADERS, fetchJson } from "./api";

export type SegmentType =
  | "warmup" | "easy" | "aerobic" | "tempo" | "interval"
  | "vo2max" | "recovery" | "rest" | "strides" | "cooldown";

export interface Segment {
  id: string; type: SegmentType; duration_s: number;
  bpm_min: number; bpm_max: number; bpm_tolerance: number;
  sync_mode: "sync" | "async" | "auto";
  valence_min: number; valence_max: number;
}
export interface RepeatGroup {
  id: string; type: "repeat"; repeat_count: number; template_size: number; children: Segment[];
}
export type SegmentItem = Segment | RepeatGroup;
export type ParsedStep =
  | { type?: string; duration_s?: number }
  | { type: "repeat"; repeat_count: number; children: ParsedStep[] };

export interface SongData {
  track_id: string; name: string; artist_name: string; artist_id?: string;
  duration_ms: number; tempo?: number; energy?: number; valence?: number;
  quality_score?: number; genres?: string[]; is_skip?: boolean; is_half_time?: boolean;
}
export interface GarminRunMeta {
  activity_id: string; activity_name: string | null;
  start_time?: string | null; distance?: number | null; duration?: number | null;
}
export interface GarminRunDetail {
  activity_id: string; activity_name: string | null; start_time?: string | null;
  segments: ParsedStep[]; hasSplits: boolean; isTreadmill: boolean;
}
export interface GenreBucket { genre: string; count: number | string }

/** Per-segment-type BPM + valence defaults — verbatim from web segment-editor.tsx. */
export const BPM_DEFAULTS: Record<SegmentType, { min: number; max: number; valence_min: number; valence_max: number }> = {
  warmup: { min: 100, max: 140, valence_min: 0.3, valence_max: 0.7 },
  easy: { min: 125, max: 145, valence_min: 0.3, valence_max: 0.7 },
  aerobic: { min: 125, max: 145, valence_min: 0.3, valence_max: 0.7 },
  tempo: { min: 160, max: 180, valence_min: 0.1, valence_max: 0.5 },
  interval: { min: 175, max: 195, valence_min: 0.0, valence_max: 0.4 },
  vo2max: { min: 175, max: 195, valence_min: 0.0, valence_max: 0.4 },
  recovery: { min: 125, max: 145, valence_min: 0.3, valence_max: 0.7 },
  rest: { min: 80, max: 110, valence_min: 0.3, valence_max: 0.7 },
  strides: { min: 160, max: 180, valence_min: 0.1, valence_max: 0.5 },
  cooldown: { min: 60, max: 90, valence_min: 0.6, valence_max: 1.0 },
};
export const TYPE_COLORS: Record<SegmentType, string> = {
  warmup: "#77c8d1", easy: "#6ad4a0", aerobic: "#6ad4a0", tempo: "#e0c458",
  interval: "#e0a458", vo2max: "#e06060", recovery: "#8aa0ac", rest: "#5a7a8a",
  strides: "#e0c458", cooldown: "#6366b0",
};

let _seq = 0;
const nid = () => `s${Date.now().toString(36)}${(_seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function makeSegment(p: { type?: string; duration_s?: number }): Segment {
  const type = (p.type && (p.type as SegmentType) in BPM_DEFAULTS ? p.type : "easy") as SegmentType;
  const bpm = BPM_DEFAULTS[type] ?? BPM_DEFAULTS.easy;
  return { id: nid(), type, duration_s: p.duration_s ?? 600, bpm_min: bpm.min, bpm_max: bpm.max, bpm_tolerance: 8, sync_mode: "auto", valence_min: bpm.valence_min, valence_max: bpm.valence_max };
}

export function parsedToItems(parsed: ParsedStep[]): SegmentItem[] {
  return parsed.map((p) => {
    if ((p as { type?: string }).type === "repeat" && "children" in p) {
      const repeatCount = (p as { repeat_count: number }).repeat_count ?? 1;
      const templateSegs = (p as { children: ParsedStep[] }).children
        .filter((c) => (c as { type?: string }).type !== "repeat")
        .map((c) => makeSegment(c as { type?: string; duration_s?: number }));
      if (!templateSegs.length) return makeSegment({ type: "easy", duration_s: 600 });
      const allChildren: Segment[] = [];
      for (let i = 0; i < repeatCount; i++) for (const seg of templateSegs) allChildren.push(i === 0 ? seg : { ...seg, id: nid() });
      return { id: nid(), type: "repeat" as const, repeat_count: repeatCount, template_size: templateSegs.length, children: allChildren };
    }
    return makeSegment(p as { type?: string; duration_s?: number });
  });
}

export function flatItems(items: SegmentItem[]): Segment[] {
  return items.flatMap((item) => (item.type === "repeat" ? item.children : [item as Segment]));
}

/** Bundle segments for generation: short repeat groups collapse to one music block,
 *  long ones bundle by template step type; regular segments are 1-to-1. Verbatim from web. */
export function segsForGenerate(items: SegmentItem[]): { segments: Segment[]; flatIndexMap: number[][] } {
  const segments: Segment[] = [];
  const flatIndexMap: number[][] = [];
  let flatIdx = 0;
  for (const item of items) {
    if (item.type === "repeat") {
      const group = item;
      const template = group.children.slice(0, group.template_size);
      const allShort = template.every((s) => s.duration_s <= 120);
      if (allShort) {
        const dominant = template.find((s) => s.type !== "recovery" && s.type !== "rest") ?? template[0];
        const totalDuration = group.children.reduce((s, c) => s + c.duration_s, 0);
        segments.push({ ...dominant, id: nid(), duration_s: totalDuration });
        flatIndexMap.push(Array.from({ length: group.children.length }, (_, i) => flatIdx + i));
        flatIdx += group.children.length;
      } else {
        for (let t = 0; t < template.length; t++) {
          segments.push({ ...template[t], id: nid(), duration_s: template[t].duration_s * group.repeat_count });
          const indices: number[] = [];
          for (let r = 0; r < group.repeat_count; r++) indices.push(flatIdx + r * group.template_size + t);
          flatIndexMap.push(indices);
        }
        flatIdx += group.children.length;
      }
    } else {
      segments.push(item);
      flatIndexMap.push([flatIdx]);
      flatIdx++;
    }
  }
  return { segments, flatIndexMap };
}

/* ---- SSE generation (POST /api/playlist/sessions streams text/event-stream) ---- */
export type SSEEvent =
  | { type: "segment_start"; index: number }
  | { type: "segment_done"; index: number; songs: SongData[]; pool_count: number }
  | { type: "segment_warning"; index: number; message: string; pool_count?: number }
  | { type: "error"; message: string }
  | { type: "done"; session_id: string | number };

export interface GenerateBody {
  segments: Omit<Segment, "id" | "sync_mode">[] | Segment[];
  excluded_track_ids: string[];
  genre_selection: string[];
  genre_threshold: number;
  source_playlist_ids: string[];
  garmin_activity_id: string | null;
}

/** Stream the generation, emitting each parsed SSE event to `onEvent`. Uses
 *  expo/fetch so `res.body` is a real ReadableStream on native. */
export async function generatePlaylist(body: GenerateBody, onEvent: (e: SSEEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await streamFetch(`${API_BASE}/api/playlist/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try { onEvent(JSON.parse(line.slice(6)) as SSEEvent); } catch { /* ignore keep-alive/partial */ }
    }
  }
}

/* ---- GET helpers (all OAuth-free — DB reads) ---- */
export const fetchGarminRuns = (q = "") =>
  fetchJson<GarminRunMeta[]>(`/api/playlist/garmin-runs?limit=50${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`);
export const fetchGarminRunDetail = (id: string) =>
  fetchJson<GarminRunDetail>(`/api/playlist/garmin-runs?id=${encodeURIComponent(id)}`);
export const fetchGenres = () =>
  fetchJson<{ genres: GenreBucket[]; total: number }>(`/api/playlist/genres`);

/* ---- Save to Spotify (POST create / PUT update, mirrors web handleSave) ---- */
export interface SpotifySaveBody {
  session_id: string | number;
  name?: string;
  track_ids: string[];
  song_assignments: Record<number, SongData[]>;
  playlist_id?: string | null;
}
export interface SpotifySaveResult {
  ok: boolean;
  status: number;
  playlist_id?: string;
  playlist_url?: string;
  error?: string;
}

/** Create (POST) or update (PUT, when `playlist_id` is set) the Spotify playlist
 *  for a generated session. Returns status so the UI can special-case 401
 *  ("Spotify not connected") vs other failures. Needs a server-side Spotify token. */
export async function saveSpotifyPlaylist(body: SpotifySaveBody): Promise<SpotifySaveResult> {
  const isUpdate = !!body.playlist_id;
  try {
    const res = await fetch(`${API_BASE}/api/playlist/spotify/create`, {
      method: isUpdate ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { playlist_id?: string; playlist_url?: string; error?: string };
    return { ok: res.ok, status: res.status, playlist_id: data.playlist_id, playlist_url: data.playlist_url, error: data.error };
  } catch (err) {
    return { ok: false, status: 0, error: String((err as Error)?.message ?? err) };
  }
}

/* ---- Track exclusion / blacklist ---- */
export async function postBlacklist(trackId: string): Promise<number> {
  try {
    const r = await fetch(`${API_BASE}/api/playlist/blacklist`, {
      method: "POST", headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ track_id: trackId }),
    });
    const j = (await r.json().catch(() => ({}))) as { count?: number };
    return Number(j.count) || 0;
  } catch { return 0; }
}
export async function confirmBlacklist(trackId: string, name: string, artistName: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/playlist/blacklist/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ track_id: trackId, name, artist_name: artistName }),
    });
  } catch { /* best effort */ }
}

/* ---- Live DJ (HR-driven auto-queue daemon; runs on a local host, reachable
 *      from the phone over Tailscale). The app only controls + monitors it:
 *      POST start/stop, GET status (the daemon writes /tmp/soma-dj-status.json),
 *      GET hr-defaults (avg resting / max HR from the last 90 days). ---- */
export type DjState = "stopped" | "starting" | "running" | "error";
export interface DjPlayHistoryItem {
  track_id: string; name: string; artist: string;
  track_bpm: number | null; target_bpm: number | null;
  started_at: number; duration_ms: number | null; image_url: string | null;
  status: "current" | "queued" | "played";
}
export interface DjQueueHistoryItem { name: string; artist: string; target_bpm: number | null; track_bpm: number | null; reason: string; ts: number }
export interface DjHrHistoryItem { ts: number; hr: number; target_bpm: number | null }
export interface DjStatus {
  state: DjState;
  hr?: number | null; hr_age_s?: number | null; target_bpm?: number | null; offset?: number;
  current_track?: string | null; current_track_id?: string | null; ms_remaining?: number | null;
  queued_track?: string | null; queued_track_id?: string | null;
  replace_reason?: string | null; no_queue_reason?: string | null; session_played_count?: number;
  allowed_track_count?: number | null; auto_detect?: boolean; context_name?: string | null;
  queue_history?: DjQueueHistoryItem[]; play_history?: DjPlayHistoryItem[]; hr_history?: DjHrHistoryItem[];
  error?: string; ts?: number;
}
export interface DjStartBody { hr_rest: number; hr_max: number; offset: number; genres: string[]; sources: string[] }
export interface DjControlResult { ok: boolean; status: number; pid?: number; alreadyRunning?: boolean; error?: string }

export const fetchDjStatus = () => fetchJson<DjStatus>(`/api/playlist/dj/status`);
export const fetchDjHrDefaults = () => fetchJson<{ hr_rest?: number | null; hr_max?: number | null }>(`/api/playlist/dj/hr-defaults`);

async function djPost(path: string, body?: unknown): Promise<DjControlResult> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const j = (await res.json().catch(() => ({}))) as { pid?: number; alreadyRunning?: boolean; error?: string };
    return { ok: res.ok, status: res.status, pid: j.pid, alreadyRunning: j.alreadyRunning, error: j.error };
  } catch (err) {
    return { ok: false, status: 0, error: String((err as Error)?.message ?? err) };
  }
}
export const startDj = (body: DjStartBody) => djPost(`/api/playlist/dj/start`, body);
export const stopDj = () => djPost(`/api/playlist/dj/stop`);
