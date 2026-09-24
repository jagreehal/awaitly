/**
 * Static analysis of the deps-first form: run(deps, fn) with auto-bound steps.
 *
 * The callback's first parameter is the bound-steps object; calls like
 * `s.getOrder(id)` are steps whose ID is the dep key. The deps object is
 * run()'s first argument, so dependencies and error types resolve from it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from ".";
import { inferErrorsFromDependencies } from "./deps-types";
import { renderRailwayMermaid } from "../output/railway";
import type { StaticFlowNode, StaticStepNode, StaticWorkflowNode } from "../types";
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
      import { createWorkflow } from 'awaitly';
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

  it("detects steps awaited inline as arguments, in evaluation order", () => {
    const source = `${PREAMBLE}
      await run({ getOrder, getUser, charge }, async (s) => {
        const user = await s.getUser((await s.getOrder('o-1')).userId);
        return s.charge(100);
      });
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps.map((s) => s.stepId)).toEqual(["getOrder", "getUser", "charge"]);
    expect(results[0].metadata.warnings.some((w) => w.code === "UNANALYZED_AWAIT")).toBe(false);
  });

  it("detects nested destructured workflow steps: ({ steps: { getOrder } })", () => {
    const source = `${PREAMBLE}
      import { createWorkflow } from 'awaitly';
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
      import { createWorkflow } from 'awaitly';
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

  it("copies dep errorTypes onto bound steps so diagrams can draw err edges", () => {
    const source = `${PREAMBLE}
      await run({ getUser, getOrder }, async (s) => {
        const user = await s.getUser('1');
        return s.getOrder(user.id);
      });
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps.find((s) => s.stepId === "getUser")?.errors).toEqual(["USER_NOT_FOUND"]);
    expect(steps.find((s) => s.stepId === "getUser")?.errorsSource).toBe("inferred");

    const mermaid = renderRailwayMermaid(results[0]);
    expect(mermaid).toContain("-->|err|");
    expect(mermaid).toContain("USER_NOT_FOUND");
  });

  it("infers errors for a dep typed by reference (typeof fn) with error classes", () => {
    // An imported or declared function's type prints as \`typeof loadPdf\`, and error classes
    // print as \`import("./errors").PdfNotFound\` - neither parses as text, so this needs
    // the type checker.
    const source = `
      import { run, ok, err, type AsyncResult } from 'awaitly';

      class PdfNotFound extends Error { readonly _tag = 'PdfNotFound' as const; }
      class PdfUnreadable extends Error { readonly _tag = 'PdfUnreadable' as const; }
      type PdfError = PdfNotFound | PdfUnreadable;

      async function loadPdf(path: string): AsyncResult<string[], PdfError> {
        return path ? ok([path]) : err(new PdfNotFound());
      }

      await run({ loadPdf }, async (s) => s.loadPdf('a.pdf'));
    `;

    const results = analyzeWorkflowSource(source);
    const step = collectStepNodes(results[0].root).find((s) => s.stepId === "loadPdf");

    // each member of the named union, not the alias name "PdfError"
    expect(results[0].root.dependencies[0]?.errorTypes).toEqual(["PdfNotFound", "PdfUnreadable"]);
    expect(step?.errors).toEqual(["PdfNotFound", "PdfUnreadable"]);
    expect(step?.errorsSource).toBe("inferred");
  });

  it("infers errors for a dep that wraps another function", () => {
    const source = `
      import { run, ok, type AsyncResult } from 'awaitly';

      class ModelCallError extends Error { readonly _tag = 'ModelCallError' as const; }
      async function readContract(args: { pages: string[] }, deps: { model: string }): AsyncResult<string, ModelCallError | 'NO_USABLE_ANSWER'> {
        return ok(args.pages.join() + deps.model);
      }
      const deps = { model: 'gpt' };

      await run({ readContract: (pages: string[]) => readContract({ pages }, deps) }, async (s) => s.readContract(['p1']));
    `;

    const results = analyzeWorkflowSource(source);
    const step = collectStepNodes(results[0].root).find((s) => s.stepId === "readContract");

    expect(step?.errors).toEqual(["ModelCallError", "NO_USABLE_ANSWER"]);
  });

  it("copies each dep's own error union onto the matching bound step", () => {
    const source = `${PREAMBLE}
      await run({ getOrder, getUser, charge }, async (s) => {
        const order = await s.getOrder('o-1');
        const user = await s.getUser(order.userId);
        return s.charge(order.total);
      });
    `;

    const steps = collectStepNodes(analyzeWorkflowSource(source)[0].root);
    expect(steps.find((s) => s.stepId === "getOrder")?.errors).toEqual(["ORDER_NOT_FOUND"]);
    expect(steps.find((s) => s.stepId === "getUser")?.errors).toEqual(["USER_NOT_FOUND"]);
    expect(steps.find((s) => s.stepId === "charge")?.errors).toEqual(["CHARGE_DECLINED"]);
  });

  it("does not overwrite an explicit empty errors array", () => {
    const root: StaticWorkflowNode = {
      id: "wf",
      type: "workflow",
      workflowName: "test",
      source: "run",
      errorTypes: ["NOT_FOUND"],
      dependencies: [{ name: "getUser", errorTypes: ["NOT_FOUND"] }],
      children: [
        {
          id: "s1",
          type: "step",
          stepId: "getUser",
          name: "getUser",
          depSource: "getUser",
          errors: [],
          errorsSource: "explicit",
        } as StaticStepNode,
      ],
    };

    inferErrorsFromDependencies(root);
    expect((root.children[0] as StaticStepNode).errors).toEqual([]);
    expect((root.children[0] as StaticStepNode).errorsSource).toBe("explicit");
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

describe("dependency error inference", () => {
  it.each([undefined, ['OTHER']])("does not fall back from a known source to its display ID: %s", errors => {
    const step: StaticStepNode = {
      id: 's', type: 'step', stepId: 'load', depSource: 'other',
      errors, errorsSource: errors ? 'inferred' : undefined,
    };
    const root: StaticWorkflowNode = {
      id: 'wf', type: 'workflow', workflowName: 'test', source: 'run', errorTypes: [],
      dependencies: [
        { name: 'load', errorTypes: ['LOAD'] },
        { name: 'other', errorTypes: [] },
      ],
      children: [step],
    };
    inferErrorsFromDependencies(root);
    expect(step.errors).toEqual(errors);
  });

  it("preserves errors when the step ID matches a different dependency", () => {
    const source = `
      import { ok, type AsyncResult } from 'awaitly';
      import { createWorkflow } from 'awaitly/workflow';
      const load = async (): AsyncResult<string, 'LOAD'> => ok('x');
      const other = async (): AsyncResult<string, 'OTHER'> => ok('x');
      const wf = createWorkflow('x', { load });
      await wf.run(async ({ step }) => step('load', () => other()));
    `;
    const step = collectStepNodes(analyzeWorkflowSource(source)[0].root)[0];
    expect(step.errors).toEqual(['OTHER']);
  });

  it.each(['never', "'STRING'"])("collects all overload errors when the first returns %s", firstError => {
    const source = `
      import { run, ok, type AsyncResult } from 'awaitly';
      function choose(x: string): AsyncResult<string, ${firstError}>;
      function choose(x: number): AsyncResult<string, 'NUMBER'>;
      async function choose(x: string | number): AsyncResult<string, ${firstError} | 'NUMBER'> { return ok('x'); }
      await run({ choose }, async s => s.choose(42));
    `;
    const root = analyzeWorkflowSource(source)[0].root;
    const expected = firstError === 'never' ? ['NUMBER'] : ['STRING', 'NUMBER'];
    expect(root.dependencies[0].errorTypes).toEqual(expected);
    expect(collectStepNodes(root)[0].errors).toEqual(expected);
  });

  it("keeps call-specific inference for an overloaded dependency", () => {
    const source = `
      import { ok, type AsyncResult } from 'awaitly';
      import { createWorkflow } from 'awaitly/workflow';
      function choose(x: string): AsyncResult<string, 'STRING'>;
      function choose(x: number): AsyncResult<string, 'NUMBER'>;
      async function choose(x: string | number): AsyncResult<string, 'STRING' | 'NUMBER'> { return ok('x'); }
      const wf = createWorkflow('x', { choose });
      await wf.run(async ({ step }) => step('chosen', () => choose(42)));
    `;
    const step = collectStepNodes(analyzeWorkflowSource(source)[0].root)[0];
    expect(step.errors).toEqual(['NUMBER']);
  });

  it("reads named errors inside PromiseLike results", () => {
    const source = `
      import { run, type Result } from 'awaitly';
      class Unreadable extends Error { readonly _tag = 'Unreadable'; }
      declare function load(): PromiseLike<Result<string, Unreadable | 'A|B'>>;
      await run({ load }, async s => s.load());
    `;
    const root = analyzeWorkflowSource(source)[0].root;
    expect(root.dependencies[0].errorTypes).toEqual(['Unreadable', 'A|B']);
  });
});
