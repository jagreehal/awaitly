import { describe, it, expect } from "vitest";
import { createIRBuilder } from "./ir-builder";

describe("createIRBuilder decision end ordering", () => {
  it("handles decision_end events that arrive out of order", () => {
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

    // Out-of-order: outer ends before inner
    builder.handleDecisionEvent({
      type: "decision_end",
      workflowId: "wf-1",
      decisionId: "outer",
      ts: 3,
      durationMs: 2,
    });

    builder.handleDecisionEvent({
      type: "decision_end",
      workflowId: "wf-1",
      decisionId: "inner",
      ts: 4,
      durationMs: 2,
    });

    const ir = builder.getIR();
    const outer = ir.root.children.find((node) => node.type === "decision" && node.id === "outer");
    const inner = ir.root.children.find((node) => node.type === "decision" && node.id === "inner");

    expect(outer).toBeDefined();
    expect(inner).toBeDefined();
  });
});
