/**
 * The timezone of the device making this request.
 *
 * ⛔ THE SERVER HAS NO IDEA WHAT TIME IT IS FOR HIM. Node's clock is the host's, Postgres's is the
 * session's (New York), and `athleteTz()` is a build-time constant that is right at home and wrong
 * the moment he travels. He asked for the app to follow whatever he is holding, so the browser
 * writes its zone into a cookie and every server render reads it from there.
 *
 * `athleteTz()` remains the fallback, and it is a real one: the drain, the daemons and the scripts
 * have no device to ask, and the very first render of a new session happens before the cookie
 * exists.
 */
import { cookies } from "next/headers";
import { athleteTz, dateInAthleteTz, readTz } from "./athlete-tz";
import { TZ_COOKIE } from "./tz-cookie";

export { TZ_COOKIE };

/**
 * The zone to reason in for this request.
 *
 * ⚠️ `cookies()` THROWS OUTSIDE A REQUEST, and several of the modules that want a zone are also
 * imported by scripts and by the drain. Catching that is what lets one helper serve both, rather
 * than every caller having to know which world it is in.
 */
export async function requestTz(): Promise<string> {
  try {
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
