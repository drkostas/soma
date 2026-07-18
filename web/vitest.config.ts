import { defineConfig } from "vitest/config";
import path from "path";

// Minimal config: resolve the `@/` path alias (matches tsconfig) so route
// handlers that import `@/lib/*` can be unit-tested. Test discovery + all
// other behaviour stays on the vitest defaults.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
