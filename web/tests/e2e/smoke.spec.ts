import { test, expect, type Page } from "@playwright/test";

/**
 * Smoke suite: every main page must render without a server error or an
 * error boundary against the live demo deployment.
 *
 * Assertions are deliberately STRUCTURAL (page <title>, hardcoded headings,
 * sidebar nav labels) and never touch dynamic demo data (KPI numbers, dates,
 * counts) so the suite stays green as the demo data changes.
 *
 * Evidence for each stable string is captured in PAGES below (verified against
 * the live rendered DOM and the page.tsx source).
 */

type PageSpec = {
  /** Route path. */
  path: string;
  /** Human label (also the nav label unless `navLabel` overrides). */
  name: string;
  /** Expected <title> tag text — the app template renders `Soma: <X>`. */
  title: string;
  /** A stable body element that this page renders (hardcoded in JSX). */
  heading: string;
  /**
   * ARIA role used to locate `heading`. Defaults to "heading" (h1..h6).
   * Nutrition's h1 is a live date, so it asserts on the always-present
   * "Trajectory" tab, which is a link ("link").
   */
  headingRole?: "heading" | "link";
  /** The sidebar nav label for this route (defaults to `name`). */
  navLabel?: string;
};

// Each `heading` and `title` below is verbatim from the live rendered DOM.
const PAGES: PageSpec[] = [
  { path: "/", name: "Overview", title: "Soma: Dashboard", heading: "Overview" },
  { path: "/running", name: "Running", title: "Soma: Running", heading: "Running" },
  { path: "/training", name: "Training", title: "Soma: Training", heading: "Training" },
  // Nutrition's h1 is a live date; assert on the always-present "Trajectory" tab (a link) instead.
  { path: "/nutrition", name: "Nutrition", title: "Soma: Nutrition", heading: "Trajectory", headingRole: "link" },
  { path: "/sleep", name: "Sleep", title: "Soma: Sleep", heading: "Sleep & Recovery" },
  { path: "/activities", name: "Activities", title: "Soma: Activities", heading: "Activities" },
  { path: "/workouts", name: "Gym", title: "Soma: Gym", heading: "Workouts", navLabel: "Gym" },
  { path: "/connections", name: "Sync", title: "Soma: Sync", heading: "Sync Hub", navLabel: "Sync" },
  { path: "/playlist", name: "Playlist", title: "Soma: Playlist", heading: "Playlist Builder" },
];

/** Text patterns that indicate a broken page (error boundary, crash, 500). */
const ERROR_PATTERNS: RegExp[] = [
  /Application error/i,
  /Internal Server Error/i,
  /This page could not be found/i,
  /Something went wrong/i,
  /500\s*[:-]/i,
];

async function assertNoErrorOverlay(page: Page): Promise<void> {
  const body = (await page.locator("body").innerText()).slice(0, 4000);
  for (const pattern of ERROR_PATTERNS) {
    expect(body, `error text ${pattern} should NOT be present`).not.toMatch(pattern);
  }
  // Next.js dev/prod error overlay + generic route error boundary.
  await expect(page.locator("nextjs-portal")).toHaveCount(0);
}

for (const spec of PAGES) {
  test(`smoke: ${spec.path} (${spec.name}) renders`, async ({ page }) => {
    const response = await page.goto(spec.path, { waitUntil: "domcontentloaded" });

    // 1. Response is not a server error (not 5xx). A null response can happen
    //    for client-side transitions, but a direct goto always yields one.
    expect(response, `no response for ${spec.path}`).not.toBeNull();
    const status = response!.status();
    expect(status, `status for ${spec.path} should not be 5xx`).toBeLessThan(500);
    expect(status, `status for ${spec.path} should not be 4xx`).toBeLessThan(400);

    // 2. Stable page <title> (proves the right route loaded, not a redirect).
    await expect(page).toHaveTitle(new RegExp(escapeRegExp(spec.title)));

    // 3. A stable, hardcoded body element is visible. Scope to an ARIA role
    //    (heading by default) so we never collide with a same-named sidebar
    //    nav label (e.g. "Activities"/"Running"), which is collapsed/hidden
    //    on desktop.
    await expect(
      page
        .getByRole(spec.headingRole ?? "heading", { name: new RegExp(escapeRegExp(spec.heading)) })
        .first(),
    ).toBeVisible();

    // 4. No error boundary / crash / 500 text on the page.
    await assertNoErrorOverlay(page);
  });
}

test("smoke: app shell (sidebar nav) renders", async ({ page }) => {
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response!.status()).toBeLessThan(400);

  // The sidebar is always rendered in the layout. Assert the full nav is present.
  const navLabels = PAGES.map((p) => p.navLabel ?? p.name);
  for (const label of navLabels) {
    await expect(
      page.getByRole("link", { name: new RegExp(escapeRegExp(label)) }).first(),
      `nav link "${label}" should be visible`,
    ).toBeVisible();
  }
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
