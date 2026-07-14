/**
 * Main-account Garmin helpers for the Strava bridge — list recent activities and
 * download the original FIT. Uses garmin-auth (DI token) like the soma-core crons.
 * The FIT is what gets forwarded to facterino.
 */
import AdmZip from "adm-zip";
import { GarminAuth, DBTokenStore, type GarminClient } from "garmin-auth";

const CONNECTAPI = "https://connectapi.garmin.com";
const NATIVE_UA = "GCM-Android-5.23";
const NATIVE_X_UA = "com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0";

export interface GarminActivity { activityId: number; activityName?: string; startTimeGMT?: string; [k: string]: unknown; }

/** Authenticated main-account Garmin client (DI token from the DB). */
export async function mainGarminClient(databaseUrl: string): Promise<GarminClient> {
  return new GarminAuth({ store: new DBTokenStore(databaseUrl) }).client();
}

/** Recent activities in [start, end] (YYYY-MM-DD). */
export async function getActivitiesByDate(client: GarminClient, start: string, end: string): Promise<GarminActivity[]> {
  const qs = new URLSearchParams({ startDate: start, endDate: end, start: "0", limit: "50" });
  const data = await client.connectapi<GarminActivity[]>(
    `/activitylist-service/activities/search/activities?${qs.toString()}`,
  );
  return data ?? [];
}

/** Full activity summary (for name / description / typeKey). */
export async function getActivity(client: GarminClient, activityId: number): Promise<Record<string, any>> {
  return (await client.connectapi<Record<string, any>>(`/activity-service/activity/${activityId}`)) ?? {};
}

/**
 * Download the original FIT for an activity. Garmin returns a zip; we extract the
 * .fit. garmin-auth's connectapi is JSON-only, so this does a raw authed fetch
 * with the DI bearer + native headers (same auth connectapi uses).
 */
export async function downloadFit(client: GarminClient, activityId: number): Promise<Uint8Array> {
  const resp = await fetch(`${CONNECTAPI}/download-service/files/activity/${activityId}`, {
    headers: {
      Authorization: `Bearer ${client.di_token}`,
      "User-Agent": NATIVE_UA,
      "X-Garmin-User-Agent": NATIVE_X_UA,
      "NK": "NT",
    },
  });
  if (!resp.ok) throw new Error(`FIT download ${activityId} → ${resp.status}`);
  const zipBytes = Buffer.from(await resp.arrayBuffer());
  const zip = new AdmZip(zipBytes);
  const entry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith(".fit"));
  if (!entry) throw new Error(`no .fit in download zip for ${activityId}`);
  return entry.getData();
}
