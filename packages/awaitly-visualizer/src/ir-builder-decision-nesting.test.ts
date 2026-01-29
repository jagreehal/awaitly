import { describe, it, expect } from "vitest";
import { createIRBuilder } from "./ir-builder";

describe("createIRBuilder decision nesting", () => {
  it("handles decision_branch events for outer decisions while inner decisions are active", () => {
    const builder = createIRBuilder();

    builder.handleDecisionEvent({
      type: "decision_start",
      workflowId: "wf-1",
      decisionId: "outer",
      ts: 1,
    });

    builder.handleDecisionEvent({
      type: "decision_start",
      workflowId: "wf-1",
      decisionId: "inner",
      ts: 2,
    });

    // Branch event for outer decision arrives while inner is still active
    builder.handleDecisionEvent({
      type: "decision_branch",
      workflowId: "wf-1",
      decisionId: "outer",
      branchLabel: "if",
      taken: true,
      ts: 3,
    });

    builder.handleDecisionEvent({
      type: "decision_end",
      workflowId: "wf-1",
      decisionId: "inner",
      ts: 4,
      durationMs: 2,
    });

    builder.handleDecisionEvent({
      type: "decision_end",
      workflowId: "wf-1",
      decisionId: "outer",
      ts: 5,
      durationMs: 4,
    });

    const ir = builder.getIR();
    const outer = ir.root.children.find((node) => node.type === "decision" && node.id === "outer");

    expect(outer).toBeDefined();
    if (outer?.type !== "decision") return;

    const branch = outer.branches.find((b) => b.label === "if");
    expect(branch).toBeDefined();
    expect(branch?.taken).toBe(true);
  });
});
