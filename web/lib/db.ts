import { neon } from "@neondatabase/serverless";
import { Pool } from "pg";

/** A tagged-template function that always resolves to an array of row objects. */
export type QueryFn = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, any>[]>;

/**
 * Neon's serverless driver is not a Postgres client. It turns the host in the connection
 * string into an HTTPS endpoint and posts SQL to it, so pointed at a local database it builds
 * `https://api.0.0.1/sql` and fails with ERR_INVALID_URL. That is why the same DATABASE_URL
 * cannot simply be swapped for a local one: the driver has to change with it.
 */
function isNeon(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".neon.tech");
  } catch {
    // A DATABASE_URL that will not parse is a configuration mistake, not a hint to try the other
    // driver: falling through to pg turns a typo into a confusing connection error much later.
    throw new Error("DATABASE_URL is not a valid connection string");
  }
}

// One pool per process, created on first use. `next start` is long-lived, so a pool is right
// here in a way it never was on a serverless function.
let pool: Pool | null = null;

/**
 * The same tagged-template shape as `neon()`, over a normal Postgres connection. The template
 * holes become $1, $2, … in order, which is what both drivers do, so the 109 call sites cannot
 * tell the difference and no query text changes.
 */
function localDb(url: string): QueryFn {
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 8, idleTimeoutMillis: 30_000 });
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

export function getDb(): QueryFn {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // ⚠️ THE STUB USED TO APPLY AT RUNTIME TOO, so an unset variable in production rendered every
    // page as "no data" and looked like a quiet day rather than a broken deployment. That is
    // exactly how a missing key on the portfolio went unnoticed through three builds.
    if (isBuildPhase()) {
      return (_strings, ..._values) => Promise.resolve([]);
    }
    throw new Error("DATABASE_URL is not set");
  }
  return isNeon(url) ? (neon(url) as QueryFn) : localDb(url);
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
