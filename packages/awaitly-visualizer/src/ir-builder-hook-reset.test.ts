import { describe, it, expect } from "vitest";
import { createIRBuilder } from "./ir-builder";
import type { WorkflowEvent } from "awaitly/workflow";

const hookShouldRun: WorkflowEvent<unknown> = {
  type: "hook_should_run",
  workflowId: "wf-1",
  ts: 0,
  durationMs: 5,
  result: true,
  skipped: false,
};

const hookBeforeStart: WorkflowEvent<unknown> = {
  type: "hook_before_start",
  workflowId: "wf-1",
  ts: 1,
  durationMs: 3,
  result: true,
  skipped: false,
};

describe("IRBuilder hooks reset", () => {
  it("clears pre-start hooks when a new workflow run begins", () => {
    const builder = createIRBuilder();

    // First run with hooks
    builder.handleEvent(hookShouldRun);
    builder.handleEvent(hookBeforeStart);
    builder.handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: 2 });
    builder.handleEvent({ type: "workflow_success", workflowId: "wf-1", ts: 3, durationMs: 1 });

    const first = builder.getIR();
    expect(first.hooks?.shouldRun).toBeDefined();
    expect(first.hooks?.onBeforeStart).toBeDefined();

    // Second run, no hook events emitted
    builder.handleEvent({ type: "workflow_start", workflowId: "wf-2", ts: 10 });
    builder.handleEvent({ type: "workflow_success", workflowId: "wf-2", ts: 11, durationMs: 1 });

    const second = builder.getIR();
    expect(second.hooks).toBeUndefined();
  });
});
