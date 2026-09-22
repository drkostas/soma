/**
 * The cookie the browser writes its timezone into.
 *
 * ⛔ ITS OWN MODULE ON PURPOSE. The name is needed by a client component and by a server helper,
 * and `request-tz.ts` imports `next/headers`, which cannot be pulled into a client bundle. Sharing
 * a constant is not worth dragging the server's cookie machinery into the browser.
 */
export const TZ_COOKIE = "soma_tz";
/** A year. A device's zone rarely changes, and a stale one is corrected on the next mount. */
export const TZ_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
