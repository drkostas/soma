/**
 * Saying what you ate, from the phone.
 *
 * ⚠️ `slotForHour` is a deliberate second copy of `web/lib/meal-capture.ts`. The app cannot import
 * from the web package, and the two widgets carry a third and fourth copy in Kotlin and Swift.
 * The boundaries are 11 / 16 / 21 and all four must agree, so change them together or a sentence
 * lands in a different slot depending on where it was typed.
 */
import { API_BASE, AUTH_HEADERS } from "./api";
import type { CaptureCard } from "./capture-status";

export type CaptureMode = "log" | "calibrate";
/** The five states a capture moves through, mirroring `web/lib/meal-capture.ts`. */
export type CaptureStatus = "captured" | "running" | "ready" | "logged" | "failed";
export interface CaptureMessage { role: "user" | "agent"; text: string; image: string | null; at: string }

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
): Promise<number | null> {
  const res = await fetch(`${API_BASE}/api/nutrition/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
    body: JSON.stringify({ text: text.trim(), image, mode }),
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

/** Upload a photo picked on the phone. Returns the path the agent will read, or null. */
export async function uploadCapturePhoto(uri: string): Promise<string | null> {
  const form = new FormData();
  form.append("file", { uri, name: "meal.jpg", type: "image/jpeg" } as unknown as Blob);
  try {
    const res = await fetch(`${API_BASE}/api/nutrition/capture/upload`, {
      method: "POST", headers: { ...AUTH_HEADERS }, body: form,
    });
    if (!res.ok) return null;
    return ((await res.json()) as { path: string }).path;
  } catch {
    return null;
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
export async function replyToCapture(id: number, text: string, image: string | null): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/nutrition/capture`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ id, text: text.trim(), image }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
