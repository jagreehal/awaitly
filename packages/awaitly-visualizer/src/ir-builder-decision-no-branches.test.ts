import { describe, it, expect } from "vitest";
import { createIRBuilder } from "./ir-builder";

describe("createIRBuilder decision without branch events", () => {
  it("preserves pending decision children when no branch events were emitted", () => {
    const builder = createIRBuilder();

    builder.handleDecisionEvent({
      type: "decision_start",
      workflowId: "wf-1",
      decisionId: "decision-1",
      ts: 1,
    });

    builder.handleEvent({
      type: "step_start",
      workflowId: "wf-1",
      stepId: "step-1",
      stepKey: "step-1",
      ts: 2,
    });

    builder.handleEvent({
      type: "step_success",
      workflowId: "wf-1",
      stepId: "step-1",
      stepKey: "step-1",
      ts: 3,
      durationMs: 1,
    });

    builder.handleDecisionEvent({
      type: "decision_end",
      workflowId: "wf-1",
      decisionId: "decision-1",
      ts: 4,
      durationMs: 3,
    });

    const ir = builder.getIR();
    const decision = ir.root.children.find((node) => node.type === "decision");

    expect(decision).toBeDefined();
    if (decision?.type !== "decision") return;

    const hasStep = decision.branches.some((branch) =>
      branch.children.some((node) => node.type === "step")
    );

    expect(hasStep).toBe(true);
  });
});
