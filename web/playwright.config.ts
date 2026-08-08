import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke-test config for soma/web.
 *
 * These tests run against a LIVE deployment (default: the public soma-demo
 * deployment, which runs in DEMO_MODE with no login required), NOT a local
 * dev server. soma/web has no committed DB schema, so a hermetic seed is out
 * of scope — instead we validate that every main page renders without a 5xx
 * or an error boundary against real demo data.
 *
 * Override the target with BASE_URL (e.g. a preview URL) when needed.
 */
const baseURL = process.env.BASE_URL || "https://soma-demo.gkos.dev";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // The demo can cold-start, so one retry smooths over the first slow hit.
  retries: 1,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    // Cold starts on the demo deploy can be slow; give navigation headroom.
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
});
