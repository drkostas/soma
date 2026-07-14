/**
 * Web Push notifications — TS port of sync/src/push_notify.py using the web-push
 * npm package. Checks preferences, sends to all subscribed browsers, prunes
 * expired (410/404) subscriptions. Stage 4 (#186).
 */
import webpush from "web-push";
import type { QueryFn } from "./db";

export type PushEvent = "sync" | "sync_workout" | "sync_run" | "sync_error" | "milestone" | "playlist_ready";

const PREF_KEY: Partial<Record<PushEvent, string>> = {
  sync_workout: "on_sync_workout",
  sync_run: "on_sync_run",
  sync_error: "on_sync_error",
  milestone: "on_milestone",
  playlist_ready: "on_playlist_ready",
};

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

/** Send a push notification to all subscribed browsers. Returns the success count. */
export async function sendPush(
  sql: QueryFn,
  o: { title: string; body: string; url?: string; eventType?: PushEvent; icon?: string },
): Promise<number> {
  if (!pushConfigured()) return 0;

  const prefRows = await sql`
    SELECT enabled, on_sync_workout, on_sync_run, on_sync_error, on_milestone, on_playlist_ready
    FROM notification_preferences WHERE id = 1`;
  const prefs = prefRows[0];
  if (!prefs || !prefs.enabled) return 0;
  const key = PREF_KEY[o.eventType ?? "sync"];
  if (key && prefs[key] === false) return 0;

  const subs = await sql`SELECT id, endpoint, p256dh, auth FROM push_subscriptions`;
  if (!subs.length) return 0;

  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  const payload = JSON.stringify({
    title: o.title, body: o.body, url: o.url ?? "/",
    icon: o.icon ?? "/icons/icon-192x192.png", event_type: o.eventType ?? "sync",
  });

  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      await sql`UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = ${s.id}`;
      sent += 1;
    } catch (e: any) {
      const code = e?.statusCode;
      if (code === 410 || code === 404) await sql`DELETE FROM push_subscriptions WHERE id = ${s.id}`;
      else console.warn(`Push failed for sub ${s.id}: ${e?.message ?? e}`);
    }
  }
  return sent;
}
