/**
 * A workflow's name is what people read in the diagram, the doctor report and
 * the generated types file. `run@file:line` is a coordinate, not a name: it
 * churns whenever a line moves and says nothing about the workflow.
 *
 * Order of preference: the enclosing function, then a literal durable id,
 * then the file:line fallback for a genuinely anonymous call.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from ".";

const HEAD = `
import { durable } from "awaitly/durable";
import { run, ok, type AsyncResult } from "awaitly";
const loadBatch = async (id: string): AsyncResult<{ id: string }, "NOT_FOUND"> => ok({ id });
`;

function nameOf(body: string): string {
  resetIdCounter();
  const results = analyzeWorkflowSource(HEAD + body);
  expect(results).toHaveLength(1);
  return results[0]!.root.workflowName;
}

describe("run/durable.run workflow naming", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("uses the enclosing function name", () => {
    expect(
      nameOf(`
export function runBatch(store: unknown) {
  return durable.run({ loadBatch }, async ({ step, deps }) => {
    return await step("loadBatch", () => deps.loadBatch("b"));
  }, { id: \`batch-\${Math.random()}\`, store });
}`)
    ).toBe("runBatch");
  });

  it("uses an arrow function's variable name", () => {
    expect(
      nameOf(`
export const settleInvoices = async (store: unknown) => {
  return durable.run({ loadBatch }, async ({ step, deps }) => {
    return await step("loadBatch", () => deps.loadBatch("b"));
  }, { id: "x", store });
};`)
    ).toBe("settleInvoices");
  });

  it("falls back to a literal durable id at module level", () => {
    expect(
      nameOf(`
export const outcome = durable.run({ loadBatch }, async ({ step, deps }) => {
  return await step("loadBatch", () => deps.loadBatch("b"));
}, { id: "checkout-123" });`)
    ).toBe("checkout-123");
  });

  it("still falls back to run@file:line for an anonymous call", () => {
    expect(
      nameOf(`
await run(async ({ step }) => {
  return await step("loadBatch", () => loadBatch("b"));
});`)
    ).toMatch(/^run@/);
  });
});
