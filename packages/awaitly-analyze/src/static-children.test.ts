/**
 * getStaticChildren is the shared way to walk an analysis tree. It had no case
 * for the workflow root, so any walk that started at `ir.root` stopped
 * immediately and saw no steps at all.
 */

import { describe, it, expect } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from "./static-analyzer";
import { getStaticChildren } from "./types";

const SOURCE = `
import { createWorkflow, ok, type AsyncResult } from "awaitly";
const loadBatch = async (id: string): AsyncResult<{ id: string }, "NOT_FOUND"> => ok({ id });
const wf = createWorkflow("walkable", { loadBatch });
export const r = wf.run(async ({ step, deps }) => step("loadBatch", () => deps.loadBatch("b")));
`;

describe("getStaticChildren", () => {
  it("descends from the workflow root", () => {
    resetIdCounter();
    const ir = analyzeWorkflowSource(SOURCE)[0]!;

    const children = getStaticChildren(ir.root);
    expect(children.length).toBeGreaterThan(0);

    // A walk from the root must reach the steps.
    const seen: string[] = [];
    const visit = (node: Parameters<typeof getStaticChildren>[0]): void => {
      if (node.type === "step" && node.name) seen.push(node.name);
      for (const child of getStaticChildren(node)) visit(child);
    };
    visit(ir.root);
    expect(seen).toContain("loadBatch");
  });
});
