import { describe, it, expect } from "vitest";
import { createVisualizer } from "./index";

describe("visualizer json output BigInt handling", () => {
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
