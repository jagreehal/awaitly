import { describe, it, expect } from "vitest";
import { traceFromEvents, type WorkflowTrace } from "./trace";
import { renderStaticMermaidWithTrace } from "./output/mermaid";
import { renderStaticMermaid } from "./output/mermaid";
import { analyzeWorkflowSource } from "./static-analyzer";
import type { WorkflowEvent } from "awaitly";

type AnyEvent = WorkflowEvent<unknown, unknown>;

// Minimal event factory — only the fields the reducer reads.
const ev = (type: string, stepId: string, extra: Record<string, unknown> = {}) =>
  ({ type, workflowId: "wf", ts: 0, stepId, ...extra }) as unknown as AnyEvent;

describe("traceFromEvents", () => {
  it("reduces a stream to final per-step statuses in first-seen order", () => {
    const trace = traceFromEvents([
      ev("step_start", "fetchUser"),
      ev("step_success", "fetchUser", { durationMs: 12 }),
      ev("step_start", "charge"),
      ev("step_error", "charge", { durationMs: 5 }),
    ]);
    expect(trace.steps).toEqual([
      { stepId: "fetchUser", status: "success", durationMs: 12 },
      { stepId: "charge", status: "error", durationMs: 5 },
    ]);
  });

  it("leaves an unfinished step as running", () => {
    const trace = traceFromEvents([ev("step_start", "slow")]);
    expect(trace.steps[0]).toEqual({ stepId: "slow", status: "running" });
  });

  it("maps cache hits and skips", () => {
    const trace = traceFromEvents([
      ev("step_cache_hit", "cached"),
      ev("step_skipped", "gated"),
    ]);
    expect(trace.steps.map((s) => s.status)).toEqual(["cache-hit", "skipped"]);
  });

  it("falls back to stepKey / name when stepId is absent", () => {
    const trace = traceFromEvents([
      { type: "step_success", workflowId: "wf", ts: 0, stepKey: "byKey", durationMs: 1 } as unknown as AnyEvent,
      { type: "step_success", workflowId: "wf", ts: 0, name: "byName", durationMs: 1 } as unknown as AnyEvent,
    ]);
    expect(trace.steps.map((s) => s.stepId)).toEqual(["byKey", "byName"]);
  });

  it("uses the literal step name when runtime identity uses a custom key", () => {
    const trace = traceFromEvents([
      ev("step_start", "user:42", { stepKey: "user:42", name: "fetchUser" }),
      ev("step_success", "user:42", {
        stepKey: "user:42",
        name: "fetchUser",
        durationMs: 3,
      }),
    ]);

    expect(trace.steps).toEqual([
      {
        stepId: "fetchUser",
        instanceId: "user:42",
        status: "success",
        durationMs: 3,
      },
    ]);
  });

  it("keeps each forEach iteration as its own step so later statuses cannot wipe earlier ones", () => {
    const trace = traceFromEvents([
      ev("step_success", "submitPayment@submit-0", {
        stepKey: "submitPayment@submit-0",
        name: "submitPayment",
      }),
      ev("step_success", "submitPayment@submit-1", {
        stepKey: "submitPayment@submit-1",
        name: "submitPayment",
      }),
      ev("step_aborted", "submitPayment@submit-2", {
        stepKey: "submitPayment@submit-2",
        name: "submitPayment",
      }),
    ]);

    expect(trace.steps).toEqual([
      {
        stepId: "submitPayment",
        instanceId: "submitPayment@submit-0",
        status: "success",
      },
      {
        stepId: "submitPayment",
        instanceId: "submitPayment@submit-1",
        status: "success",
      },
      {
        stepId: "submitPayment",
        instanceId: "submitPayment@submit-2",
        status: "aborted",
      },
    ]);
  });

  it("captures decision events with the branch taken (last evaluation wins)", () => {
    const trace = traceFromEvents([
      {
        type: "decision",
        workflowId: "wf",
        ts: 0,
        decisionId: "premium-check",
        label: "user.premium",
        branch: "then",
        value: true,
      } as unknown as AnyEvent,
    ]);
    expect(trace.decisions).toEqual([
      { decisionId: "premium-check", branch: "then", label: "user.premium" },
    ]);
  });

  it("counts retries on the step", () => {
    const trace = traceFromEvents([
      ev("step_start", "flaky"),
      ev("step_retry", "flaky", { attempt: 1 }),
      ev("step_retry", "flaky", { attempt: 2 }),
      ev("step_success", "flaky", { durationMs: 9 }),
    ]);
    expect(trace.steps).toEqual([
      { stepId: "flaky", status: "success", durationMs: 9, retries: 2 },
    ]);
  });
});

describe("renderStaticMermaidWithTrace", () => {
  const source = `
    import { createWorkflow } from "awaitly";
    const wf = createWorkflow("wf", { fetchUser, charge });
    export async function runIt() {
      return await wf.run(async ({ step, deps }) => {
        const user = await step("fetchUser", () => deps.fetchUser("1"));
        const c = await step("charge", () => deps.charge(user));
        return c;
      });
    }
    declare const fetchUser: (id: string) => Promise<any>;
    declare const charge: (u: any) => Promise<any>;
  `;

  it("overlays trace status classes on matched nodes", () => {
    const [ir] = analyzeWorkflowSource(source);
    const trace: WorkflowTrace = {
      steps: [
        { stepId: "fetchUser", status: "success" },
        { stepId: "charge", status: "error" },
      ],
    };
    const { mermaid, matched, unmatched } = renderStaticMermaidWithTrace(ir, trace);
    expect(matched).toEqual(["fetchUser", "charge"]);
    expect(unmatched).toEqual([]);
    expect(mermaid).toContain("classDef trace_success");
    expect(mermaid).toContain("classDef trace_error");
    // A trace class assignment is present (wins over the base step style).
    expect(mermaid).toMatch(/class step_\d+ trace_success/);
    expect(mermaid).toMatch(/class step_\d+ trace_error/);
  });

  it("reports trace steps with no matching static node", () => {
    const [ir] = analyzeWorkflowSource(source);
    const trace: WorkflowTrace = {
      steps: [{ stepId: "ghostStep", status: "success" }],
    };
    const { matched, unmatched } = renderStaticMermaidWithTrace(ir, trace);
    expect(matched).toEqual([]);
    expect(unmatched).toEqual(["ghostStep"]);
  });

  it("adds no overlay styles for an empty trace", () => {
    const [ir] = analyzeWorkflowSource(source);
    const { mermaid } = renderStaticMermaidWithTrace(ir, { steps: [] });
    expect(mermaid).not.toContain("classDef trace_");
  });

  it("overlays evaluated decisions on the decision diamond", () => {
    const decisionSource = `
      import { createWorkflow } from "awaitly";
      const wf = createWorkflow("wf", { fetchUser });
      export async function runIt() {
        return await wf.run(async ({ step, deps }) => {
          const user = await step("fetchUser", () => deps.fetchUser("1"));
          if (step.if("premium-check", "user.premium", () => user.premium)) {
            return "premium";
          }
          return "basic";
        });
      }
      declare const fetchUser: (id: string) => Promise<any>;
    `;
    const [ir] = analyzeWorkflowSource(decisionSource);
    const trace: WorkflowTrace = {
      steps: [{ stepId: "fetchUser", status: "success" }],
      decisions: [{ decisionId: "premium-check", branch: "then" }],
    };
    const { mermaid, matched, unmatched } = renderStaticMermaidWithTrace(ir, trace);
    expect(unmatched).toEqual([]);
    expect(matched).toContain("premium-check");
    expect(mermaid).toContain("classDef trace_decision");
    expect(mermaid).toMatch(/class decision_\d+ trace_decision/);
  });

  it("unrolls observed forEach iterations so crash statuses sit on different nodes", () => {
    const forEachSource = `
      import { createWorkflow, ok, type AsyncResult } from "awaitly";
      type ProviderRejected = { type: "PROVIDER_REJECTED" };
      const wf = createWorkflow("submit-batch", {
        submitPayment: async (
          _id: string
        ): Promise<AsyncResult<{ ref: string }, ProviderRejected>> => ok({ ref: "r1" }),
      });
      export async function run(payments: string[]) {
        return wf.run(async ({ step, deps }) => {
          await step.forEach("submitPayments", payments, {
            stepIdPattern: "submit-{i}",
            maxIterations: 500,
            run: (payment) =>
              step.retry("submitPayment", () => deps.submitPayment(payment), {
                attempts: 3,
                backoff: "exponential",
              }),
          });
        });
      }
    `;
    const [ir] = analyzeWorkflowSource(forEachSource);
    const skeleton = renderStaticMermaid(ir);
    expect(skeleton).toMatch(/loop_start_/);
    expect(skeleton).not.toContain("submit-0");

    const { mermaid, unmatched } = renderStaticMermaidWithTrace(ir, {
      steps: [
        {
          stepId: "submitPayment",
          instanceId: "submitPayment@submit-0",
          status: "success",
        },
        {
          stepId: "submitPayment",
          instanceId: "submitPayment@submit-1",
          status: "success",
        },
        {
          stepId: "submitPayment",
          instanceId: "submitPayment@submit-2",
          status: "aborted",
        },
      ],
    });

    expect(unmatched).toEqual([]);
    expect(mermaid).toContain("submit-0");
    expect(mermaid).toContain("submit-1");
    expect(mermaid).toContain("submit-2");
    const successNodes = [...mermaid.matchAll(/class (step_\d+) trace_success/g)].map(
      (m) => m[1]
    );
    const abortedNodes = [...mermaid.matchAll(/class (step_\d+) trace_aborted/g)].map(
      (m) => m[1]
    );
    expect(successNodes).toHaveLength(2);
    expect(abortedNodes).toHaveLength(1);
    expect(new Set([...successNodes, ...abortedNodes]).size).toBe(3);
  });

  it("unrolls a resume run so cache hits and the replayed iteration sit on different nodes", () => {
    const forEachSource = `
      import { createWorkflow, ok, type AsyncResult } from "awaitly";
      type ProviderRejected = { type: "PROVIDER_REJECTED" };
      const wf = createWorkflow("submit-batch", {
        submitPayment: async (
          _id: string
        ): Promise<AsyncResult<{ ref: string }, ProviderRejected>> => ok({ ref: "r1" }),
      });
      export async function run(payments: string[]) {
        return wf.run(async ({ step, deps }) => {
          await step.forEach("submitPayments", payments, {
            stepIdPattern: "submit-{i}",
            maxIterations: 500,
            run: (payment) =>
              step.retry("submitPayment", () => deps.submitPayment(payment), {
                attempts: 3,
              }),
          });
        });
      }
    `;
    const [ir] = analyzeWorkflowSource(forEachSource);
    const { mermaid, unmatched } = renderStaticMermaidWithTrace(ir, {
      steps: [
        {
          stepId: "submitPayment",
          instanceId: "submitPayment@submit-0",
          status: "cache-hit",
        },
        {
          stepId: "submitPayment",
          instanceId: "submitPayment@submit-1",
          status: "cache-hit",
        },
        {
          stepId: "submitPayment",
          instanceId: "submitPayment@submit-2",
          status: "success",
        },
      ],
    });

    expect(unmatched).toEqual([]);
    const cacheHitNodes = [
      ...mermaid.matchAll(/class (step_\d+) trace_cache-hit/g),
    ].map((m) => m[1]);
    const successNodes = [...mermaid.matchAll(/class (step_\d+) trace_success/g)].map(
      (m) => m[1]
    );
    expect(cacheHitNodes).toHaveLength(2);
    expect(successNodes).toHaveLength(1);
    expect(new Set([...cacheHitNodes, ...successNodes]).size).toBe(3);
  });
});

describe("saga compensation rendering", () => {
  it("shows each failure entry point, LIFO rollback, and compensation failure", () => {
    const source = `
      import { createSagaWorkflow } from "awaitly/durable";
      const saga = createSagaWorkflow("checkout", { charge, refund, reserve, release, ship });
      export async function runIt() {
        return saga.run(async ({ step, deps }) => {
          const payment = await step("charge", () => deps.charge(), {
            compensate: () => deps.refund(),
          });
          const stock = await step("reserve", () => deps.reserve(), {
            compensate: () => deps.release(),
          });
          await step("ship", () => deps.ship());
          return { payment, stock };
        });
      }
      declare const charge: () => Promise<any>;
      declare const refund: () => Promise<any>;
      declare const reserve: () => Promise<any>;
      declare const release: () => Promise<any>;
      declare const ship: () => Promise<any>;
    `;
    const [ir] = analyzeWorkflowSource(source);
    const mermaid = renderStaticMermaid(ir, { showSagaCompensations: true });

    expect(mermaid).toContain('compensation_1["undo: refund"]');
    expect(mermaid).toContain('compensation_2["undo: release"]');
    expect(mermaid).toMatch(/saga_step_\d+ -\.->\|error · rollback\| compensation_2/);
    expect(mermaid).toContain("compensation_2 -.->|then| compensation_1");
    expect(mermaid).toContain('saga_compensation_failure["SagaCompensationError"]');
    expect(mermaid).toContain("compensation_1 -.->|failure| saga_compensation_failure");
  });
});
