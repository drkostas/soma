import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

// Minimal config: resolve the `@/` path alias (matches tsconfig) so route
// handlers that import `@/lib/*` can be unit-tested. Test discovery + all
// other behaviour stays on the vitest defaults.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    // The Playwright e2e specs under tests/e2e/** use @playwright/test (not
    // vitest) and run via `npm run e2e` — keep vitest from discovering them.
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});
