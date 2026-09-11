/** The one timezone that defines the athlete's "today" (soma#872). Every route and lib that used
 *  to hardcode America/New_York reads this instead; the database session timezone is untouched. */
export function athleteTz(env: Record<string, string | undefined> = process.env): string {
  return env.SOMA_TZ?.trim() || "Europe/Athens";
}
export function dateInAthleteTz(d: Date, tz: string = athleteTz()): string {
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}
export function todayAthlete(env: Record<string, string | undefined> = process.env): string {
  return dateInAthleteTz(new Date(), athleteTz(env));
}
