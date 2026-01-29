import { describe, it, expect } from "vitest";
import { createIRBuilder } from "./ir-builder";

const workflowId = "wf-branch-order";

describe("createIRBuilder branch ordering", () => {
  it("does not attach steps to a non-taken branch when it is the only branch so far", () => {
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

    // First branch arrives but is not taken
    builder.handleDecisionEvent({
      type: "decision_branch",
      workflowId,
      decisionId: "decision-1",
      branchLabel: "if",
      taken: false,
      ts: 2,
    });

    // Step executes after first branch but before taken branch is known
    builder.handleEvent({
      type: "step_start",
      workflowId,
      stepId: "step-1",
      stepKey: "step-a",
      ts: 3,
    });

    builder.handleEvent({
      type: "step_success",
      workflowId,
      stepId: "step-1",
      stepKey: "step-a",
      ts: 4,
      durationMs: 1,
    });

    // Taken branch appears later
    builder.handleDecisionEvent({
      type: "decision_branch",
      workflowId,
      decisionId: "decision-1",
      branchLabel: "else",
      taken: true,
      ts: 5,
    });

    builder.handleDecisionEvent({
      type: "decision_end",
      workflowId,
      decisionId: "decision-1",
      ts: 6,
      durationMs: 5,
    });

    const ir = builder.getIR();
    const decision = ir.root.children.find((node) => node.type === "decision");
    expect(decision).toBeDefined();
    if (decision?.type !== "decision") return;

    const ifBranch = decision.branches.find((b) => b.label === "if");
    const elseBranch = decision.branches.find((b) => b.label === "else");

    expect(ifBranch?.children.length).toBe(0);
    expect(elseBranch?.children.length).toBe(1);
  });
});
