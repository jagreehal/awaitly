import { describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

describe("root entry bundle budget", () => {
  it("keeps awaitly root entry lightweight", () => {
    const rootDist = resolve(__dirname, "../dist/index.js");
    if (!existsSync(rootDist)) {
      // Hermetic: skip when dist not built (e.g. clean checkout). Run after build to enforce.
      return;
    }
    const { size } = statSync(rootDist);
    // Guardrail: root entry should stay close to a minimal Result-focused bundle.
    expect(size).toBeLessThan(10_000);
  });
});
