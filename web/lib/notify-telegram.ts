/**
 * Telegram notifications — TS port of sync/src/telegram_notify.py senders.
 * Sends an activity's share image with an activity-type-aware caption. soma card
 * images are RGBA; Telegram's sendPhoto rejects those (IMAGE_PROCESS_FAILED), so
 * we flatten RGBA→RGB onto the app's dark background before uploading. Stage 4 (#186).
 */
import { PNG } from "pngjs";
import type { QueryFn } from "./db";
import { activityEmoji } from "./activity-notify";

const API_BASE = (token: string) => `https://api.telegram.org/bot${token}`;
const SOMA = process.env.SOMA_WEB_URL || "https://soma.gkos.dev";

/** Telegram bot creds: DB-first (platform_credentials 'telegram'), then env. */
export async function getTelegramConfig(sql: QueryFn): Promise<{ token?: string; chatId?: string }> {
  const rows = await sql`SELECT credentials FROM platform_credentials WHERE platform = 'telegram'`;
  const c = rows[0]?.credentials;
  const creds = typeof c === "string" ? JSON.parse(c) : c;
  if (creds?.bot_token && creds?.chat_id) return { token: creds.bot_token, chatId: creds.chat_id };
  return { token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID };
}

/** Flatten an RGBA PNG onto the app dark background (9,9,11) → opaque RGB PNG. */
export function stripAlpha(pngBytes: Uint8Array): Uint8Array {
  const src = PNG.sync.read(Buffer.from(pngBytes));
  const out = new PNG({ width: src.width, height: src.height });
  const [br, bg, bb] = [9, 9, 11];
  for (let i = 0; i < src.data.length; i += 4) {
    const a = src.data[i + 3] / 255;
    out.data[i] = Math.round(src.data[i] * a + br * (1 - a));
    out.data[i + 1] = Math.round(src.data[i + 1] * a + bg * (1 - a));
    out.data[i + 2] = Math.round(src.data[i + 2] * a + bb * (1 - a));
    out.data[i + 3] = 255;
  }
  // colorType 2 (RGB) in the write options drops the (now-opaque) alpha channel.
  return PNG.sync.write(out, { colorType: 2 });
}

/** Send an image (PNG bytes) to the configured Telegram chat via sendPhoto. */
export async function sendImage(
  sql: QueryFn, imageBytes: Uint8Array, caption = "", filename = "workout.png",
): Promise<boolean> {
  const { token, chatId } = await getTelegramConfig(sql);
  if (!token || !chatId) return false;
  if (imageBytes.length < 4 || imageBytes[0] !== 0x89 || imageBytes[1] !== 0x50) {
    console.warn(`Telegram: not a PNG (${imageBytes.length} bytes)`);
    return false;
  }
  let bytes = imageBytes;
  try { bytes = stripAlpha(imageBytes); } catch (e) { console.warn(`Telegram alpha-strip failed: ${(e as Error).message}`); }

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append("photo", new Blob([bytes as unknown as BlobPart], { type: "image/png" }), filename);
  try {
    const resp = await fetch(`${API_BASE(token)}/sendPhoto`, { method: "POST", body: form });
    const result = await resp.json().catch(() => ({}));
    if (result.ok) return true;
    console.warn(`Telegram sendPhoto ok=false: ${JSON.stringify(result).slice(0, 200)}`);
    return false;
  } catch (e) { console.warn(`Telegram send failed: ${(e as Error).message}`); return false; }
}

/** Fetch an activity's share image from soma and send it with a type-aware caption. */
export async function sendActivityImage(
  sql: QueryFn, garminActivityId: string | number, title: string, activityDate: string,
  activityType?: string | null,
): Promise<boolean> {
  try {
    const resp = await fetch(`${SOMA}/api/activity/${garminActivityId}/image`);
    if (!resp.ok) return false;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const caption = `${activityEmoji(activityType)} ${title} — ${activityDate}`;
    return sendImage(sql, bytes, caption, `activity_${garminActivityId}.png`);
  } catch (e) { console.warn(`Telegram activity image failed: ${(e as Error).message}`); return false; }
}
