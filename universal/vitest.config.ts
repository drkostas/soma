import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // expo-secure-store imports react-native Flow sources via expo-modules-core; Vite cannot
    // parse those, so tests get an in-memory stand-in (soma#796).
    alias: {
      "expo-secure-store": path.resolve(__dirname, "src/test/expo-secure-store.stub.ts"),
    },
  },
});
