import { describe, it, expect } from "vitest";
import { createVisualizer } from "./index.browser";
import type { WorkflowEvent } from "awaitly/workflow";

describe("index.browser JSON output", () => {
  it("serializes onAfterStep hooks into JSON output", () => {
    const viz = createVisualizer();

    const events: WorkflowEvent<unknown>[] = [
      { type: "workflow_start", workflowId: "wf-1", ts: 0 },
      { type: "step_start", workflowId: "wf-1", stepId: "step-1", stepKey: "step-1", ts: 1 },
      { type: "step_success", workflowId: "wf-1", stepId: "step-1", stepKey: "step-1", ts: 2, durationMs: 1 },
      { type: "hook_after_step", workflowId: "wf-1", stepKey: "step-1", ts: 3, durationMs: 1 },
      { type: "workflow_success", workflowId: "wf-1", ts: 4, durationMs: 4 },
    ];

    events.forEach((event) => viz.handleEvent(event));

    const json = viz.renderAs("json");
    const parsed = JSON.parse(json) as { hooks?: { onAfterStep?: Record<string, unknown> } };

    expect(parsed.hooks).toBeDefined();
    expect(parsed.hooks?.onAfterStep).toBeDefined();
    expect(parsed.hooks?.onAfterStep?.["step-1"]).toBeDefined();
  });

  it("does not throw when decision values include BigInt", () => {
    const viz = createVisualizer();

    viz.handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: 0 });
    viz.handleDecisionEvent({
      type: "decision_start",
      workflowId: "wf-1",
      decisionId: "decision-1",
      decisionValue: 10n,
      ts: 1,
    });
    viz.handleDecisionEvent({
      type: "decision_end",
      workflowId: "wf-1",
      decisionId: "decision-1",
      ts: 2,
      durationMs: 1,
    });

    const json = viz.renderAs("json");
    const parsed = JSON.parse(json) as { root?: { children?: Array<{ decisionValue?: string }> } };

    const decision = parsed.root?.children?.[0];
    expect(decision?.decisionValue).toBe("10");
  });
});
