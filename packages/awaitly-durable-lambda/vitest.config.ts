import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // e2e/ runs against real AWS via `pnpm test:aws`, never by default.
    include: ["src/**/*.test.ts"],
  },
});
