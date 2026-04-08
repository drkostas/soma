import { neon } from "@neondatabase/serverless";

/** A tagged-template function that always resolves to an array of row objects. */
export type QueryFn = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, any>[]>;

/**
 * Return a Neon tagged-template query function.
 *
 * When DATABASE_URL is missing (build-time prerender on preview deploys, or
 * local builds without a DB), returns a stub that resolves every query to an
 * empty array. This lets ISR create placeholder pages during `next build`;
 * the first real request after deploy triggers regeneration with real data.
 */
export function getDb(): QueryFn {
  if (!process.env.DATABASE_URL) {
    return (_strings, ..._values) => Promise.resolve([]);
  }
  return neon(process.env.DATABASE_URL) as QueryFn;
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
