/**
 * createWorkflow(...).runWithState(fn) is the persistence-by-hand entry point:
 * it returns the resume state alongside the result. It was discovered as a
 * workflow but produced no diagram nodes, and the empty-diagram hint told you
 * to pass the callback inline to run() — which it already was.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from ".";
import { renderStaticMermaid } from "../output/mermaid";

const SOURCE = `
import { createWorkflow, ok, type AsyncResult } from "awaitly";
const loadBatch = async (id: string): AsyncResult<{ id: string }, "NOT_FOUND"> => ok({ id });
const submitBatch = async (b: { id: string }): AsyncResult<string, "REJECTED"> => ok(b.id);

const workflow = createWorkflow("batchPipeline", { loadBatch, submitBatch });

export const result = workflow.runWithState(async ({ step, deps }) => {
  const batch = await step("loadBatch", () => deps.loadBatch("b-1"));
  return await step("submitBatch", () => deps.submitBatch(batch));
});
`;

describe("runWithState", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("produces the same diagram nodes as run()", () => {
    const results = analyzeWorkflowSource(SOURCE);
    expect(results).toHaveLength(1);

    const out = renderStaticMermaid(results[0]!, {});
    expect(out).toContain('"loadBatch"');
    expect(out).toContain('"submitBatch"');
  });
});
