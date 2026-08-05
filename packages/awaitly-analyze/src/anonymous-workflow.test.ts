/**
 * createWorkflow(deps) — the deps-first, unnamed form.
 *
 * The workflow name is optional; when omitted the analyzer recovers it from
 * the variable the workflow is bound to, so `const checkout = createWorkflow({...})`
 * still produces a workflow called "checkout" in diagrams and traces.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from "./static-analyzer";
import type { StaticFlowNode, StaticStepNode } from "./types";
import { getStaticChildren } from "./types";

function collectStepNodes(root: { children: StaticFlowNode[] }): StaticStepNode[] {
  const steps: StaticStepNode[] = [];
  function walk(n: StaticFlowNode) {
    if (n.type === "step") steps.push(n as StaticStepNode);
    for (const c of getStaticChildren(n)) walk(c);
  }
  for (const c of root.children) walk(c);
  return steps;
}

const PREAMBLE = `
  import { createWorkflow, ok, type AsyncResult } from 'awaitly';

  type Order = { id: string; userId: string; total: number };
  type Payment = { txId: string };

  const getOrder = async (id: string): AsyncResult<Order, 'ORDER_NOT_FOUND'> =>
    ok({ id, userId: 'u-1', total: 100 });
  const charge = async (amount: number): AsyncResult<Payment, 'CHARGE_DECLINED'> =>
    ok({ txId: 'tx-1' });
`;

describe("createWorkflow(deps) — deps-first, unnamed", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("takes the workflow name from the variable it is bound to", () => {
    const results = analyzeWorkflowSource(`${PREAMBLE}
      const checkout = createWorkflow({ getOrder, charge });
      await checkout.run(async ({ steps }) => {
        const order = await steps.getOrder('o-1');
        return steps.charge(order.total);
      });
    `);

    expect(results[0].root.workflowName).toBe("checkout");
  });

  it("reads deps from the first argument", () => {
    const results = analyzeWorkflowSource(`${PREAMBLE}
      const checkout = createWorkflow({ getOrder, charge });
      await checkout.run(async ({ steps }) => {
        const order = await steps.getOrder('o-1');
        return steps.charge(order.total);
      });
    `);

    expect(collectStepNodes(results[0].root).map((s) => s.stepId)).toEqual([
      "getOrder",
      "charge",
    ]);
  });

  it("does not mistake a trailing options object for deps", () => {
    const results = analyzeWorkflowSource(`${PREAMBLE}
      const checkout = createWorkflow({ getOrder }, { cache: new Map() });
      await checkout.run(async ({ steps }) => steps.getOrder('o-1'));
    `);

    expect(collectStepNodes(results[0].root).map((s) => s.stepId)).toEqual(["getOrder"]);
  });

  it("keeps the explicitly named form working", () => {
    const results = analyzeWorkflowSource(`${PREAMBLE}
      const thing = createWorkflow('explicit-name', { getOrder });
      await thing.run(async ({ steps }) => steps.getOrder('o-1'));
    `);

    expect(results[0].root.workflowName).toBe("explicit-name");
    expect(collectStepNodes(results[0].root).map((s) => s.stepId)).toEqual(["getOrder"]);
  });

  it("recognizes deps passed as an identifier, not just an inline literal", () => {
    // Regression: `createWorkflow(deps)` was read as the named form, producing
    // a workflow called "deps" with no dependencies.
    const results = analyzeWorkflowSource(`${PREAMBLE}
      const deps = { getOrder, charge };
      const checkout = createWorkflow(deps);
      await checkout.run(async ({ steps }) => {
        const order = await steps.getOrder('o-1');
        return steps.charge(order.total);
      });
    `);

    expect(results[0].root.workflowName).toBe("checkout");
    expect(collectStepNodes(results[0].root).map((s) => s.stepId)).toEqual([
      "getOrder",
      "charge",
    ]);
    expect(results[0].root.dependencies.map((d) => d.name)).toEqual(["getOrder", "charge"]);
  });

  it("resolves identifier deps in the named form too", () => {
    const results = analyzeWorkflowSource(`${PREAMBLE}
      const deps = { getOrder };
      const wf = createWorkflow('checkout', deps);
      await wf.run(async ({ steps }) => steps.getOrder('o-1'));
    `);

    expect(results[0].root.workflowName).toBe("checkout");
    expect(results[0].root.dependencies.map((d) => d.name)).toEqual(["getOrder"]);
  });

  it("still treats a string-valued variable as a workflow name", () => {
    const results = analyzeWorkflowSource(`${PREAMBLE}
      const wfName = 'from-variable';
      const wf = createWorkflow(wfName, { getOrder });
      await wf.run(async ({ steps }) => steps.getOrder('o-1'));
    `);

    expect(results[0].root.workflowName).toBe("from-variable");
    expect(results[0].root.dependencies.map((d) => d.name)).toEqual(["getOrder"]);
  });
});
