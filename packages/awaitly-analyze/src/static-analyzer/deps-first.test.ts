/**
 * Static analysis of the deps-first form: run(deps, fn) with auto-bound steps.
 *
 * The callback's first parameter is the bound-steps object; calls like
 * `s.getOrder(id)` are steps whose ID is the dep key. The deps object is
 * run()'s first argument, so dependencies and error types resolve from it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from ".";
import type { StaticFlowNode, StaticStepNode } from "../types";
import { getStaticChildren } from "../types";

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
  import { run, ok, err, type AsyncResult } from 'awaitly';

  type Order = { id: string; userId: string; total: number };
  type User = { id: string; name: string };
  type Payment = { txId: string };

  const getOrder = async (id: string): AsyncResult<Order, 'ORDER_NOT_FOUND'> =>
    ok({ id, userId: 'u-1', total: 100 });
  const getUser = async (id: string): AsyncResult<User, 'USER_NOT_FOUND'> =>
    ok({ id, name: 'Alice' });
  const charge = async (amount: number): AsyncResult<Payment, 'CHARGE_DECLINED'> =>
    ok({ txId: 'tx-1' });
`;

describe("deps-first form: run(deps, fn)", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("detects s.<key>() calls as steps with the dep key as ID", () => {
    const source = `${PREAMBLE}
      await run({ getOrder, getUser, charge }, async (s) => {
        const order = await s.getOrder('o-1');
        const user = await s.getUser(order.userId);
        return s.charge(order.total);
      });
    `;

    const results = analyzeWorkflowSource(source);
    expect(results).toHaveLength(1);

    const steps = collectStepNodes(results[0].root);
    expect(steps.map((s) => s.stepId)).toEqual(["getOrder", "getUser", "charge"]);
    expect(steps.map((s) => s.name)).toEqual(["getOrder", "getUser", "charge"]);
    expect(steps.map((s) => s.depSource)).toEqual(["getOrder", "getUser", "charge"]);
    expect(results[0].metadata.stats.totalSteps).toBe(3);
  });

  it("extracts dependencies from run()'s first argument", () => {
    const source = `${PREAMBLE}
      await run({ getOrder, getUser }, async (s) => {
        const order = await s.getOrder('o-1');
        return s.getUser(order.userId);
      });
    `;

    const results = analyzeWorkflowSource(source);
    const depNames = results[0].root.dependencies.map((d) => d.name);
    expect(depNames).toEqual(["getOrder", "getUser"]);
  });

  it("supports a destructured steps object: ({ getOrder }) => getOrder(id)", () => {
    const source = `${PREAMBLE}
      await run({ getOrder, getUser }, async ({ getOrder, getUser }) => {
        const order = await getOrder('o-1');
        return getUser(order.userId);
      });
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps.map((s) => s.stepId)).toEqual(["getOrder", "getUser"]);
  });

  it("maps renamed destructured bindings back to the dep key", () => {
    const source = `${PREAMBLE}
      await run({ getOrder }, async ({ getOrder: fetchOrder }) => {
        return fetchOrder('o-1');
      });
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps.map((s) => s.stepId)).toEqual(["getOrder"]);
  });

  it("still routes the classic step escape hatch: (s, { step })", () => {
    const source = `${PREAMBLE}
      await run({ getOrder }, async (s, { step }) => {
        const order = await s.getOrder('o-1');
        const shouted = await step('shout', () => ok('X'));
        return shouted;
      });
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps.map((s) => s.stepId)).toEqual(["getOrder", "shout"]);
  });

  it("does not emit STEP_MISSING_ID warnings for bound step calls", () => {
    const source = `${PREAMBLE}
      await run({ getOrder }, async (s) => {
        return s.getOrder('o-1');
      });
    `;

    const results = analyzeWorkflowSource(source);
    const warningCodes = results[0].metadata.warnings.map((w) => w.code);
    expect(warningCodes).not.toContain("STEP_MISSING_ID");
  });

  it("detects steps.<key>() in createWorkflow callbacks: ({ steps })", () => {
    const source = `${PREAMBLE}
      import { createWorkflow } from 'awaitly/workflow';
      const workflow = createWorkflow('checkout', { getOrder, getUser });
      await workflow.run(async ({ steps }) => {
        const order = await steps.getOrder('o-1');
        return steps.getUser(order.userId);
      });
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps.map((s) => s.stepId)).toEqual(["getOrder", "getUser"]);
    expect(steps.map((s) => s.depSource)).toEqual(["getOrder", "getUser"]);
  });

  it("detects nested destructured workflow steps: ({ steps: { getOrder } })", () => {
    const source = `${PREAMBLE}
      import { createWorkflow } from 'awaitly/workflow';
      const workflow = createWorkflow('checkout', { getOrder });
      await workflow.run(async ({ steps: { getOrder } }) => {
        return getOrder('o-1');
      });
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps.map((s) => s.stepId)).toEqual(["getOrder"]);
  });

  it("keeps classic step and steps working side by side in a workflow", () => {
    const source = `${PREAMBLE}
      import { createWorkflow } from 'awaitly/workflow';
      const workflow = createWorkflow('checkout', { getOrder, charge });
      await workflow.run(async ({ steps, step, deps }) => {
        const order = await steps.getOrder('o-1');
        const payment = await step('chargeNow', () => deps.charge(order.total));
        return payment;
      });
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps.map((s) => s.stepId)).toEqual(["getOrder", "chargeNow"]);
  });

  it("unwraps policy-wrapped deps: base types + policy chain recorded", () => {
    const source = `${PREAMBLE}
      import { retry, timeout } from 'awaitly';
      await run(
        { getOrder, charge: retry(timeout(charge, 5000), { attempts: 3 }) },
        async (s) => {
          const order = await s.getOrder('o-1');
          return s.charge(order.total);
        }
      );
    `;

    const results = analyzeWorkflowSource(source);
    const deps = results[0].root.dependencies;
    expect(deps.map((d) => d.name)).toEqual(["getOrder", "charge"]);

    const charge = deps.find((d) => d.name === "charge");
    // policy chain in application order, innermost first
    expect(charge?.policies).toEqual([
      { kind: "timeout", options: "5000" },
      { kind: "retry", options: "{ attempts: 3 }" },
    ]);
    // error union = base errors + TimeoutError (retry preserves)
    expect(charge?.errorTypes).toContain("CHARGE_DECLINED");
    expect(charge?.errorTypes).toContain("TimeoutError");

    const steps = collectStepNodes(results[0].root);
    expect(steps.map((s) => s.stepId)).toEqual(["getOrder", "charge"]);
  });

  it("fallback policy consumes the base error union", () => {
    const source = `${PREAMBLE}
      import { fallback } from 'awaitly';
      await run(
        { getUser: fallback(getUser, () => ({ id: 'guest', name: 'Guest' })) },
        async (s) => s.getUser('u-1')
      );
    `;

    const results = analyzeWorkflowSource(source);
    const dep = results[0].root.dependencies[0];
    expect(dep.name).toBe("getUser");
    expect(dep.errorTypes).toEqual([]);
    expect(dep.policies).toEqual([
      { kind: "fallback", options: "() => ({ id: 'guest', name: 'Guest' })" },
    ]);
  });

  it("fallback policy replaces base errors with the handler error union", () => {
    const source = `${PREAMBLE}
      import { fallback } from 'awaitly';
      type BackupUnavailable = 'BACKUP_UNAVAILABLE';
      const backup = async (): AsyncResult<User, BackupUnavailable> =>
        err('BACKUP_UNAVAILABLE');
      await run(
        { getUser: fallback(getUser, () => backup()) },
        async (s) => s.getUser('u-1')
      );
    `;

    const results = analyzeWorkflowSource(source);
    const dep = results[0].root.dependencies[0];
    expect(dep.errorTypes).toEqual(["BACKUP_UNAVAILABLE"]);
  });

  it("keeps legacy run(cb) detection unchanged", () => {
    const source = `${PREAMBLE}
      await run(async ({ step }) => {
        const order = await step('getOrder', () => getOrder('o-1'));
        return order;
      });
    `;

    const results = analyzeWorkflowSource(source);
    expect(results).toHaveLength(1);
    expect(results[0].root.dependencies).toEqual([]);
    const steps = collectStepNodes(results[0].root);
    expect(steps.map((s) => s.stepId)).toEqual(["getOrder"]);
  });

  it("keeps legacy run(cb, options) detection unchanged", () => {
    const source = `${PREAMBLE}
      await run(async ({ step }) => {
        return step('getOrder', () => getOrder('o-1'));
      }, { workflowName: 'legacy' });
    `;

    const results = analyzeWorkflowSource(source);
    expect(results).toHaveLength(1);
    const steps = collectStepNodes(results[0].root);
    expect(steps.map((s) => s.stepId)).toEqual(["getOrder"]);
  });
});
