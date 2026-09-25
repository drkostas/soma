/**
 * Reading weigh-ins out of Health Connect and handing them to soma.
 *
 * ⛔ THE PHONE REMEMBERS NOTHING, ON PURPOSE. Every run reads the whole history and posts all of
 * it. He asked for the backlog specifically, and a "since last time" marker would permanently miss
 * anything Arboleaf backfills with an old date, which is the case that matters: a month of weigh-ins
 * already exists inside its app and has never left. The server is idempotent on Health Connect's own
 * record id, so re-sending costs a request and changes nothing.
 *
 * ⚠️ NOTHING HERE CAN BE UNIT TESTED. The native module cannot load under this package's vitest,
 * which is why the pairing, the window and the record mapping live in `health-connect-weight.ts`
 * with tests, and this file is only plumbing.
 */
import {
  initialize,
  getGrantedPermissions,
  readRecords,
  requestPermission,
} from "react-native-health-connect";
import {
  readAllPages,
  readWithFallback,
  toReadings,
  type HcBodyFatRecord,
  type HcWeightRecord,
  type WindowSpan,
} from "./health-connect-weight";
import { API_BASE, AUTH_HEADERS } from "./api";
import { deviceTz } from "./meal-capture";

/**
 * Everything the weight sync needs, asked for in ONE sheet so granting it is one tap.
 *
 * Read-only, and only the two types a scale writes: soma never writes to Health Connect. The two extra
 * entries are what make it do what he asked for.
 *
 * - `ReadHealthDataHistory` is the backlog. Without it Health Connect refuses anything older than 30
 *   days before the first grant, and it refuses by failing the WHOLE read.
 * - `BackgroundAccessPermission` is "fully automated". Without it the 15-minute background task cannot
 *   read at all, and the sync only happens when the app is opened.
 */
export const WEIGHT_PERMISSIONS: Parameters<typeof requestPermission>[0] = [
  { accessType: "read", recordType: "Weight" },
  { accessType: "read", recordType: "BodyFat" },
  { accessType: "read", recordType: "ReadHealthDataHistory" },
  { accessType: "read", recordType: "BackgroundAccessPermission" },
];

export interface SyncOutcome {
  ok: boolean;
  /** Why not, in words worth showing. */
  why?: string;
  read?: number;
  stored?: number;
  already?: number;
  /** "full" when the whole history was asked for and not refused, "recent" when it fell back to 30 days. */
  span?: WindowSpan;
  /** Why the full history was refused, when it was. Usually that history access is not granted. */
  fullError?: string;
}

/**
 * Raise Health Connect's own permission sheet for everything above, and say what came back.
 *
 * ⚠️ `history` is NOT reported here, and it is not an oversight on our side. `react-native-health-connect`
 * 4.1.3 maps background access back to JavaScript but never maps `READ_HEALTH_DATA_HISTORY`, even when
 * it was granted. So the sync never trusts a flag for it and decides by behaviour instead, see
 * `readWithFallback`.
 */
export async function askForWeightAccess(): Promise<{ weight: boolean; background: boolean }> {
  if (!(await initialize())) return { weight: false, background: false };
  const granted = await requestPermission(WEIGHT_PERMISSIONS);
  const has = (r: string) => granted.some((g) => g.recordType === r && g.accessType === "read");
  return { weight: has("Weight"), background: has("BackgroundAccessPermission") };
}

/** Whether he has granted soma the reads. Checked rather than assumed, so a refusal is not an error. */
export async function hasWeightPermission(): Promise<boolean> {
  const granted = await getGrantedPermissions();
  const has = (r: string) =>
    granted.some((g) => g.recordType === r && g.accessType === "read");
  return has("Weight");
}

/**
 * Read everything and send it.
 *
 * Returns rather than throws: this runs from a background task where an exception is invisible, and
 * a reason recorded is worth more than a crash nobody sees.
 */
export async function syncWeights(): Promise<SyncOutcome> {
  try {
    const ready = await initialize();
    if (!ready) return { ok: false, why: "Health Connect is not available on this device" };
    if (!(await hasWeightPermission())) return { ok: false, why: "soma has not been granted Weight in Health Connect" };

    // Everything since 2015 if Health Connect allows it, otherwise the last 30 days, and every page of
    // either. Body fat is optional: a scale that does not measure it must not stop the weights.
    const { value, span, fullError } = await readWithFallback(async (window) => {
      const timeRangeFilter = { operator: "between" as const, ...window };
      const weights = await readAllPages((pageToken) => readRecords("Weight", { timeRangeFilter, pageToken }));
      const fats = await readAllPages((pageToken) => readRecords("BodyFat", { timeRangeFilter, pageToken }))
        .catch(() => []);
      return { weights, fats };
    });

    const readings = toReadings(value.weights as HcWeightRecord[], value.fats as HcBodyFatRecord[]);
    if (!readings.length) return { ok: true, read: 0, stored: 0, already: 0, span, fullError };

    const res = await fetch(`${API_BASE}/api/health/weight`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ readings, tz: deviceTz() }),
    });
    if (!res.ok) return { ok: false, why: `soma refused the batch (${res.status})`, read: readings.length, span };
    const body = (await res.json()) as { stored?: number; already?: number };
    return { ok: true, read: readings.length, stored: body.stored ?? 0, already: body.already ?? 0, span, fullError };
  } catch (e) {
    return { ok: false, why: (e as Error).message?.slice(0, 200) ?? "unknown failure" };
  }
}
