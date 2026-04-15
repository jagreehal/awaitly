import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 15000,
    exclude: ["src/__fixtures__/*.test.ts", "node_modules/**"],
  },
});
