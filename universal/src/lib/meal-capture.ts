/**
 * Saying what you ate, from the phone.
 *
 * ⚠️ `slotForHour` is a deliberate second copy of `web/lib/meal-capture.ts`. The app cannot import
 * from the web package, and the two widgets carry a third and fourth copy in Kotlin and Swift.
 * The boundaries are 11 / 16 / 21 and all four must agree, so change them together or a sentence
 * lands in a different slot depending on where it was typed.
 */
import * as FileSystem from "expo-file-system/legacy";
import { API_BASE, AUTH_HEADERS } from "./api";
import type { CaptureCard } from "./capture-status";

export type CaptureMode = "log" | "calibrate";
/** The five states a capture moves through, mirroring `web/lib/meal-capture.ts`. */
export type CaptureStatus = "captured" | "running" | "ready" | "logged" | "failed";
export interface CaptureMessage {
  role: "user" | "agent"; text: string; image: string | null; at: string;
  audio?: string | null; heard?: string | null;
}

export function slotForHour(h: number): string {
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 21) return "dinner";
  return "pre_sleep";
}

/** The acknowledgement. It must not claim the meal is there yet, because it is not. */
export function captureAck(mode: CaptureMode): string {
  return mode === "log" ? "Got it, logging it now." : "Got it, I'll have it ready to check.";
}

export async function captureMeal(
  text: string, image: string | null, mode: CaptureMode,
  spoken: { audio?: string | null; heard?: string | null } = {},
): Promise<number | null> {
  const res = await fetch(`${API_BASE}/api/nutrition/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
    body: JSON.stringify({
      text: text.trim(), image, mode,
      audio: spoken.audio ?? null, heard: spoken.heard ?? null,
    }),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { id: number }).id;
}

export async function getCaptureMode(): Promise<CaptureMode> {
  try {
    const res = await fetch(`${API_BASE}/api/nutrition/capture/mode`, { headers: AUTH_HEADERS });
    if (!res.ok) return "log";
    const d = (await res.json()) as { mode?: string };
    return d.mode === "calibrate" ? "calibrate" : "log";
  } catch {
    return "log";
  }
}

export async function setCaptureMode(mode: CaptureMode): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/nutrition/capture/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ mode }),
    });
  } catch {
    // Remembering the choice is a convenience, never a blocker.
  }
}

/** Either the stored file's reference, or the reason there isn't one. */
export type PhotoUpload = { ref: string } | { error: string };

/** The server is authoritative; this exists so the phone can say the same thing without sending
 *  ten megabytes to find out. Keep it equal to `MAX_BYTES` in `web/lib/capture-media.ts`. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

/**
 * Upload a photo picked on the phone.
 *
 * ⛔ THE FILE IS READ HERE, NOT HANDED TO REACT NATIVE AS A URI. The old version appended
 * `{uri, name, type}` to a FormData and let RN's multipart uploader open the file. When it cannot,
 * the `fetch` throws on the phone, so the request never leaves it: prod's logs for the whole
 * afternoon held no upload at all, while the box said "That photo would not upload". Reading the
 * bytes ourselves takes RN's URI handling out of the path entirely.
 *
 * It also returns the reason on failure, because a 413, a 415, an unreadable file and a dead
 * network all used to read the same.
 */
export async function uploadCapturePhoto(uri: string): Promise<PhotoUpload> {
  // The picker hands back a JPEG on both platforms; the server checks the bytes' size and type.
  const mime = /\.png$/i.test(uri) ? "image/png" : /\.webp$/i.test(uri) ? "image/webp" : "image/jpeg";
  return await uploadCaptureFile(uri, mime, "photo");
}

/**
 * Upload the recording of him speaking, so a real model on the Mac can read it.
 *
 * The phone's own recogniser has already filled the box by the time this runs. This is the copy the
 * worker transcribes properly, and it stays in the database so a wrong reading can be compared
 * against what was actually said instead of being the only record of the meal.
 *
 * Android persists 16 kHz mono PCM, which is 32 KB a second, so the 3 MB ceiling is about a minute
 * and a half of talking. Describing a plate takes fifteen seconds.
 */
export async function uploadCaptureAudio(uri: string): Promise<PhotoUpload> {
  const mime = /\.caf$/i.test(uri) ? "audio/x-caf" : /\.m4a$/i.test(uri) ? "audio/m4a" : "audio/wav";
  return await uploadCaptureFile(uri, mime, "recording");
}

async function uploadCaptureFile(uri: string, mime: string, noun: string): Promise<PhotoUpload> {
  let base64: string;
  try {
    base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  } catch (e) {
    return { error: `soma could not open that ${noun} (${(e as Error).message ?? "unreadable"}).` };
  }
  if (!base64) return { error: `That ${noun} came through empty.` };
  // ⛔ Check the size HERE. A body over about 10 MB is truncated before the route ever sees it, and
  // the owner gets "Unterminated string in JSON at position 10485555" instead of a size. Base64
  // carries three bytes in four characters, so this is the real file's size.
  const byteSize = Math.floor((base64.length * 3) / 4);
  if (byteSize > MAX_UPLOAD_BYTES) {
    return { error: `That ${noun} is ${(byteSize / 1024 / 1024).toFixed(1)} MB and the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` };
  }
  try {
    const res = await fetch(`${API_BASE}/api/nutrition/capture/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ mime, base64 }),
    });
    const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
    if (!res.ok) return { error: body.error ?? `The upload failed (${res.status}).` };
    if (!body.path) return { error: `The ${noun} came back without a reference.` };
    return { ref: body.path };
  } catch (e) {
    return { error: `soma could not reach the server (${(e as Error).message ?? "no connection"}).` };
  }
}

/** Today's captures and where each has got to, for the status strip. */
export async function fetchRecentCaptures(date?: string): Promise<CaptureCard[]> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  try {
    const res = await fetch(`${API_BASE}/api/nutrition/capture/recent${qs}`, { headers: AUTH_HEADERS });
    if (!res.ok) return [];
    return ((await res.json()) as { captures?: CaptureCard[] }).captures ?? [];
  } catch {
    // A strip that cannot load says nothing, rather than claiming the captures are gone.
    return [];
  }
}

/** Reply to a capture: text, a photo, or both. The whole thread is re-run, and a meal already
 *  logged is replaced rather than joined by a second one. */
export async function replyToCapture(
  id: number, text: string, image: string | null,
  spoken: { audio?: string | null; heard?: string | null } = {},
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/nutrition/capture`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({
        id, text: text.trim(), image,
        audio: spoken.audio ?? null, heard: spoken.heard ?? null,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The food words to expect, for the recogniser. Empty on failure: hints are a help, not a gate. */
export async function fetchVocabulary(): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/api/nutrition/capture/vocabulary`, { headers: AUTH_HEADERS });
    if (!res.ok) return [];
    const d = (await res.json()) as { words?: string[] };
    return Array.isArray(d.words) ? d.words : [];
  } catch {
    return [];
  }
}
