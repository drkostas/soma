import type { QueryFn } from "./db";

/** The DI tokens live in platform_credentials at this platform key (DBTokenStore's default). */
export const GARMIN_TOKEN_PLATFORM = "garmin_tokens";

const healed = new Set<string>();

/**
 * Self-heal the Garmin token row before DBTokenStore reads it (#723, port of
 * hevy2garmin#459).
 *
 * garmin-auth's Python fresh-login writes the DI payload FLAT ({di_token, …}
 * at the top level of `credentials`); the TS DBTokenStore reads only the
 * NESTED shape `credentials->'garmin_tokens'`. After every manual re-login the
 * ingest, the sync pipeline and the DJ daemon all failed with "needs MFA"
 * until someone ran this UPDATE by hand.
 *
 * Idempotent (the WHERE excludes an already-nested row), once per process per
 * platform key, and it never throws: a failed heal must not block auth, since
 * DBTokenStore reports the real problem with a better message.
 *
 * Returns the number of rows nested (0 when the row was already fine), or
 * null when the query itself failed.
 */
export async function healGarminTokenRow(sql: QueryFn, platform: string = GARMIN_TOKEN_PLATFORM): Promise<number | null> {
  if (healed.has(platform)) return 0;
  try {
    const rows = await sql`
      UPDATE platform_credentials
         SET credentials = jsonb_build_object('garmin_tokens', credentials),
             auth_type = 'oauth',
             status = 'active'
       WHERE platform = ${platform}
         AND credentials ? 'di_token'
         AND NOT (credentials ? 'garmin_tokens')
       RETURNING platform`;
    healed.add(platform);
    const n = Array.isArray(rows) ? rows.length : 0;
    if (n > 0) console.log(`[garmin-token-heal] nested a flat DI token row for ${platform}`);
    return n;
  } catch {
    return null;
  }
}

/** Tests only: forget which platforms this process already healed. */
export function resetGarminTokenHealForTests(): void {
  healed.clear();
}
