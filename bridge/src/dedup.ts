/**
 * Strava bridge dedup — TS port of the runtime-independent core of
 * strava_bridge_push.py. Stage 3 (#185).
 *
 * soma has no Strava upload API (paid + intermediary-banned), so a finalized
 * Garmin activity reaches Strava via the facterino bridge account (uploading its
 * FIT there makes Garmin forward it to Strava for free). This module owns only
 * the SAFE dedup decision (which recent Garmin activities are not yet on Strava);
 * the facterino forward is API-portable, but detecting the new Strava id and
 * setting title/description/image drive the Strava web page via a browser, which
 * cannot run on a Vercel serverless cron — see the runtime note in the PR.
 *
 * Dedup: a Garmin activity is "missed" only if it is NOT in strava_bridge_uploads
 * (the garmin_activity_id -> strava_activity_id ledger) AND its id does not appear
 * among the stored Strava external_ids. Both guard against a duplicate Strava push.
 */

export const LOOKBACK_DAYS = 3;

export interface GarminActivitySummary {
  activityId: number;
  activityName?: string;
  [k: string]: unknown;
}

/**
 * Recent Garmin activities not yet on Strava. Pure port of `_missed`'s filter:
 * exclude anything already in the bridge ledger, and anything whose id appears in
 * the concatenated Strava external_ids (a substring test, faithful to the Python).
 */
export function findMissed(
  activities: GarminActivitySummary[],
  bridgedIds: Set<number>,
  externalIdsJoined: string,
): GarminActivitySummary[] {
  return activities.filter(
    (a) => !bridgedIds.has(a.activityId) && !externalIdsJoined.includes(String(a.activityId)),
  );
}

/** YYYY-MM-DD for the lookback window start, given "today". */
export function lookbackStart(today: Date = new Date(), days = LOOKBACK_DAYS): string {
  return new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}
