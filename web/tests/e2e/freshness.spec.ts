import { test, expect } from "@playwright/test";

/**
 * Freshness guard (#741, part of #731): a page must never label a value older
 * than its source cadence as "today" or "last night".
 *
 * Every headline that claims recency carries three attributes set by the page:
 *   data-observed="YYYY-MM-DD"   the date the value describes
 *   data-max-age-days="2"        the cadence the source allows
 *   data-freshness="fresh|stale" what the page decided
 * The spec recomputes staleness ITSELF from data-observed and today's date and
 * checks the visible copy, so a page cannot pass by lying to itself:
 *   stale ⇒ the copy says "since <date>" (or "yet") and never "Last night"/"today"
 *   fresh ⇒ the copy carries the date and never says "since"
 * With no rows at all (an empty demo DB) there are no such elements and the guard
 * passes vacuously; on a real database it is the regression test for #713/#731.
 */

const PAGES = ["/", "/sleep"];

function todayNY(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function dayMs(d: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
}

for (const path of PAGES) {
  test(`freshness labels are honest on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const els = page.locator("[data-observed][data-max-age-days]");
    const n = await els.count();
    test.info().annotations.push({ type: "freshness-elements", description: String(n) });
    const today = todayNY();
    for (let i = 0; i < n; i++) {
      const el = els.nth(i);
      const observed = (await el.getAttribute("data-observed")) ?? "";
      const maxAge = Number(await el.getAttribute("data-max-age-days"));
      const decided = await el.getAttribute("data-freshness");
      const text = ((await el.textContent()) ?? "").replace(/\s+/g, " ").trim();
      const age = observed ? Math.round((dayMs(today) - dayMs(observed)) / 86_400_000) : Infinity;
      const stale = !observed || Number.isNaN(age) || age > maxAge;
      const where = `${path} [${i}] observed=${observed || "none"} age=${age} max=${maxAge} text="${text.slice(0, 80)}"`;
      expect(decided, `page decision must match the recomputed one: ${where}`).toBe(stale ? "stale" : "fresh");
      if (stale) {
        expect(text, `stale copy must say since/yet: ${where}`).toMatch(/\bsince\b|\byet\b/i);
        expect(text, `stale copy must not claim recency: ${where}`).not.toMatch(/last night(?!\s*·)|\btoday\b/i);
      } else {
        expect(text, `fresh copy must carry its date: ${where}`).toContain(observed);
        expect(text, `fresh copy must not say since: ${where}`).not.toMatch(/\bsince\b/i);
      }
    }
  });
}
