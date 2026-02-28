import { neon } from "@neondatabase/serverless";

export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return neon(process.env.DATABASE_URL);
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
