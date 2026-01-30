import { describe, it, expect } from "vitest";
import { createIRBuilder } from "./ir-builder";

const workflowId = "wf-pending-branch";

describe("createIRBuilder pending decision branches", () => {
  it("attaches early steps to the correct branch when branch is marked later", () => {
    const builder = createIRBuilder();

    builder.handleEvent({
      type: "workflow_start",
      workflowId,
      ts: 0,
    });

    builder.handleDecisionEvent({
      type: "decision_start",
      workflowId,
      decisionId: "decision-1",
      ts: 1,
    });

    builder.handleEvent({
      type: "step_start",
      workflowId,
      stepId: "step-1",
      stepKey: "early",
      ts: 2,
    });

    builder.handleEvent({
      type: "step_success",
      workflowId,
      stepId: "step-1",
      stepKey: "early",
      ts: 3,
      durationMs: 1,
    });

    builder.handleDecisionEvent({
      type: "decision_branch",
      workflowId,
      decisionId: "decision-1",
      branchLabel: "if",
      taken: true,
      ts: 4,
    });

    builder.handleDecisionEvent({
      type: "decision_end",
      workflowId,
      decisionId: "decision-1",
      ts: 5,
      durationMs: 4,
    });

    const ir = builder.getIR();
    const decision = ir.root.children.find((node) => node.type === "decision");
    expect(decision).toBeDefined();
    if (decision?.type !== "decision") return;

    const branch = decision.branches.find((b) => b.label === "if");
    const step = branch?.children.find((node) => node.type === "step");
    expect(step).toBeDefined();
  });

  it("does not drop early steps when the first branch is not taken", () => {
    const builder = createIRBuilder();

    builder.handleEvent({
      type: "workflow_start",
      workflowId,
      ts: 0,
    });

    builder.handleDecisionEvent({
      type: "decision_start",
      workflowId,
      decisionId: "decision-2",
      ts: 1,
    });

    builder.handleEvent({
      type: "step_start",
      workflowId,
      stepId: "step-2",
      stepKey: "early",
      ts: 2,
    });

    builder.handleEvent({
      type: "step_success",
      workflowId,
      stepId: "step-2",
      stepKey: "early",
      ts: 3,
      durationMs: 1,
    });

    builder.handleDecisionEvent({
      type: "decision_branch",
      workflowId,
      decisionId: "decision-2",
      branchLabel: "if",
      taken: false,
      ts: 4,
    });

    builder.handleDecisionEvent({
      type: "decision_branch",
      workflowId,
      decisionId: "decision-2",
      branchLabel: "else",
      taken: true,
      ts: 5,
    });

    builder.handleDecisionEvent({
      type: "decision_end",
      workflowId,
      decisionId: "decision-2",
      ts: 6,
      durationMs: 5,
    });

    const ir = builder.getIR();
    const decision = ir.root.children.find((node) => node.type === "decision");
    expect(decision).toBeDefined();
    if (decision?.type !== "decision") return;

    const elseBranch = decision.branches.find((b) => b.label === "else");
    const step = elseBranch?.children.find((node) => node.type === "step");
    expect(step).toBeDefined();
  });
});
