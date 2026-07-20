import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The exports-map contract: the canonical release has exactly four
 * entries. `awaitly/result` is the guaranteed-minimal entry (the size
 * contract), `awaitly` is the front door, `awaitly/workflow` is the
 * production tier, `awaitly/testing` is test utilities. Growing this
 * list is a design decision, not a convenience.
 */
describe("canonical exports map", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  ) as { exports?: Record<string, unknown> };

  it("publishes exactly the canonical entries", () => {
    expect(Object.keys(pkg.exports ?? {})).toEqual([
      ".",
      "./result",
      "./workflow",
      "./testing",
    ]);
  });

  it("builds exactly the canonical entry files", () => {
    const tsupConfig = readFileSync(
      new URL("../../tsup.config.ts", import.meta.url),
      "utf8"
    );
    expect(tsupConfig).toContain("index: 'src/index.ts'");
    expect(tsupConfig).toContain("result: 'src/result/index.ts'");
    expect(tsupConfig).toContain("workflow: 'src/workflow-entry.ts'");
    expect(tsupConfig).toContain("testing: 'src/testing-entry.ts'");
    // Killed entries must not come back silently
    for (const gone of ["'src/flow-entry.ts'", "'src/functional-entry.ts'", "'src/core-entry.ts'", "'src/run-entry.ts'"]) {
      expect(tsupConfig).not.toContain(gone);
    }
  });
});
