import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Public entry-point contract. Each path owns a task-shaped interface;
 * utility-only aliases stay on the root instead of becoming shallow modules.
 */
describe("public exports map", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  ) as { exports?: Record<string, unknown> };

  const expectedEntries = [
    ".",
    "./result",
    "./run",
    "./workflow",
    "./reliability",
    "./durable",
    "./persistence",
    "./saga",
    "./hitl",
    "./streaming",
    "./webhook",
    "./engine",
    "./testing",
  ];

  it("publishes exactly the task-shaped entries", () => {
    expect(Object.keys(pkg.exports ?? {})).toEqual([
      ...expectedEntries,
    ]);
  });

  it("builds every public entry file", () => {
    const tsupConfig = readFileSync(
      new URL("../../tsup.config.ts", import.meta.url),
      "utf8"
    );
    expect(tsupConfig).toContain("index: 'src/index.ts'");
    expect(tsupConfig).toContain("result: 'src/result/index.ts'");
    expect(tsupConfig).toContain("workflow: 'src/workflow-entry.ts'");
    for (const [name, source] of [
      ["run", "run-entry"],
      ["workflow", "workflow-entry"],
      ["reliability", "reliability-entry"],
      ["durable", "durable-entry"],
      ["persistence", "persistence-entry"],
      ["saga", "saga-entry"],
      ["hitl", "hitl-entry"],
      ["streaming", "streaming-entry"],
      ["webhook", "webhook-entry"],
      ["engine", "engine-entry"],
      ["testing", "testing-entry"],
    ]) {
      expect(tsupConfig).toContain(`${name}: 'src/${source}.ts'`);
    }

    // Removed dialects must not come back silently.
    for (const gone of ["'src/flow-entry.ts'", "'src/functional-entry.ts'", "'src/core-entry.ts'"]) {
      expect(tsupConfig).not.toContain(gone);
    }
  });
});
