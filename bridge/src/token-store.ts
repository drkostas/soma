import { openDb } from "./db";

/**
 * A garmin-auth TokenStore that reads the credential row through whatever `openDb` speaks.
 *
 * ⛔ WHY THIS EXISTS RATHER THAN garmin-auth's OWN DBTokenStore. That one takes the connection
 * string and opens a real Postgres socket. This estate's DATABASE_URL names `pg.gkos.dev`, a host
 * that deliberately has no DNS record, so the socket attempt dies with `getaddrinfo ENOTFOUND` —
 * and `DBTokenStore.load()` ends in a bare `catch { return null; }`, which turns "I could not
 * reach the database" into "there are no tokens". The caller then reports
 * `Login needs MFA / fresh SSO`, which is a true-sounding sentence about the wrong subject and
 * sent two people looking at the Garmin account while the actual fault was the connection string.
 *
 * So this store goes through `openDb`, which picks a driver from the URL, and — the part that
 * matters more than the transport — it DOES NOT SWALLOW FAILURES. A missing row returns null
 * because that is a real answer. Anything else throws, so an unreachable store is reported as an
 * unreachable store.
 */
const PLATFORM = "garmin_tokens";

export class GatewayTokenStore {
  constructor(private readonly databaseUrl: string) {}

  async load(): Promise<string | null> {
    const db = openDb(this.databaseUrl);
    try {
      const { rows } = await db.query(
        "SELECT credentials FROM platform_credentials WHERE platform = $1 LIMIT 1",
        [PLATFORM],
      );
      if (!rows.length || !rows[0].credentials) return null;
      const raw = rows[0].credentials;
      const creds = typeof raw === "string" ? JSON.parse(raw) : raw;
      // garmin-auth 0.3+ writes the payload nested under `garmin_tokens` on both stacks.
      const payload = creds?.garmin_tokens;
      if (!payload || typeof payload !== "object") return null;
      if (!("di_token" in payload)) return null;
      return JSON.stringify(payload);
    } finally {
      await db.end().catch(() => {});
    }
  }

  async save(tokens: string | Record<string, unknown>): Promise<void> {
    const payload = typeof tokens === "string" ? JSON.parse(tokens) : tokens;
    const wrapped = JSON.stringify({ garmin_tokens: payload });
    const db = openDb(this.databaseUrl);
    try {
      await db.query(
        `INSERT INTO platform_credentials (platform, auth_type, credentials, status, connected_at)
         VALUES ($1, 'oauth', $2::jsonb, 'active', NOW())
         ON CONFLICT (platform) DO UPDATE SET credentials = EXCLUDED.credentials`,
        [PLATFORM, wrapped],
      );
    } finally {
      await db.end().catch(() => {});
    }
  }

  /**
   * ⛔ DELIBERATELY DOES NOT DELETE, AND THAT IS THE WHOLE POINT OF IT.
   *
   * garmin-auth clears the store when Garmin rejects a token (`auth.ts`: `store.delete()` on a
   * stale credential). That is reasonable where the caller can recover by logging in again. This
   * caller cannot: it runs on a GitHub runner, and Garmin refuses SSO from cloud IPs, which is why
   * the whole CF-Worker path exists. So a rejection here would delete a credential this process
   * has no way to recreate — one shared with the hourly sync on the machine at home, which would
   * then fail too, with `Login needs MFA` and no trace of what removed the row.
   *
   * That is not hypothetical. On 9 September a dead refresh token caused exactly that deletion,
   * and the missing row sent two people looking at a migration instead of at the credential.
   * The bridge is a consumer of this credential, not its owner, so it declines.
   */
  async delete(): Promise<void> {
    console.warn(
      "[bridge] garmin-auth asked to clear the shared garmin_tokens row; refusing. " +
        "This process cannot re-authenticate (Garmin blocks SSO from cloud IPs), so deleting it " +
        "would break the hourly sync as well. Re-auth at soma.gkos.dev/connections instead.",
    );
  }
}
