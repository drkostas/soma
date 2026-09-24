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
  type Permission,
} from "react-native-health-connect";
import { historyWindow, toReadings, type HcBodyFatRecord, type HcWeightRecord } from "./health-connect-weight";
import { API_BASE, AUTH_HEADERS } from "./api";
import { deviceTz } from "./meal-capture";

/** Read-only, and only the two types a scale writes. soma never writes to Health Connect. */
export const WEIGHT_PERMISSIONS: Permission[] = [
  { accessType: "read", recordType: "Weight" },
  { accessType: "read", recordType: "BodyFat" },
];

export interface SyncOutcome {
  ok: boolean;
  /** Why not, in words worth showing. */
  why?: string;
  read?: number;
  stored?: number;
  already?: number;
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

    const timeRangeFilter = { operator: "between" as const, ...historyWindow() };
    const weights = await readRecords("Weight", { timeRangeFilter });
    const fats = await readRecords("BodyFat", { timeRangeFilter }).catch(() => ({ records: [] }));

    const readings = toReadings(
      (weights.records ?? []) as HcWeightRecord[],
      (fats.records ?? []) as HcBodyFatRecord[],
    );
    if (!readings.length) return { ok: true, read: 0, stored: 0, already: 0 };

    const res = await fetch(`${API_BASE}/api/health/weight`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ readings, tz: deviceTz() }),
    });
    if (!res.ok) return { ok: false, why: `soma refused the batch (${res.status})`, read: readings.length };
    const body = (await res.json()) as { stored?: number; already?: number };
    return { ok: true, read: readings.length, stored: body.stored ?? 0, already: body.already ?? 0 };
  } catch (e) {
    return { ok: false, why: (e as Error).message?.slice(0, 200) ?? "unknown failure" };
  }
}
