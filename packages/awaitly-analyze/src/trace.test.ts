import { describe, it, expect } from "vitest";
import { traceFromEvents, type WorkflowTrace } from "./trace";
import { renderStaticMermaidWithTrace } from "./output/mermaid";
import { analyzeWorkflowSource } from "./static-analyzer";
import type { WorkflowEvent } from "awaitly/workflow";

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
      { stepId: "fetchUser", status: "success", durationMs: 3 },
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
});
