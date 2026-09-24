/**
 * Ask Strava what it holds for the athlete's weight, and whether our token may change it.
 *
 *   cd web && set -a && . ~/.config/soma/sync.env && set +a && \
 *     npx tsx scripts/strava-weight-probe.mts
 *
 * Strava keeps ONE current weight on the profile, not a history, so a push here means "keep the
 * profile equal to the latest weigh-in". `PUT /athlete` needs the `profile:write` scope, and our
 * authorize route asks for `activity:read_all,activity:write,profile:read_all`, so the probe
 * writes the weight Strava ALREADY reports. That cannot change anything, and its status code is
 * the only honest answer to whether the scope is there.
 */
import { getDb } from "../lib/db";

const sql = getDb();

const rows = (await sql`
  SELECT credentials, expires_at, status,
         expires_at < NOW() AS expired
  FROM platform_credentials WHERE platform = 'strava'
`) as { credentials: Record<string, string>; expires_at: string; status: string; expired: boolean }[];

if (!rows.length) {
  console.log("no strava credential row at all");
  process.exit(0);
}
const row = rows[0];
console.log(`stored: status=${row.status} expires_at=${row.expires_at} expired=${row.expired}`);
console.log(`athlete: ${row.credentials.athlete_name ?? "?"} (${row.credentials.athlete_id ?? "?"})`);

let token = row.credentials.access_token;

if (row.expired) {
  const r = await fetch("https://www.strava.com/api/v3/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID!,
      client_secret: process.env.STRAVA_CLIENT_SECRET!,
      refresh_token: row.credentials.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const t = await r.json();
  if (!r.ok) { console.log(`refresh failed ${r.status}: ${JSON.stringify(t)}`); process.exit(1); }
  token = t.access_token;

  // ⛔ STRAVA ROTATES THE REFRESH TOKEN ON EVERY REFRESH, so a script that refreshes and does not
  // store the new one DESTROYS the stored credential. It reads as "the token expired" the next time,
  // and re-authorizing is the only repair. This happened on 2026-09-24 to the row below.
  await sql`
    UPDATE platform_credentials
       SET credentials = credentials
             || jsonb_build_object('access_token', ${t.access_token}::text,
                                   'refresh_token', ${t.refresh_token}::text),
           expires_at = to_timestamp(${t.expires_at})
     WHERE platform = 'strava'`;
  console.log(`refreshed and STORED, expires ${new Date(t.expires_at * 1000).toISOString()}`);
}

const auth = { Authorization: `Bearer ${token}` };

const me = await fetch("https://www.strava.com/api/v3/athlete", { headers: auth });
const body = await me.json();
if (!me.ok) { console.log(`GET /athlete ${me.status}: ${JSON.stringify(body)}`); process.exit(1); }
console.log(`Strava profile weight: ${body.weight ?? "(none)"} kg   measurement=${body.measurement_preference}`);

// What soma believes, for comparison.
const latest = (await sql`
  SELECT date, weight_grams, source FROM daily_weigh_ins
  ORDER BY date DESC LIMIT 1
`) as { date: string; weight_grams: number; source: string }[];
if (latest.length) {
  const w = latest[0];
  console.log(`soma's latest weigh-in: ${(w.weight_grams / 1000).toFixed(1)} kg on ${String(w.date).slice(0, 10)} (${w.source})`);
}

// The probe: write back exactly what Strava just reported, so nothing can change.
if (body.weight == null) {
  console.log("no weight on the profile, so there is nothing safe to write back; scope unknown");
  process.exit(0);
}
const put = await fetch(`https://www.strava.com/api/v3/athlete?weight=${body.weight}`, {
  method: "PUT",
  headers: auth,
});
const putBody = await put.text();
console.log(`PUT /athlete?weight=${body.weight} -> ${put.status} ${putBody.slice(0, 200)}`);
console.log(put.ok ? "profile:write IS granted, soma can push weight to Strava" : "profile:write is NOT granted");
