/**
 * durable.run is the shape production code uses, so the analyzer has to find
 * it. Before this, only createWorkflow() and a bare run() were discovered, so
 * a durable workflow produced no diagram and teams kept a second
 * createWorkflow copy of the same pipeline just to document it.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from ".";

const DURABLE_SOURCE = `
import { durable } from "awaitly/durable";
import { ok, type AsyncResult } from "awaitly";

const loadBatch = async (id: string): AsyncResult<{ id: string }, "NOT_FOUND"> => ok({ id });
const submitBatch = async (b: { id: string }): AsyncResult<string, "REJECTED"> => ok(b.id);

export function runBatch(store: unknown) {
  return durable.run(
    { loadBatch, submitBatch },
    async ({ step, deps }) => {
      const batch = await step("loadBatch", () => deps.loadBatch("b-1"));
      return await step("submitBatch", () => deps.submitBatch(batch));
    },
    { id: "batch-1", store }
  );
}
`;

describe("durable.run discovery", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("discovers a durable.run workflow and its steps", () => {
    const results = analyzeWorkflowSource(DURABLE_SOURCE);

    expect(results).toHaveLength(1);
    expect(results[0]!.root.source).toBe("run");

    const stepIds = JSON.stringify(results[0]!.root);
    expect(stepIds).toContain("loadBatch");
    expect(stepIds).toContain("submitBatch");
  });
});
