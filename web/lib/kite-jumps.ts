/**
 * Kiteboarding jump extraction from Garmin/Surfr FIT files — TS port of
 * sync/src/kite_jumps.py. Reads Surfr's Connect IQ per-record developer fields
 * (heights, jump, jumpchart, timestamps) via @garmin/fitsdk, groups them into
 * jumps (peak per run), attaches flight-path GPS windows, and enriches the top
 * jumps from Surfr's Strava description. Stage: sync cutover (#187).
 *
 * Heights stay in meters; speeds are exposed in knots (project convention).
 */
import { Decoder, Stream } from "@garmin/fitsdk";
import { unzipSync } from "fflate";
import type { GarminClient } from "garmin-auth";
import type { QueryFn } from "./db";

const KMH_TO_KNOTS = 1 / 1.852;
const MS_TO_KNOTS = 3.6 / 1.852;
const JUMP_GAP_S = 4;
const MIN_JUMP_M = 0.3;
const SURFR_MATCH_TOL_M = 0.5;
const PATH_LEAD_S = 3;

// Python round() parity: toFixed matches except exact binary ties.
const r = (x: number, n: number): number => {
  const m = 10 ** n;
  const twice = x * 2 * m;
  if (Number.isInteger(twice) && Math.abs(twice) % 2 === 1) {
    const floor = Math.floor(x * m);
    return (floor % 2 === 0 ? floor : floor + 1) / m;
  }
  return Number(x.toFixed(n));
};

const SURFR_JUMP_RE = /Nr\.\s*(\d+)\s*,\s*H:\s*([\d.]+)\s*m\s*,\s*A:\s*([\d.]+)\s*sec\.?\s*,\s*D:\s*(\d+)\s*m\s*,\s*Max\s*Speed:\s*(\d+)\s*Km\/h/gi;
const SURFR_SPOT_RE = /Spot:\s*'([^']+)'/i;
const SURFR_MAXAIR_RE = /Max\.?\s*Airtime:\s*([\d.]+)\s*sec/i;

function semicirclesToDeg(v: number | null | undefined): number | null {
  return v == null ? null : v * (180 / 2 ** 31);
}

interface JumpSample {
  time: Date;
  height_m: number;
  lat: number | null;
  lng: number | null;
  speed_ms: number | null;
  jump_tuple: number[] | null;
  jumpchart: number[] | null;
  jump_ts: number[] | null;
}

export interface Jump {
  height_m: number;
  lat: number | null;
  lng: number | null;
  time: string;
  airtime_s?: number;
  distance_m?: number;
  approach_speed_kn?: number;
  trajectory_m?: number[];
  takeoff_ts?: number;
  landing_ts?: number;
  rank?: number;
  surfr_height_m?: number;
  path?: Array<[number, number, number]>;
}

/** Decode a FIT file; return record messages + a developer-field name→index map. */
function decodeRecords(bytes: Uint8Array): { records: any[]; devIdx: Record<string, number> } {
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  const { messages } = decoder.read({ convertDateTimesToDates: true });
  const fds = (messages.fieldDescriptionMesgs || []) as any[];
  // fitsdk keys record developerFields by the field_description definition order.
  const devIdx: Record<string, number> = {};
  fds.forEach((f, i) => { devIdx[f.fieldName] = i; });
  return { records: (messages.recordMesgs || []) as any[], devIdx };
}

/** Per-record jump samples (heights > MIN). Port of _read_jump_samples. */
function readJumpSamples(records: any[], devIdx: Record<string, number>): JumpSample[] {
  const iH = devIdx.heights, iJ = devIdx.jump, iC = devIdx.jumpchart, iT = devIdx.timestamps;
  const samples: JumpSample[] = [];
  for (const rec of records) {
    const dev = rec.developerFields || {};
    const h = dev[iH];
    if (typeof h === "number" && h && h > MIN_JUMP_M) {
      samples.push({
        time: rec.timestamp,
        height_m: Number(h),
        lat: semicirclesToDeg(rec.positionLat),
        lng: semicirclesToDeg(rec.positionLong),
        speed_ms: rec.enhancedSpeed ?? null,
        jump_tuple: (dev[iJ] as number[]) ?? null,
        jumpchart: (dev[iC] as number[]) ?? null,
        jump_ts: (dev[iT] as number[]) ?? null,
      });
    }
  }
  return samples;
}

/** Group time-ordered samples into jumps (peak per run), biggest-first. Pure. */
export function groupJumps(samples: JumpSample[]): Jump[] {
  const groups: JumpSample[][] = [];
  let cur: JumpSample[] = [];
  for (const s of samples) {
    if (!cur.length || (s.time.getTime() - cur[cur.length - 1].time.getTime()) / 1000 <= JUMP_GAP_S) {
      cur.push(s);
    } else {
      groups.push(cur);
      cur = [s];
    }
  }
  if (cur.length) groups.push(cur);

  const jumps: Jump[] = [];
  for (const g of groups) {
    const peak = g.reduce((a, b) => (b.height_m > a.height_m ? b : a));
    const jump: Jump = {
      height_m: r(peak.height_m, 2),
      lat: peak.lat != null ? r(peak.lat, 6) : null,
      lng: peak.lng != null ? r(peak.lng, 6) : null,
      time: peak.time.toISOString().slice(0, 19),
    };
    const tup = peak.jump_tuple;
    if (tup && tup.length >= 4 && tup[0] && tup[0] > 0) {
      jump.airtime_s = r(Number(tup[1]), 2);
      jump.distance_m = r(Number(tup[2]), 1);
      jump.approach_speed_kn = r(Number(tup[3]) * MS_TO_KNOTS, 1);
    } else if (peak.speed_ms) {
      jump.approach_speed_kn = r(peak.speed_ms * MS_TO_KNOTS, 1);
    }
    const chart = peak.jumpchart;
    if (chart && chart.length) {
      const vals = chart.map((v) => v / 100);
      let last = -1;
      vals.forEach((v, i) => { if (v > 0) last = i; });
      if (last >= 0) {
        jump.trajectory_m = [0.0, ...vals.slice(1, last + 1).map((v) => r(v, 2)), 0.0];
      }
    }
    const ts = peak.jump_ts;
    if (ts && ts.length >= 3 && ts[1] && ts[2]) {
      jump.takeoff_ts = Math.trunc(ts[1]);
      jump.landing_ts = Math.trunc(ts[2]);
    }
    jumps.push(jump);
  }
  jumps.sort((a, b) => b.height_m - a.height_m);
  return jumps;
}

/** (unix_ts, lat, lng) for every GPS-fixed record. Port of _read_track. */
function readTrack(records: any[]): Array<[number, number, number]> {
  const track: Array<[number, number, number]> = [];
  for (const rec of records) {
    const lat = semicirclesToDeg(rec.positionLat);
    const lng = semicirclesToDeg(rec.positionLong);
    const t: Date | undefined = rec.timestamp;
    if (lat && lng && t != null) track.push([Math.trunc(t.getTime() / 1000), lat, lng]);
  }
  return track;
}

/** Attach the flight-window GPS path to the top N jumps. Port of attach_jump_paths. */
export function attachJumpPaths(jumps: Jump[], track: Array<[number, number, number]>, topN = 3): void {
  if (!track.length) return;
  for (const j of jumps.slice(0, topN)) {
    const t0 = j.takeoff_ts, t1 = j.landing_ts;
    if (!t0 || !t1) continue;
    const window: Array<[number, number, number]> = [];
    for (const [ts, lat, lng] of track) {
      if (t0 - PATH_LEAD_S <= ts && ts <= t1 + PATH_LEAD_S) window.push([ts - t0, r(lat, 6), r(lng, 6)]);
    }
    if (window.length >= 3) j.path = window;
  }
}

export interface SurfrJump { rank: number; height_m: number; airtime_s: number; distance_m: number; approach_speed_kn: number; }

/** Parse Surfr's 'Top 5 Jumps' block. Port of parse_surfr_description. */
export function parseSurfrDescription(description: string | null | undefined): SurfrJump[] {
  if (!description) return [];
  const out: SurfrJump[] = [];
  for (const m of description.matchAll(SURFR_JUMP_RE)) {
    out.push({
      rank: parseInt(m[1], 10),
      height_m: parseFloat(m[2]),
      airtime_s: parseFloat(m[3]),
      distance_m: parseInt(m[4], 10),
      approach_speed_kn: r(parseInt(m[5], 10) * KMH_TO_KNOTS, 1),
    });
  }
  return out;
}

export interface KitePayload { jumps: Jump[]; summary: Record<string, any>; }

/** Rank + Surfr-enrich jumps and compute the session summary. Port of assemble_jumps. */
export function assembleJumps(jumps: Jump[], surfrDescription: string | null = null): KitePayload {
  const surfr = parseSurfrDescription(surfrDescription);
  jumps.forEach((j, i) => {
    j.rank = i + 1;
    const s = surfr.find((x) => x.rank === i + 1);
    if (s && Math.abs(s.height_m - j.height_m) <= SURFR_MATCH_TOL_M) {
      if (j.airtime_s === undefined) j.airtime_s = s.airtime_s;
      if (j.distance_m === undefined) j.distance_m = s.distance_m;
      j.surfr_height_m = s.height_m;
    }
  });

  let spot: string | null = null;
  let surfrMaxAir: number | null = null;
  if (surfrDescription) {
    const ms = SURFR_SPOT_RE.exec(surfrDescription);
    if (ms) spot = ms[1];
    const ma = SURFR_MAXAIR_RE.exec(surfrDescription);
    if (ma) surfrMaxAir = parseFloat(ma[1]);
  }
  const airtimes = jumps.filter((j) => j.airtime_s).map((j) => j.airtime_s as number);
  const maxAirtime = airtimes.length ? Math.max(...airtimes) : surfrMaxAir;

  const heights = jumps.map((j) => j.height_m);
  const summary = {
    jump_count: jumps.length,
    max_height_m: heights.length ? Math.max(...heights) : null,
    avg_height_m: heights.length ? r(heights.reduce((a, b) => a + b, 0) / heights.length, 2) : null,
    total_height_m: heights.length ? r(heights.reduce((a, b) => a + b, 0), 1) : null,
    max_airtime_s: maxAirtime,
    spot,
    surfr_matched: surfr.length > 0,
  };
  return { jumps, summary };
}

/** Full extraction from FIT bytes + optional Surfr text. Port of build_kite_jumps. */
export function buildKiteJumps(fitBytes: Uint8Array, surfrDescription: string | null = null): KitePayload {
  const { records, devIdx } = decodeRecords(fitBytes);
  const jumps = groupJumps(readJumpSamples(records, devIdx));
  attachJumpPaths(jumps, readTrack(records));
  return assembleJumps(jumps, surfrDescription);
}

// ---- DB + download orchestration (wiring) ----

/**
 * Find the Surfr-exported Strava activity within 15 min of this Garmin start and
 * return its corrected description. Port of _surfr_description. (strava_raw_data
 * is currently stale — this returns null in practice, and the native CIQ jump
 * data is Surfr-accurate anyway.)
 */
export async function surfrDescription(sql: QueryFn, startGmt: string | null): Promise<string | null> {
  if (!startGmt) return null;
  const rows = await sql`
    SELECT raw_json->>'description' AS description
    FROM strava_raw_data
    WHERE jsonb_typeof(raw_json) = 'object'
      AND raw_json->>'name' ILIKE '%surfr%'
      AND raw_json->>'description' ILIKE '%Top%Jump%'
      AND abs(EXTRACT(EPOCH FROM ((raw_json->>'start_date')::timestamptz - (${startGmt} || ' UTC')::timestamptz))) < 900
    ORDER BY abs(EXTRACT(EPOCH FROM ((raw_json->>'start_date')::timestamptz - (${startGmt} || ' UTC')::timestamptz)))
    LIMIT 1`;
  return rows.length ? (rows[0].description ?? null) : null;
}

/** Download the ORIGINAL activity FIT (a zip) and return the .fit bytes. */
export async function downloadFit(client: GarminClient, activityId: number): Promise<Uint8Array> {
  const zipBytes = await client.getBytes(`/download-service/files/activity/${activityId}`);
  const files = unzipSync(zipBytes);
  const fitName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".fit"));
  if (!fitName) throw new Error(`No .fit in download zip for activity ${activityId}`);
  return files[fitName];
}

/**
 * If the activity is a kiteboarding session, extract its per-jump data and store
 * it under endpoint 'kite_jumps'. Port of store_kite_jumps_for_activity +
 * _maybe_extract_kite_jumps. Returns the payload, or null if not a kite activity.
 * DB + a Garmin FIT download. Guarded by the caller so it never breaks ingest.
 */
export async function extractKiteJumpsForActivity(
  sql: QueryFn, client: GarminClient, activityId: number, typeKey: string | null, startGmt: string | null,
): Promise<KitePayload | null> {
  if (!typeKey || !typeKey.toLowerCase().includes("kite")) return null;
  // Dedup: a completed activity's jumps never change, so skip the FIT download
  // if we've already extracted them (mirrors syncActivityDetails' 'details' skip).
  const seen = await sql`
    SELECT 1 FROM garmin_activity_raw WHERE activity_id = ${activityId} AND endpoint_name = 'kite_jumps' LIMIT 1`;
  if (seen.length) return null;
  const fitBytes = await downloadFit(client, activityId);
  const desc = await surfrDescription(sql, startGmt);
  const payload = buildKiteJumps(fitBytes, desc);
  await sql`
    INSERT INTO garmin_activity_raw (activity_id, endpoint_name, raw_json, synced_at)
    VALUES (${activityId}, 'kite_jumps', ${JSON.stringify(payload)}::jsonb, NOW())
    ON CONFLICT (activity_id, endpoint_name)
    DO UPDATE SET raw_json = EXCLUDED.raw_json, synced_at = NOW()`;
  return payload;
}
