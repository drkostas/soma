/**
 * The background job that keeps his weight flowing without him opening anything.
 *
 * He asked for it fully automated with no manual input, so this is the piece that makes it so:
 * Android wakes the app roughly every quarter of an hour, it reads Health Connect and posts
 * whatever is there. Weight changes once a day at most, so the interval is generous.
 *
 * ⛔ `defineTask` MUST RUN AT IMPORT TIME, before React renders, because Android can start the app
 * headless purely to run the task and there is no component tree then. That is why this module is
 * imported for its side effect from the root layout rather than called from a hook.
 */
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { syncWeights } from "./weight-sync";

export const WEIGHT_TASK = "soma-weight-sync";

/** Roughly a quarter of an hour, which is the floor Android's scheduler will honour. */
export const WEIGHT_TASK_MINUTES = 15;

TaskManager.defineTask(WEIGHT_TASK, async () => {
  const r = await syncWeights();
  // The log is the only account of a headless run, so say what happened either way.
  if (r.ok) console.log(`[weight-sync] read ${r.read} stored ${r.stored} already ${r.already}`);
  else console.log(`[weight-sync] nothing done: ${r.why}`);
  // ⚠️ A MISSING PERMISSION IS NOT A FAILURE. Reporting Failed for it would have Android back off
  // and eventually stop scheduling, so the job would be dead by the time he grants it.
  return BackgroundTask.BackgroundTaskResult.Success;
});

/** Idempotent: safe on every launch, which is when it is called. */
export async function registerWeightSync(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(WEIGHT_TASK)) return;
    await BackgroundTask.registerTaskAsync(WEIGHT_TASK, { minimumInterval: WEIGHT_TASK_MINUTES });
    console.log(`[weight-sync] registered, every ~${WEIGHT_TASK_MINUTES} min`);
  } catch (e) {
    // Never take the app down over a background job.
    console.log(`[weight-sync] could not register: ${(e as Error).message}`);
  }
}
