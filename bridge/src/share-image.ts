/**
 * The Strava photo for a bridged Garmin activity: the Hevy-enriched workout card when
 * workout_enrichment links the activity to a Hevy workout, else the generic activity card.
 * Shared by the bridge (main.ts) and the re-finalize entrypoint (refinalize.ts) so both pick
 * the same card — refinalize used to fetch the activity card unconditionally and replaced a
 * strength workout's gym card with a run-style card (soma#804).
 *
 * A miss used to be silent: the 2026-09-07 "Upper" push reached Strava without its photo and
 * the log said only "pushed". Now: three attempts (the card render on Vercel can cold-start
 * past a single fetch), a 60 s timeout each, and the outcome is returned as a note the caller
 * logs and surfaces (NO_PHOTO in the bridge RESULT line).
 */
import { writeFile } from "node:fs/promises";
import type { Pool } from "pg";

const SOMA = process.env.SOMA_WEB_URL || process.env.SOMA_BASE_URL || "https://soma.gkos.dev";

export async function shareImageUrl(db: Pool, gid: number): Promise<{ url: string; kind: "workout" | "activity" }> {
  const r = await db.query("SELECT hevy_id FROM workout_enrichment WHERE garmin_activity_id=$1 ORDER BY processed_at DESC LIMIT 1", [gid]);
  const hevyId = r.rows[0]?.hevy_id as string | undefined;
  return hevyId
    ? { url: `${SOMA}/api/workout/${hevyId}/image`, kind: "workout" }
    : { url: `${SOMA}/api/activity/${gid}/image`, kind: "activity" };
}

export async function imagePathFor(db: Pool, gid: number, prefix = "bridge"): Promise<{ path: string | null; note: string; kind: "workout" | "activity" }> {
  const { url, kind } = await shareImageUrl(db, gid);
  let note = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!resp.ok) { note = `image http ${resp.status}`; }
      else {
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length < 1000) { note = `image too small (${buf.length} B)`; }
        else {
          const path = `/tmp/${prefix}_${gid}.png`;
          await writeFile(path, buf);
          console.log(`image ok for ${gid}: ${buf.length} B from ${url} (attempt ${attempt})`);
          return { path, note: "", kind };
        }
      }
    } catch (e) { note = `image fetch failed: ${(e as Error).message.slice(0, 60)}`; }
    console.log(`image attempt ${attempt} for ${gid}: ${note}`);
    if (attempt < 3) await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
  return { path: null, note, kind };
}
