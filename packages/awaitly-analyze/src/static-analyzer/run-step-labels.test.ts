/**
 * Step naming for the run() and durable.run() entry shapes.
 *
 * Both accept two callback shapes: the bound-steps form
 * `run(deps, async (s) => s.loadBatch())`, and the workflow form
 * `run(deps, async ({ step, deps }) => step("loadBatch", ...))`. Only
 * bound-steps detection was applied to the deps-first form, so a workflow-form
 * callback had its `step` binding go unrecognised and every step was rendered
 * as the generic callee "step" instead of its id.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from ".";
import { renderStaticMermaid } from "../output/mermaid";

const HEAD = `
import { durable } from "awaitly/durable";
import { run, ok, type AsyncResult } from "awaitly";
const loadBatch = async (id: string): AsyncResult<{ id: string }, "NOT_FOUND"> => ok({ id });
`;

function diagram(body: string): string {
  resetIdCounter();
  const results = analyzeWorkflowSource(HEAD + body);
  expect(results).toHaveLength(1);
  return renderStaticMermaid(results[0]!, {});
}

describe("step labels for deps-first entry points", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("names steps by id in the workflow form of run()", () => {
    const out = diagram(`
export const a = run({ loadBatch }, async ({ step, deps }) => {
  return await step("loadBatch", () => deps.loadBatch("b"));
});`);

    expect(out).toContain('"loadBatch"');
    expect(out).not.toContain('["step"]');
  });

  it("names steps by id in durable.run()", () => {
    const out = diagram(`
export const c = durable.run({ loadBatch }, async ({ step, deps }) => {
  return await step("loadBatch", () => deps.loadBatch("b"));
}, { id: "x" });`);

    expect(out).toContain('"loadBatch"');
    expect(out).not.toContain('["step"]');
  });

  it("still resolves the bound-steps form, where the param IS the deps object", () => {
    const out = diagram(`
export const b = run({ loadBatch }, async (s) => {
  return await s.loadBatch("b");
});`);

    expect(out).toContain('"loadBatch"');
  });
});
