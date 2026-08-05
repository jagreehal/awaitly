import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Public entry-point contract.
 *
 * Four entries, down from twelve. The split is by *decision the consumer
 * makes*, not by module:
 *   .          — Results, run, createWorkflow, policies: the 95% case
 *   ./result   — Result primitives only, with a whole-entry size guarantee
 *   ./durable  — production machinery (durable, persistence, saga, hitl,
 *                streaming, webhook, engine), too heavy for the root
 *   ./testing  — harness code that must never reach a production bundle
 *
 * Adding a fifth entry re-fragments the install story this collapse fixed.
 */
describe("public exports map", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  ) as { exports?: Record<string, unknown> };

  const expectedEntries = [".", "./result", "./durable", "./testing"];

  it("publishes exactly the four task-shaped entries", () => {
    expect(Object.keys(pkg.exports ?? {})).toEqual(expectedEntries);
  });

  it("builds every public entry file", () => {
    const tsupConfig = readFileSync(
      new URL("../../tsup.config.ts", import.meta.url),
      "utf8"
    );

    for (const [name, source] of [
      ["index", "src/index.ts"],
      ["result", "src/result/index.ts"],
      ["durable", "src/durable-bundle-entry.ts"],
      ["testing", "src/testing-entry.ts"],
    ]) {
      expect(tsupConfig).toContain(`${name}: '${source}'`);
    }

    // Absorbed entries must not come back silently: run/workflow/reliability
    // live on the root, the rest live behind ./durable.
    for (const gone of [
      "'src/run-entry.ts'",
      "'src/workflow-entry.ts'",
      "'src/reliability-entry.ts'",
      "'src/durable-entry.ts'",
      "'src/persistence-entry.ts'",
      "'src/saga-entry.ts'",
      "'src/hitl-entry.ts'",
      "'src/streaming-entry.ts'",
      "'src/webhook-entry.ts'",
      "'src/engine-entry.ts'",
      "'src/flow-entry.ts'",
      "'src/functional-entry.ts'",
      "'src/core-entry.ts'",
    ]) {
      expect(tsupConfig).not.toContain(gone);
    }
  });

  it("keeps createWorkflow and run importable from the root", async () => {
    const root = await import("../index");
    expect(typeof (root as Record<string, unknown>).createWorkflow).toBe("function");
    expect(typeof (root as Record<string, unknown>).run).toBe("function");
  });

  it("keeps the production machinery importable from ./durable", async () => {
    const durable = await import("../durable-bundle-entry");
    const names = durable as Record<string, unknown>;
    // `durable` is a namespace object: durable.run(deps, fn, { id, store }).
    expect(typeof (names.durable as { run?: unknown })?.run).toBe("function");
    expect(typeof names.createSagaWorkflow).toBe("function");
    expect(typeof names.createEngine).toBe("function");
  });
});
