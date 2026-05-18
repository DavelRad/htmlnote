import { defineConfig } from "vitest/config";

// Standalone config so vitest doesn't inherit vite.config.ts's `root: "src/ui"`
// (which is correct for building the SPA bundle, wrong for finding tests).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
