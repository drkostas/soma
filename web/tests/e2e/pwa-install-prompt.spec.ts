import { test, expect } from "@playwright/test";

/**
 * #709: the install prompt is for mobile browsers only.
 *
 * The two projects in playwright.config.ts are the two cases: "desktop" is
 * Desktop Chrome at 1440×900 (fine pointer, desktop UA) and "mobile" is a
 * Pixel 7 (mobile UA, coarse pointer, 390×844). Each test runs in a fresh
 * context, so the 14-day dismissal in localStorage cannot leak between them.
 */
const PROMPT = '[data-testid="pwa-install-prompt"]';

test.describe("PWA install prompt", () => {
  test("is absent on a desktop browser", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop project only");
    await page.goto("/", { waitUntil: "networkidle" });
    // Give the client effect a beat: if it were going to mount, it would by now.
    await page.waitForTimeout(500);
    await expect(page.locator(PROMPT)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("pwa-desktop-absent.png") });
  });

  test("is shown on a mobile browser and can be dismissed", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile project only");
    await page.goto("/", { waitUntil: "networkidle" });
    const prompt = page.locator(PROMPT);
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText("Install Soma");
    // The native-build links are the point on a phone, event or no event.
    await expect(prompt.getByRole("link", { name: /Android/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("pwa-mobile-present.png") });
    await prompt.getByRole("button", { name: "Dismiss" }).click();
    await expect(prompt).toHaveCount(0);
  });
});
