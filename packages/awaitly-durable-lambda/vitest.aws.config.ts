import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.test.ts"],
    // Real executions: waits, retries with delays, and callbacks take seconds.
    testTimeout: 180_000,
  },
});
