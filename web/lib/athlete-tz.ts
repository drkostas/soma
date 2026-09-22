/**
 * The timezone that defines "today".
 *
 * `athleteTz` is the FALLBACK, for the drain, the daemons and the scripts, which have no device to
 * ask. Anything serving a request should prefer the zone the device sent, through `readTz`, because
 * the answer that matters is the one on the screen he is looking at. He asked for exactly that:
 * "Just use my phone or browser (whatever im accessing it from) timezones".
 *
 * ⛔ NEVER the server's own zone. `new Date().getHours()` in a route is the hour where the code
 * runs, which on Vercel is UTC, so an evening meal near a slot boundary was being guessed against a
 * clock three hours behind him. And never a time formatted by Postgres: that session is on New York.
 */
export function athleteTz(env: Record<string, string | undefined> = process.env): string {
  return env.SOMA_TZ?.trim() || "Europe/Athens";
}
export function dateInAthleteTz(d: Date, tz: string = athleteTz()): string {
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}
export function todayAthlete(env: Record<string, string | undefined> = process.env): string {
  return dateInAthleteTz(new Date(), athleteTz(env));
}

/**
 * A timezone name from a device, or the fallback when it is missing or not a real zone.
 *
 * Validated by asking Intl to use it, which is the only honest test: the list of zone names is the
 * runtime's, not ours. A bad name must not throw on a request that is trying to log a meal, so an
 * unusable value quietly becomes the fallback.
 */
export function readTz(value: unknown, fallback: string = athleteTz()): string {
  if (typeof value !== "string") return fallback;
  const tz = value.trim();
  if (!tz || tz.length > 64) return fallback;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return fallback;
  }
}

/** The hour of the day in a given zone, for deciding which meal slot the clock suggests. */
export function hourInTz(d: Date, tz: string = athleteTz()): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(d);
  // "24" is how en-GB renders midnight with hour12 false, and midnight is hour 0.
  const n = Number(h);
  return Number.isFinite(n) ? n % 24 : d.getUTCHours();
}
