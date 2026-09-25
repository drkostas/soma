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
import { initialize } from "react-native-health-connect";
import { grantedWeightAccess, requestWeightAccess, syncWeights, type SyncOutcome } from "./weight-sync";
import { nextAsk } from "./health-connect-weight";

export const WEIGHT_TASK = "soma-weight-sync";

/** Roughly a quarter of an hour, which is the floor Android's scheduler will honour. */
export const WEIGHT_TASK_MINUTES = 15;

/** One line saying what a run did, including whether it read the whole history or only 30 days. */
export function describeOutcome(where: string, r: SyncOutcome): string {
  if (!r.ok) return `[weight-sync ${where}] nothing done: ${r.why}`;
  const window = r.span === "recent"
    ? `the last 30 days only (full history refused: ${r.fullError ?? "no reason given"})`
    : "the whole history";
  return `[weight-sync ${where}] read ${r.read} over ${window}, stored ${r.stored}, already held ${r.already}`;
}

TaskManager.defineTask(WEIGHT_TASK, async () => {
  const r = await syncWeights();
  // The log is the only account of a headless run, so say what happened either way.
  console.log(describeOutcome("background", r));
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

/** Asked at most once per run of the app, so a re-render or a fast refresh cannot re-open the sheet. */
let askedThisRun = false;

/**
 * Everything the app does about weight when it opens. Called from the root layout, never from the
 * headless task, because the permission sheet needs a visible activity.
 *
 * 1. Make sure the background job exists (a reinstall clears Android's scheduled jobs).
 * 2. Ask for what is missing, at most once per run: the data types if Weight is not granted, then
 *    background and history as a SEPARATE request. Android stops showing a sheet after two
 *    refusals, so this cannot become a nag.
 * 3. Sync now, in the foreground. This is what makes opening soma sync even before background access
 *    is granted, and it means the tap on "Allow" is followed straight away by his history arriving.
 */
export async function startWeightSync(): Promise<void> {
  await registerWeightSync();
  try {
    if (!(await initialize())) {
      console.log("[weight-sync] Health Connect is not available on this device");
      return;
    }
    if (!askedThisRun) {
      askedThisRun = true;
      // Two steps, because one request for all four granted only the data types on his phone. The
      // data types first; the extras (background, history) as a request of their own afterwards.
      let got = await grantedWeightAccess();
      if (nextAsk(got) === "data") {
        got = await requestWeightAccess("data");
        console.log(`[weight-sync] asked for the data types: weight=${got.weight}`);
      }
      if (nextAsk(got) === "extras") {
        got = await requestWeightAccess("extras");
        console.log(`[weight-sync] asked for background and history: background=${got.background}`);
      }
    }
    console.log(describeOutcome("foreground", await syncWeights()));
  } catch (e) {
    // Never take the app down over this.
    console.log(`[weight-sync] could not start: ${(e as Error).message}`);
  }
}
