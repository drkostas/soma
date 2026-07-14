/**
 * Notification orchestration — TS port of pipeline._backfill_telegram_notifications.
 * Sends Telegram + push for recent workouts not yet notified, deduped via
 * activity_sync_log (destination='telegram') so it never double-notifies alongside
 * the Python pipeline. Stage 4 (#186).
 */
import type { QueryFn } from "./db";
import { sendImage, getTelegramConfig } from "./notify-telegram";
import { sendPush } from "./notify-push";

const SOMA = process.env.SOMA_WEB_URL || "https://soma.gkos.dev";

async function logSent(sql: QueryFn, sourceId: string, destination: string): Promise<void> {
  await sql`
    INSERT INTO activity_sync_log (source_platform, source_id, destination, destination_id, rule_id, status, error_message)
    VALUES ('hevy', ${sourceId}, ${destination}, ${destination}, NULL, 'sent', NULL)`;
}

export interface NotifyResult { telegram: number; push: number; }

/**
 * Notify recent workouts (last 3 days) not yet Telegram-notified. Fetches the
 * workout card image, sends it (💪 caption), sends a push, and logs to the ledger.
 * Port of _backfill_telegram_notifications, plus web-push.
 */
export async function notifyPendingWorkouts(sql: QueryFn): Promise<NotifyResult> {
  const { token } = await getTelegramConfig(sql);
  const rows = await sql`
    SELECT we.hevy_id, we.hevy_title, we.workout_date::text AS workout_date, h.raw_json
    FROM workout_enrichment we
    JOIN hevy_raw_data h ON h.hevy_id = we.hevy_id AND h.endpoint_name = 'workout'
    WHERE we.status IN ('enriched', 'uploaded')
      AND we.hevy_id NOT IN (
        SELECT source_id FROM activity_sync_log
        WHERE source_platform = 'hevy' AND destination = 'telegram' AND status = 'sent'
      )
      AND we.workout_date >= CURRENT_DATE - INTERVAL '3 days'
    ORDER BY we.workout_date DESC
    LIMIT 5`;

  let telegram = 0, push = 0;
  for (const r of rows) {
    const raw = typeof r.raw_json === "string" ? JSON.parse(r.raw_json) : r.raw_json;
    const title: string = raw?.title || r.hevy_title || "Workout";
    const date = String(r.workout_date).slice(0, 10);

    // Telegram (only if configured — matches the Python gate).
    if (token) {
      try {
        const resp = await fetch(`${SOMA}/api/workout/${r.hevy_id}/image`);
        if (resp.ok) {
          const bytes = new Uint8Array(await resp.arrayBuffer());
          if (await sendImage(sql, bytes, `💪 ${title} — ${date}`, `${r.hevy_id}.png`)) {
            await logSent(sql, r.hevy_id, "telegram");
            telegram += 1;
          }
        }
      } catch (e) { console.warn(`notify telegram ${r.hevy_id}: ${(e as Error).message}`); }
    }

    // Push (independent dedup so a Telegram-only failure still lets push retry).
    const alreadyPushed = await sql`
      SELECT 1 FROM activity_sync_log
      WHERE source_platform='hevy' AND source_id=${r.hevy_id} AND destination='push' AND status='sent' LIMIT 1`;
    if (!alreadyPushed.length) {
      const n = await sendPush(sql, { title: `💪 ${title}`, body: `Synced — ${date}`, url: `/workouts`, eventType: "sync_workout" });
      if (n > 0) { await logSent(sql, r.hevy_id, "push"); push += 1; }
    }
  }
  return { telegram, push };
}
