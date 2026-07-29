#!/usr/bin/env node
/**
 * Build-time guard against the trailing-whitespace env-var class of bug.
 *
 * A stray leading/trailing newline in an env value is invisible in the Vercel
 * dashboard but silently breaks anything that compares or concatenates the raw
 * string: HTTP header values (CRON_SECRET — the only one Vercel itself checks,
 * and only at build), Bearer-token equality (HEVY_WEBHOOK_SECRET → 401),
 * OAuth URLs (STRAVA_CLIENT_ID / NEXT_PUBLIC_BASE_URL → %0A), and strict
 * feature flags (NEXT_PUBLIC_IS_DEMO === "true" → false → demo shows the sync
 * controls). This bit soma-demo for ~130 days.
 *
 * Runs as the first step of the Vercel/CI build. Fails loudly (exit 1) if any
 * present critical var differs from its trimmed form. Vars absent from the
 * current environment are skipped (preview envs may not set all of them).
 */
const CRITICAL = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "CRON_SECRET",
  "SOMA_API_TOKEN",
  "NEXT_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_IS_DEMO",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "HEVY_WEBHOOK_SECRET",
  "STRAVA_CLIENT_ID",
  "STRAVA_CLIENT_SECRET",
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
  "GITHUB_PAT",
];

const dirty = CRITICAL.filter((k) => {
  const v = process.env[k];
  return v != null && v !== v.trim();
});

if (dirty.length) {
  console.error(
    "\n[env-check] FAIL — these env vars have leading/trailing whitespace and " +
      "will silently break header/URL/token/flag comparisons:\n" +
      dirty.map((k) => `  - ${k}`).join("\n") +
      "\n\nRe-set each without the stray whitespace, e.g.:\n" +
      "  printf %s \"<value>\" | vercel env add <NAME> production\n" +
      "then redeploy.\n",
  );
  process.exit(1);
}

const checked = CRITICAL.filter((k) => process.env[k] != null).length;
console.log(`[env-check] OK — ${checked} critical env vars have no leading/trailing whitespace.`);
