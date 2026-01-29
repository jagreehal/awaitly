import { describe, it, expect } from "vitest";
import { trackIf } from "./decision-tracker";
import { createIRBuilder } from "./ir-builder";
import type { DecisionBranchEvent, DecisionEndEvent, DecisionStartEvent } from "./types";

const workflowId = "wf-decisions";

describe("trackIf", () => {
  it("emits both if/else branches so skipped branch is visible", () => {
    const events: Array<DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent> = [];

    const decision = trackIf("check", false, {
      workflowId,
      emit: (event) => events.push(event),
    });

    decision.else();
    decision.end();

    const builder = createIRBuilder();
    for (const event of events) {
      builder.handleDecisionEvent(event);
    }

    const ir = builder.getIR();
    const decisionNode = ir.root.children.find((node) => node.type === "decision");

    expect(decisionNode).toBeDefined();
    if (decisionNode?.type !== "decision") return;

    const labels = decisionNode.branches.map((branch) => branch.label).sort();
    expect(labels).toEqual(["else", "if"]);
  });

  it("does not override branchTaken when a later false branch is emitted", () => {
    const events: Array<DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent> = [];

    const decision = trackIf("check-2", true, {
      workflowId,
      emit: (event) => events.push(event),
    });

    decision.then();
    decision.else(); // should be skipped
    decision.end();

    const builder = createIRBuilder();
    for (const event of events) {
      builder.handleDecisionEvent(event);
    }

    const ir = builder.getIR();
    const decisionNode = ir.root.children.find((node) => node.type === "decision");

    expect(decisionNode).toBeDefined();
    if (decisionNode?.type !== "decision") return;

    expect(decisionNode.branchTaken).toBe("if");
  });
});
