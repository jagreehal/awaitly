import { describe, it, expect } from "vitest";
import { createIRBuilder } from "./ir-builder";
import type { WorkflowEvent } from "awaitly/workflow";

describe("createIRBuilder", () => {
  it("records workflow end timestamp on success", () => {
    const builder = createIRBuilder();

    const start: WorkflowEvent<unknown> = {
      type: "workflow_start",
      workflowId: "wf-2",
      ts: 100,
    };

    const success: WorkflowEvent<unknown> = {
      type: "workflow_success",
      workflowId: "wf-2",
      ts: 150,
      durationMs: 50,
    };

    builder.handleEvent(start);
    builder.handleEvent(success);

    const ir = builder.getIR();

    expect(ir.root.endTs).toBe(150);
    expect(ir.root.durationMs).toBe(50);
  });

  it("marks workflow as aborted on workflow_cancelled", () => {
    const builder = createIRBuilder();

    const start: WorkflowEvent<unknown> = {
      type: "workflow_start",
      workflowId: "wf-1",
      ts: 0,
    };

    const cancelled: WorkflowEvent<unknown> = {
      type: "workflow_cancelled",
      workflowId: "wf-1",
      ts: 10,
      durationMs: 10,
      reason: "user abort",
    };

    builder.handleEvent(start);
    builder.handleEvent(cancelled);

    const ir = builder.getIR();

    expect(ir.root.state).toBe("aborted");
    expect(ir.root.durationMs).toBe(10);
  });

  it("nests scoped steps inside decision branches", () => {
    const builder = createIRBuilder();

    builder.handleEvent({
      type: "workflow_start",
      workflowId: "wf-3",
      ts: 0,
    });

    builder.handleDecisionEvent({
      type: "decision_start",
      workflowId: "wf-3",
      decisionId: "decision-1",
      ts: 1,
    });

    builder.handleDecisionEvent({
      type: "decision_branch",
      workflowId: "wf-3",
      decisionId: "decision-1",
      branchLabel: "if",
      taken: true,
      ts: 2,
    });

    builder.handleScopeEvent({
      type: "scope_start",
      workflowId: "wf-3",
      scopeId: "scope-1",
      scopeType: "all",
      ts: 3,
    });

    builder.handleEvent({
      type: "step_start",
      workflowId: "wf-3",
      stepId: "step-1",
      stepKey: "step-a",
      ts: 4,
    });

    builder.handleEvent({
      type: "step_success",
      workflowId: "wf-3",
      stepId: "step-1",
      stepKey: "step-a",
      ts: 5,
      durationMs: 1,
    });

    builder.handleScopeEvent({
      type: "scope_end",
      workflowId: "wf-3",
      scopeId: "scope-1",
      ts: 6,
      durationMs: 3,
    });

    builder.handleDecisionEvent({
      type: "decision_end",
      workflowId: "wf-3",
      decisionId: "decision-1",
      ts: 7,
      durationMs: 6,
    });

    const ir = builder.getIR();
    const decision = ir.root.children.find((node) => node.type === "decision");

    expect(decision).toBeDefined();
    if (decision?.type !== "decision") return;

    const branch = decision.branches.find((b) => b.label === "if");
    expect(branch).toBeDefined();

    const parallel = branch?.children.find((node) => node.type === "parallel");
    expect(parallel).toBeDefined();
    expect(parallel?.children?.length).toBe(1);
  });

  it("does not reopen a completed decision branch", () => {
    const builder = createIRBuilder();

    builder.handleEvent({
      type: "workflow_start",
      workflowId: "wf-4",
      ts: 0,
    });

    builder.handleDecisionEvent({
      type: "decision_start",
      workflowId: "wf-4",
      decisionId: "decision-1",
      ts: 1,
    });

    builder.handleDecisionEvent({
      type: "decision_branch",
      workflowId: "wf-4",
      decisionId: "decision-1",
      branchLabel: "if",
      taken: true,
      ts: 2,
    });

    builder.handleDecisionEvent({
      type: "decision_branch",
      workflowId: "wf-4",
      decisionId: "decision-1",
      branchLabel: "else",
      taken: false,
      ts: 3,
    });

    builder.handleDecisionEvent({
      type: "decision_end",
      workflowId: "wf-4",
      decisionId: "decision-1",
      ts: 4,
      durationMs: 3,
    });

    builder.handleEvent({
      type: "step_start",
      workflowId: "wf-4",
      stepId: "step-1",
      stepKey: "after",
      ts: 5,
    });

    builder.handleEvent({
      type: "step_success",
      workflowId: "wf-4",
      stepId: "step-1",
      stepKey: "after",
      ts: 6,
      durationMs: 1,
    });

    const ir = builder.getIR();
    const decision = ir.root.children.find((node) => node.type === "decision");
    const afterStep = ir.root.children.find((node) => node.type === "step");

    expect(decision).toBeDefined();
    expect(afterStep).toBeDefined();
  });

  it("attaches steps that run before branch is marked to the eventual branch", () => {
    const builder = createIRBuilder();

    builder.handleEvent({
      type: "workflow_start",
      workflowId: "wf-5",
      ts: 0,
    });

    builder.handleDecisionEvent({
      type: "decision_start",
      workflowId: "wf-5",
      decisionId: "decision-1",
      ts: 1,
    });

    builder.handleEvent({
      type: "step_start",
      workflowId: "wf-5",
      stepId: "step-1",
      stepKey: "early-step",
      ts: 2,
    });

    builder.handleEvent({
      type: "step_success",
      workflowId: "wf-5",
      stepId: "step-1",
      stepKey: "early-step",
      ts: 3,
      durationMs: 1,
    });

    builder.handleDecisionEvent({
      type: "decision_branch",
      workflowId: "wf-5",
      decisionId: "decision-1",
      branchLabel: "if",
      taken: true,
      ts: 4,
    });

    builder.handleDecisionEvent({
      type: "decision_end",
      workflowId: "wf-5",
      decisionId: "decision-1",
      ts: 5,
      durationMs: 4,
    });

    const ir = builder.getIR();
    const decision = ir.root.children.find((node) => node.type === "decision");

    expect(decision).toBeDefined();
    if (decision?.type !== "decision") return;

    const branch = decision.branches.find((b) => b.label === "if");
    const branchStep = branch?.children.find((node) => node.type === "step");

    expect(branchStep).toBeDefined();
  });

  it("uses a stable workflow id before workflow_start", () => {
    const builder = createIRBuilder();

    const first = builder.getIR();
    const second = builder.getIR();

    expect(first.root.id).toBe(second.root.id);
  });

  it("infers branchTaken from taken branch when decision_end omits it", () => {
    const builder = createIRBuilder();

    builder.handleDecisionEvent({
      type: "decision_start",
      workflowId: "wf-6",
      decisionId: "decision-1",
      ts: 1,
    });

    builder.handleDecisionEvent({
      type: "decision_branch",
      workflowId: "wf-6",
      decisionId: "decision-1",
      branchLabel: "if",
      taken: true,
      ts: 2,
    });

    builder.handleDecisionEvent({
      type: "decision_end",
      workflowId: "wf-6",
      decisionId: "decision-1",
      ts: 3,
      durationMs: 2,
    });

    const ir = builder.getIR();
    const decision = ir.root.children.find((node) => node.type === "decision");

    expect(decision).toBeDefined();
    if (decision?.type !== "decision") return;

    expect(decision.branchTaken).toBe("if");
  });

  it("clears previous nodes on new workflow_start", () => {
    const builder = createIRBuilder();

    builder.handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: 0 });
    builder.handleEvent({
      type: "step_start",
      workflowId: "wf-1",
      stepId: "step-1",
      stepKey: "old",
      ts: 1,
    });
    builder.handleEvent({
      type: "step_success",
      workflowId: "wf-1",
      stepId: "step-1",
      stepKey: "old",
      ts: 2,
      durationMs: 1,
    });

    builder.handleEvent({ type: "workflow_start", workflowId: "wf-2", ts: 10 });

    const ir = builder.getIR();
    const stepKeys = ir.root.children
      .filter((node) => node.type === "step")
      .map((node) => node.key);

    expect(stepKeys).toEqual([]);
  });

  it("clears previous workflow error/duration on new workflow_start", () => {
    const builder = createIRBuilder();

    builder.handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: 0 });
    builder.handleEvent({
      type: "workflow_error",
      workflowId: "wf-1",
      ts: 5,
      durationMs: 5,
      error: "fail",
    });

    builder.handleEvent({ type: "workflow_start", workflowId: "wf-2", ts: 10 });

    const ir = builder.getIR();
    expect(ir.root.error).toBeUndefined();
    expect(ir.root.durationMs).toBeUndefined();
    expect(ir.root.endTs).toBeUndefined();
  });
});
