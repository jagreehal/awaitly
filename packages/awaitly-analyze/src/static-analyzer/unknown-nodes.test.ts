/**
 * Unanalyzable awaited calls must surface as `unknown` nodes, never be
 * silently dropped — an incomplete diagram must say it's incomplete.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from ".";
import type { StaticFlowNode, StaticUnknownNode } from "../types";
import { getStaticChildren } from "../types";

function collectUnknownNodes(root: { children: StaticFlowNode[] }): StaticUnknownNode[] {
  const nodes: StaticUnknownNode[] = [];
  function walk(n: StaticFlowNode) {
    if (n.type === "unknown") nodes.push(n as StaticUnknownNode);
    for (const c of getStaticChildren(n)) walk(c);
  }
  for (const c of root.children) walk(c);
  return nodes;
}

const PREAMBLE = `
  import { run, ok, type AsyncResult } from 'awaitly';

  type User = { id: string };
  const getUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> => ok({ id });
  const helperWithHiddenSteps = async (): Promise<void> => {};
`;

describe("unknown nodes for unanalyzable awaits", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("emits an unknown node + warning for an awaited helper call", () => {
    const results = analyzeWorkflowSource(`${PREAMBLE}
      const result = await run(async ({ step }) => {
        const user = await step('getUser', () => getUser('1'));
        await helperWithHiddenSteps();
        return user;
      });
    `);
    expect(results).toHaveLength(1);
    const ir = results[0];
    const unknowns = collectUnknownNodes(ir.root);
    expect(unknowns).toHaveLength(1);
    expect(unknowns[0].sourceCode).toContain("helperWithHiddenSteps()");
    expect(unknowns[0].reason).toContain("not recognized");
    expect(ir.metadata.warnings.some((w) => w.code === "UNANALYZED_AWAIT")).toBe(true);
  });

  it("does not flag recognized step calls", () => {
    const results = analyzeWorkflowSource(`${PREAMBLE}
      const result = await run(async ({ step }) => {
        const user = await step('getUser', () => getUser('1'));
        return user;
      });
    `);
    const ir = results[0];
    expect(collectUnknownNodes(ir.root)).toHaveLength(0);
    expect(ir.metadata.warnings.some((w) => w.code === "UNANALYZED_AWAIT")).toBe(false);
  });
});
