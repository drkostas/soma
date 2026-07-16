/**
 * Session-based Strava web connector — TS port of sync/src/strava_web.py.
 * Strava has no usable API for us (paid + no photo attach), so Playwright drives
 * the web UI: log in (headed; headless is reCAPTCHA-blocked, run under xvfb in CI),
 * reuse a stored cookie session, and set an activity's title/description/photo on
 * its edit page. The facterino forward carries only the workout data.
 */
import type { BrowserContext, Page } from "playwright";
import type { Pool } from "pg";

export const LOGIN_URL = "https://www.strava.com/login";
const PHOTO_CDN = "dgtzuqphqg23d.cloudfront.net";
const SESSION_COOKIE_NAMES = ["_strava4_session", "_currentH", "_strava_cpra", "_strava_cpra_uid"];

export function stravaCreds(): { email?: string; password?: string } {
  return { email: process.env.STRAVA_WEB_EMAIL, password: process.env.STRAVA_WEB_PASSWORD };
}

async function ensureSessionTable(db: Pool): Promise<void> {
  await db.query(
    "CREATE TABLE IF NOT EXISTS strava_web_session (id INT PRIMARY KEY DEFAULT 1, cookies JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
  );
}

/** Load stored Playwright cookies (drops `expires`, which add_cookies rejects). */
export async function loadSession(db: Pool): Promise<any[] | null> {
  await ensureSessionTable(db);
  const r = await db.query("SELECT cookies FROM strava_web_session WHERE id = 1");
  const cookies = r.rows[0]?.cookies;
  if (!cookies) return null;
  return cookies.map((c: any) => { const { expires, ...rest } = c; return rest; });
}

/** Persist the strava cookies for session reuse (Strava rate-limits repeated logins). */
export async function saveSession(db: Pool, cookies: any[]): Promise<void> {
  const keep = cookies
    .filter((c) => SESSION_COOKIE_NAMES.some((n) => (c.name || "").includes(n)) || (c.domain || "").includes("strava"))
    .map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite }));
  if (!keep.length) return;
  await ensureSessionTable(db);
  await db.query(
    "INSERT INTO strava_web_session (id, cookies, updated_at) VALUES (1, $1, NOW()) ON CONFLICT (id) DO UPDATE SET cookies = EXCLUDED.cookies, updated_at = NOW()",
    [JSON.stringify(keep)],
  );
}

/** A stored session is only trustworthy if a real authed page loads. */
export async function sessionValid(page: Page): Promise<boolean> {
  await page.goto("https://www.strava.com/dashboard", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);
  return !page.url().includes("/login");
}

/** The proven 3-step flow: email → "Use password instead" → password → dashboard. */
export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);
  for (const label of ["Accept All", "Reject Non-Essential"]) {
    const btn = page.getByRole("button", { name: label });
    if (await btn.count()) { await btn.first().click(); break; }
  }
  await page.waitForTimeout(700);
  await page.locator('input[type="email"]:visible').first().fill(email);
  await page.locator('button[type="submit"]:visible').first().click();
  await page.waitForTimeout(3500);
  const usePw = page.getByRole("button", { name: "Use password instead" });
  if (await usePw.count()) {
    try { await usePw.first().click({ force: true }); } catch { /* ignore */ }
    await page.waitForTimeout(2000);
  }
  await page.locator('input[type="password"]:visible').first().fill(password);
  await page.locator('button[type="submit"]:visible').first().click();
  await page.waitForTimeout(7000);
  if (page.url().includes("/login")) {
    throw new Error("Strava login failed (still on /login — bad creds or bot challenge)");
  }
}

async function deleteExistingPhotos(page: Page): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < 12; i++) {
    const photos = page.locator(`img[src*="${PHOTO_CDN}"]`);
    if ((await photos.count()) === 0) break;
    await photos.first().scrollIntoViewIfNeeded();
    await photos.first().click();
    await page.waitForTimeout(900);
    const btn = page.getByRole("button", { name: "Delete" });
    if (!(await btn.count())) break;
    await btn.first().click();
    await page.waitForTimeout(900);
    deleted += 1;
  }
  return deleted;
}

/** Set title + description + attach an image on an activity's edit page, then Save. */
export async function setActivityDetails(
  page: Page, activityId: number,
  opts: { title?: string | null; description?: string | null; imagePath?: string | null; replacePhoto?: boolean } = {},
): Promise<void> {
  const replacePhoto = opts.replacePhoto ?? true;
  await page.goto(`https://www.strava.com/activities/${activityId}/edit`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);
  if (opts.title) {
    const t = page.locator("input#activity_name");
    if (await t.count()) await t.first().fill(opts.title);
  }
  if (opts.description) {
    const d = page.locator("textarea:not(#activity_private_note)");
    if (await d.count()) await d.first().fill(opts.description);
  }
  if (opts.imagePath) {
    if (replacePhoto) { await deleteExistingPhotos(page); await page.waitForTimeout(500); }
    const before = await page.locator("img").count();
    await page.locator("input[type=file]").first().setInputFiles(opts.imagePath);
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(1000);
      if ((await page.locator("img").count()) > before) break;
    }
  }
  await page.getByRole("button", { name: "Save" }).first().click();
  await page.waitForTimeout(5000);
}

/** Read the user's OWN Strava activity ids from the training log (not the social feed). */
export async function ownActivityIds(page: Page): Promise<Set<string>> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.goto("https://www.strava.com/athlete/training", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3500);
      const html = await page.content();
      const ids = new Set([...html.matchAll(/\/activities\/(\d+)/g)].map((m) => m[1]));
      if (ids.size) return ids;
    } catch { /* retry */ }
    await page.waitForTimeout(4000);
  }
  throw new Error("athlete/training would not load");
}

export type { BrowserContext, Page };
