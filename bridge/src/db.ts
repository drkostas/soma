import { Pool } from "pg";

/**
 * The bridge runs on a GitHub runner and the database lives on a machine at home, so it cannot
 * simply open a socket to it. Exposing Postgres to the internet is not an option, so the database
 * is reached over HTTPS instead, through the gateway that answers SQL for the whole estate.
 *
 * ⛔ THE HOST IN THE CONNECTION STRING IS NOT A REAL HOST. `pg.gkos.dev` deliberately has no DNS
 * record: it exists only so a client can derive the HTTPS endpoint from it, the way Neon's own
 * driver does, by replacing the first label with `api.`. A client holding a real Postgres socket
 * tries to resolve it and dies with `getaddrinfo ENOTFOUND pg.gkos.dev`, which is exactly how the
 * Strava re-finalize workflow failed the first time this moved.
 *
 * So the driver is chosen from the connection string: an ordinary Postgres URL still gets a real
 * pool, and a gateway URL gets one that speaks HTTP. Callers see the same two methods either way.
 */
export interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
  end(): Promise<void>;
}

/** The endpoint a gateway connection string points at, derived exactly as Neon's driver does. */
function endpointFor(host: string): string {
  return `https://${host.replace(/^[^.]+\./, "api.")}/sql`;
}

function httpDb(url: string): Db {
  const endpoint = endpointFor(new URL(url).hostname);
  return {
    async query(text, params = []) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // The credential is the password in the connection string, which is what it is for
          // Neon too. Array mode is left off, so rows come back as objects like pg returns them.
          "Neon-Connection-String": url,
        },
        body: JSON.stringify({ query: text, params }),
      });
      const body = await res.json().catch(() => ({}) as any);
      if (!res.ok) {
        // Surface it as a database error, so callers' own handling still applies.
        const err = new Error(body?.message || `gateway HTTP ${res.status}`);
        Object.assign(err, { code: body?.code, detail: body?.detail, hint: body?.hint });
        throw err;
      }
      return { rows: body.rows ?? [], rowCount: body.rowCount ?? 0 };
    },
    async end() {
      /* nothing to close: every query is its own request */
    },
  };
}

/** A database handle for whatever the connection string names. */
export function openDb(url: string): Db {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* fall through to the real driver, which will complain more usefully than we can */
  }
  if (host.startsWith("pg.")) return httpDb(url);
  const pool = new Pool({ connectionString: url });
  return {
    // pg types rowCount as nullable; the callers here only ever read rows, so normalise it.
    query: async (text, params) => {
      const r = await pool.query(text, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    end: () => pool.end(),
  };
}
