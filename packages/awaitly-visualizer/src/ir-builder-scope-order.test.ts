import { describe, it, expect } from "vitest";
import { createIRBuilder } from "./ir-builder";

const workflowId = "wf-scope-order";

describe("createIRBuilder scope ordering", () => {
  it("maintains parent scope when inner scope ends", () => {
    const builder = createIRBuilder();

    builder.handleEvent({
      type: "workflow_start",
      workflowId,
      ts: 0,
    });

    builder.handleScopeEvent({
      type: "scope_start",
      workflowId,
      scopeId: "outer",
      scopeType: "all",
      ts: 1,
    });

    builder.handleScopeEvent({
      type: "scope_start",
      workflowId,
      scopeId: "inner",
      scopeType: "all",
      ts: 2,
    });

    builder.handleEvent({
      type: "step_start",
      workflowId,
      stepId: "step-1",
      stepKey: "inner",
      ts: 3,
    });

    builder.handleEvent({
      type: "step_success",
      workflowId,
      stepId: "step-1",
      stepKey: "inner",
      ts: 4,
      durationMs: 1,
    });

    builder.handleScopeEvent({
      type: "scope_end",
      workflowId,
      scopeId: "inner",
      ts: 5,
      durationMs: 3,
    });

    builder.handleEvent({
      type: "step_start",
      workflowId,
      stepId: "step-2",
      stepKey: "outer",
      ts: 6,
    });

    builder.handleEvent({
      type: "step_success",
      workflowId,
      stepId: "step-2",
      stepKey: "outer",
      ts: 7,
      durationMs: 1,
    });

    builder.handleScopeEvent({
      type: "scope_end",
      workflowId,
      scopeId: "outer",
      ts: 8,
      durationMs: 7,
    });

    const ir = builder.getIR();
    const outer = ir.root.children.find((node) => node.type === "parallel" && node.id === "outer");

    expect(outer).toBeDefined();
    if (outer?.type !== "parallel") return;

    const hasInner = outer.children.some((node) => node.type === "parallel" && node.id === "inner");
    const hasOuterStep = outer.children.some((node) => node.type === "step" && node.key === "outer");

    expect(hasInner).toBe(true);
    expect(hasOuterStep).toBe(true);
  });

  it("closes the correct scope when scope_end arrives out of order", () => {
    const builder = createIRBuilder();

    builder.handleEvent({
      type: "workflow_start",
      workflowId,
      ts: 0,
    });

    builder.handleScopeEvent({
      type: "scope_start",
      workflowId,
      scopeId: "outer",
      scopeType: "all",
      ts: 1,
    });

    builder.handleScopeEvent({
      type: "scope_start",
      workflowId,
      scopeId: "inner",
      scopeType: "all",
      ts: 2,
    });

    // Out-of-order end: outer ends before inner
    builder.handleScopeEvent({
      type: "scope_end",
      workflowId,
      scopeId: "outer",
      ts: 3,
      durationMs: 2,
    });

    builder.handleScopeEvent({
      type: "scope_end",
      workflowId,
      scopeId: "inner",
      ts: 4,
      durationMs: 2,
    });

    const ir = builder.getIR();
    const outer = ir.root.children.find((node) => node.type === "parallel" && node.id === "outer");
    const inner = ir.root.children.find((node) => node.type === "parallel" && node.id === "inner");

    // Expect outer to still be the parent container even with out-of-order events.
    expect(outer).toBeDefined();
    expect(inner).toBeUndefined();
  });
});
