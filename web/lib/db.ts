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
    return false;
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
  pool ??= new Pool({ connectionString: url, max: 8, idleTimeoutMillis: 30_000 });
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
export function getDb(): QueryFn {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return (_strings, ..._values) => Promise.resolve([]);
  }
  return isNeon(url) ? (neon(url) as QueryFn) : localDb(url);
}

/** Retry once on Neon cold-start "fetch failed" errors (free tier goes idle). */
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
