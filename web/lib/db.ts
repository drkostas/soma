import { neon } from "@neondatabase/serverless";
import { Pool } from "pg";

/** A tagged-template function that always resolves to an array of row objects. */
export type QueryFn = (
  strings: TemplateStringsArray,
  ...values: unknown[]
// A row is whatever the query selected; typing it `unknown` would push a narrowing change
// through every route at once, which soma#958 tracks separately.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
) => Promise<Record<string, any>[]>;

/**
 * The driver is chosen from the connection string, never from the code (soma#939).
 *
 * Neon's serverless driver is not a Postgres client. It turns the host in the connection
 * string into an HTTPS endpoint (the first DNS label becomes `api.`) and posts SQL to it. Two
 * kinds of host speak that shape: a real Neon host (`*.neon.tech`) and the estate's gateway,
 * whose connection strings name `pg.<domain>` on purpose: `pg.gkos.dev` is not a hostname, it
 * exists so the driver derives `https://api.gkos.dev/sql` from it. Handing that URL to a socket
 * driver resolves the host and dies with `getaddrinfo ENOTFOUND pg.gkos.dev`, which is what
 * every production build of soma-personal did from 2026-09-09 to 2026-09-13 (soma#938).
 * `bridge/src/db.ts` has made the same choice since the cutover; this is the web copy of it.
 * Anything else (127.0.0.1, localhost, a real Postgres host) gets a `pg` Pool.
 */
export type DbDriver = "http" | "pool";

export function driverFor(url: string): DbDriver {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    // A DATABASE_URL that will not parse is a configuration mistake, not a hint to try the other
    // driver: falling through to pg turns a typo into a confusing connection error much later.
    throw new Error("DATABASE_URL is not a valid connection string");
  }
  return host.endsWith(".neon.tech") || host.startsWith("pg.") ? "http" : "pool";
}

// One pool per process, created on first use. `next start` is long-lived, so a pool is right
// here in a way it never was on a serverless function.
/** A pool per connection string. See `localDb` for why this is a map. */
const pools = new Map<string, Pool>();

/**
 * The same tagged-template shape as `neon()`, over a normal Postgres connection. The template
 * holes become $1, $2, … in order, which is what both drivers do, so the 109 call sites cannot
 * tell the difference and no query text changes.
 */
function localDb(url: string): QueryFn {
  // ⛔ ONE POOL PER URL, KEYED BY URL. This was a single module-level `pool`, created on the first
  // call and then returned for EVERY later call whatever url was asked for. `getDb()` never showed
  // it, because it always passes the same DATABASE_URL. A script that wanted two databases at once
  // got one: it created the pool on `soma`, then asked for `verify_soma`, was silently handed
  // `soma`, and its SELECT returned nothing and its UPDATE hit the wrong database. Both looked like
  // success. That cost 29 unwanted weigh-ins written into his live Garmin account, because the
  // cleanup that should have removed them queried an empty result and reported "nothing to do".
  let pool = pools.get(url);
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 8, idleTimeoutMillis: 30_000 });
    pools.set(url, pool);
    // ⛔ AN IDLE CLIENT EMITTING error WITH NO LISTENER TAKES THE PROCESS DOWN. pg is explicit
    // about this, and idle clients emit on any backend restart, so one `brew services restart
    // postgresql` would kill the pinned host. This never mattered against Neon because the HTTP
    // driver holds no pool; `next start` is long-lived and does.
    pool.on("error", (err) => console.error("[db] idle client error:", err.message));
  }
  const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = "";
    strings.forEach((s, i) => {
      text += s;
      if (i < values.length) text += `$${i + 1}`;
    });
    const res = await pool!.query(text, values);
    return res.rows;
  };
  // Neon's client is a tagged template that ALSO carries .query(text, params), and two callers
  // use it for bulk inserts whose placeholder list is built at runtime (pmc-stream's chunked
  // training_load insert, the DJ daemon's song lookup). It returns the ROWS, not pg's result
  // object, so the shim has to unwrap .rows or `res.length` counts one.
  (tagged as unknown as { query: unknown }).query =
    async (text: string, params: unknown[] = []) => (await pool!.query(text, params)).rows;
  return tagged as QueryFn;
}

/**
 * Return a tagged-template query function for whatever DATABASE_URL names.
 *
 * When DATABASE_URL is missing (build-time prerender on preview deploys, or
 * local builds without a DB), returns a stub that resolves every query to an
 * empty array. This lets ISR create placeholder pages during `next build`;
 * the first real request after deploy triggers regeneration with real data.
 */
/**
 * True while `next build` is prerendering, when there is legitimately no database.
 * Anywhere else a missing DATABASE_URL is a fault, not a reason to render empty pages.
 */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build";
}

/**
 * A connection to a named database, for the rare caller that needs two at once.
 *
 * ⚠️ WHY THIS EXISTS. A check script writes its probe rows to `verify_soma` so his real log is
 * untouched, but the GARMIN TOKENS live only in `soma`, and a token store pointed at the wrong
 * database reports "Login needs MFA / fresh SSO" — which reads as an expired credential and is
 * nothing of the kind. `getDb()` remains the one connection every route and the sync should use.
 */
export function makeDb(url: string): QueryFn {
  if (!url) throw new Error("makeDb needs a connection string");
  return driverFor(url) === "http" ? (neon(url) as QueryFn) : localDb(url);
}

export function getDb(): QueryFn {
  // `next build` never needs a database (soma#940). Prerendered pages and ISR route handlers get
  // the empty stub whatever DATABASE_URL says; the first request after deploy regenerates them with
  // real data. Until 2026-09-13 the stub applied only when the variable was MISSING, so production
  // builds (where it is set) ran real queries at build time, and one unreachable host took every
  // build down for four days (soma#938).
  if (isBuildPhase()) {
    return (_strings, ..._values) => Promise.resolve([]);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    // ⚠️ THE STUB USED TO APPLY AT RUNTIME TOO, so an unset variable in production rendered every
    // page as "no data" and looked like a quiet day rather than a broken deployment. That is
    // exactly how a missing key on the portfolio went unnoticed through three builds.
    throw new Error("DATABASE_URL is not set");
  }
  return driverFor(url) === "http" ? (neon(url) as QueryFn) : localDb(url);
}

/** Retry once on a transport hiccup: a Neon cold start, or the gateway between a request
 * and a Postgres that is restarting underneath it. */
export async function withDbRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (retries > 0 && (msg.includes("fetch failed") || msg.includes("connecting to database"))) {
      await new Promise((r) => setTimeout(r, 800));
      return withDbRetry(fn, retries - 1);
    }
    throw err;
  }
}
