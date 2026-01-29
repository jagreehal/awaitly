import { describe, it, expect } from "vitest";
import { createTimeTravelController } from "./time-travel";
import type { WorkflowEvent } from "awaitly/workflow";

describe("createTimeTravelController stopRecording", () => {
  it("does not add new snapshots when recording is stopped", () => {
    const controller = createTimeTravelController();

    const start: WorkflowEvent<unknown> = {
      type: "workflow_start",
      workflowId: "wf-1",
      ts: 0,
    };

    controller.handleEvent(start);

    controller.stopRecording();

    const before = controller.getSnapshots().length;

    const success: WorkflowEvent<unknown> = {
      type: "workflow_success",
      workflowId: "wf-1",
      ts: 10,
      durationMs: 10,
    };

    controller.handleEvent(success);

    const after = controller.getSnapshots().length;

    expect(after).toBe(before);
  });
});
