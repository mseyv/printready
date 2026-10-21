import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside the React server bundle; it is a no-op under test.
      "server-only": path.resolve(import.meta.dirname, "tests/helpers/empty.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    setupFiles: ["tests/helpers/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
