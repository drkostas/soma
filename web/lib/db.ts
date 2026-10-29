import { neon, neonConfig, NeonQueryPromise } from "@neondatabase/serverless";
import { Pool, types as pgTypes } from "pg";

/**
 * ⛔ A DATE IS A CALENDAR DAY, SO IT STAYS TEXT.
 *
 * Both drivers parse a DATE column into a JS Date at the SERVER's midnight, and JSON sends a Date as UTC.
 * 28 September in Athens therefore left the server as "2026-09-27T21:00:00.000Z". The app's charts label
 * a point by its first ten characters, so they were a day early, and so was every
 * `d instanceof Date ? d.toISOString().split("T")[0] : …` guard written to cope with it, because that
 * ISO string is the previous day. Handing DATE back as the text Postgres sent ("2026-09-28") removes the
 * moment altogether. Timestamps keep their default parsing: they ARE moments.
 */
export const DATE_OID = 1082;
const dateAsText = (value: string): string => value;
pgTypes.setTypeParser(DATE_OID, dateAsText);

/** The same rule for the Neon HTTP driver, which the demo and the gateway hosts use. */
export const neonTypes = {
  getTypeParser: (oid: number, format?: "text" | "binary") =>
    oid === DATE_OID ? dateAsText : pgTypes.getTypeParser(oid, format as "text"),
};

/**
 * The Neon HTTP driver with that rule applied to every query.
 *
 * ⛔ `neon(url, { types })` DOES NOT DO THIS. Neon 1.0 reads `types` only from a query's own options,
 * never from the options given to `neon()`, so the DATE rule above was silently dropped on every host
 * that uses this driver: Vercel production, the app's server, kept sending "2026-09-28T00:00:00.000Z"
 * (soma#1151). Each query is re-wrapped as a NeonQueryPromise carrying the types, which keeps it lazy
 * and keeps nested `sql` fragments composing, as Neon's own queries do.
 */
export function httpDb(url: string): QueryFn {
  const base = neon(url);
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = base(strings, ...values) as unknown as {
      execute: ConstructorParameters<typeof NeonQueryPromise>[0];
      queryData: ConstructorParameters<typeof NeonQueryPromise>[1];
      opts?: ConstructorParameters<typeof NeonQueryPromise>[2];
    };
    return new NeonQueryPromise(q.execute, q.queryData, { ...(q.opts ?? {}), types: neonTypes });
  };
  (tagged as unknown as { query: unknown }).query = (text: string, params: unknown[] = []) =>
    base.query(text, params, { types: neonTypes });
  return tagged as unknown as QueryFn;
}

/**
 * ⭐ A READ THAT MEETS A GATEWAY RESTART IS SENT ONCE MORE (soma#1195).
 *
 * While the gateway restarts, the edge in front of it answers 502 for about a second. On 2026-10-16
 * one restart made soma-demo's home page fail, and the public uptime check read the site as down.
 * A request that got 502, 503, 504 or no answer at all is sent once more after a short wait, but only
 * when every query in it is a plain SELECT: a write may already have run on the first attempt, so it
 * is never resent. Anything this cannot read counts as a write.
 */
const RETRY_STATUSES = new Set([502, 503, 504]);
const RETRY_WAIT_MS = 300;

export function isReadOnlyBody(body: unknown): boolean {
  if (typeof body !== "string") return false;
  let parsed: { query?: unknown; queries?: { query?: unknown }[] };
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  const texts = Array.isArray(parsed.queries) ? parsed.queries.map((q) => q?.query) : [parsed.query];
  return texts.length > 0 && texts.every((t) =>
    typeof t === "string" && /^\s*select\b/i.test(t) && !/;\s*\S/.test(t));
}

/**
 * A connection can also be cut after the headers, while the body is still arriving: the driver then
 * fails with `TypeError: terminated` (ECONNRESET), which a status check never sees (soma#1199, the
 * demo's home page at 16:02 on 2026-10-16). So a read's body is read here, in full, and the driver is
 * handed a response built from those bytes; a body cut partway counts as a failed attempt.
 */
async function readFully(res: Response): Promise<Response> {
  const body = await res.arrayBuffer();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/**
 * ⭐ ON THE DEMO A READ IS ANSWERED FROM THE DATA CACHE FOR SIX HOURS (soma#1237).
 *
 * The demo's data moves forward once a week, and its database is billed for at least five minutes
 * every time it wakes. Caching its pages at the CDN (soma#1233) was not enough: the CDN keeps a copy
 * per region and per kind of request (a page load, a client navigation and a prefetch are separate
 * entries), so the same page still rendered and ran its queries several times an hour. Next.js keeps a
 * fetch that names its own revalidate in the data cache, keyed by the request body (the query and its
 * parameters), and every region and function instance shares that cache. It stores only 200 answers,
 * so an error is never kept. Only a request whose every query is a plain SELECT is marked, so a write
 * always reaches the database, and outside the demo nothing changes.
 */
export const DEMO_READ_CACHE_S = 21600;

export function withDemoReadCache(
  init: RequestInit | undefined,
  demo = process.env.DEMO_MODE === "true",
): RequestInit | undefined {
  if (!demo || !isReadOnlyBody(init?.body)) return init;
  return { ...init, next: { revalidate: DEMO_READ_CACHE_S } };
}

async function retryReadOnce(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!isReadOnlyBody(init?.body)) return fetch(input, init);
  init = withDemoReadCache(init);
  try {
    const res = await fetch(input, init);
    if (!RETRY_STATUSES.has(res.status)) return await readFully(res);
  } catch {
    // no answer, or the body was cut: fall through to the one retry
  }
  await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
  return fetch(input, init);
}

// ⚠️ The driver reads its fetch function only from the global config: `neon(url, { fetchFunction })`
// is ignored, and the extra option breaks query handling ("c.map is not a function").
neonConfig.fetchFunction = retryReadOnce;

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

/**
 * A query that has not run yet, in the shape Neon uses, so `sql` fragments can nest.
 *
 * ⛔ The local adapter used to run every tagged template the moment it was written. Neon does not:
 * it builds a query and runs it only when awaited, and a fragment nested inside another template is
 * inlined into it. Routes written against Neon rely on that (`${cond ? sql`AND x = ${v}` : sql``}`),
 * and on the local pool each such fragment reached pg as a Promise parameter, so playlist track
 * search returned 500 on the live host for as long as it had been off Neon (soma#1132).
 */
export class LocalQuery implements PromiseLike<Record<string, unknown>[]> {
  constructor(
    readonly strings: ReadonlyArray<string>,
    readonly values: unknown[],
    private readonly run: (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>,
  ) {}

  /** The SQL text with $1..$n numbered across every nested fragment, appending values to `params`. */
  compile(params: unknown[] = []): string {
    let text = "";
    this.strings.forEach((s, i) => {
      text += s;
      if (i >= this.values.length) return;
      const v = this.values[i];
      if (v instanceof LocalQuery) {
        text += v.compile(params);
      } else {
        params.push(v);
        text += `$${params.length}`;
      }
    });
    return text;
  }

  then<A = Record<string, unknown>[], B = never>(
    onFulfilled?: ((rows: Record<string, unknown>[]) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    const params: unknown[] = [];
    const text = this.compile(params);
    return this.run(text, params).then(onFulfilled, onRejected);
  }

  catch<B = never>(onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return this.then(undefined, onRejected);
  }

  finally(onFinally?: (() => void) | null) {
    return this.then().finally(onFinally);
  }
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
  const run = async (text: string, params: unknown[]) => (await pool!.query(text, params)).rows;
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) =>
    new LocalQuery(strings, values, run) as unknown as ReturnType<QueryFn>;
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
  return driverFor(url) === "http" ? httpDb(url) : localDb(url);
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
  return driverFor(url) === "http" ? httpDb(url) : localDb(url);
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
