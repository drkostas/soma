/**
 * The timezone of the device making this request.
 *
 * ⛔ THE SERVER HAS NO IDEA WHAT TIME IT IS FOR HIM. Node's clock is the host's, Postgres's is the
 * session's (New York), and `athleteTz()` is a build-time constant that is right at home and wrong
 * the moment he travels. He asked for the app to follow whatever he is holding, so the native app
 * sends its zone in a header and the browser writes it into a cookie, and every request reads those.
 *
 * `athleteTz()` remains the fallback, and it is a real one: the drain, the daemons and the scripts
 * have no device to ask, and the very first render of a new session happens before the cookie
 * exists.
 */
import { cookies, headers } from "next/headers";
import { athleteTz, dateInAthleteTz, readTz } from "./athlete-tz";
import { TZ_COOKIE, TZ_HEADER } from "./tz-cookie";

export { TZ_COOKIE, TZ_HEADER };

/**
 * The zone to reason in for this request.
 *
 * ⚠️ `cookies()` THROWS OUTSIDE A REQUEST, and several of the modules that want a zone are also
 * imported by scripts and by the drain. Catching that is what lets one helper serve both, rather
 * than every caller having to know which world it is in.
 */
export async function requestTz(): Promise<string> {
  // The public demo renders the same pages for everyone, so it must not read a
  // per-request zone: that makes every page dynamic and defeats the static demo
  // cache. The athlete fallback is a fixed zone, so the demo pages can prerender.
  // Off the demo this is skipped and the device's own zone is used as before.
  if (process.env.DEMO_MODE?.trim() === "true") return athleteTz();
  try {
    // The app's header first, because the native app has no cookie for this domain (soma#1125).
    // A browser has no header and falls to its cookie; a job has neither and falls to athleteTz.
    // `readTz` with an empty fallback rejects a missing or bogus value so the next source is tried.
    const fromHeader = readTz((await headers()).get(TZ_HEADER), "");
    if (fromHeader) return fromHeader;
    const jar = await cookies();
    return readTz(jar.get(TZ_COOKIE)?.value);
  } catch {
    return athleteTz();
  }
}

/** Today's calendar date on the device making this request. */
export async function todayForRequest(): Promise<string> {
  return dateInAthleteTz(new Date(), await requestTz());
}
