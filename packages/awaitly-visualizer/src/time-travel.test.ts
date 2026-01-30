import { describe, it, expect, vi, afterEach } from "vitest";
import { createTimeTravelController } from "./time-travel";
import type { WorkflowEvent } from "awaitly/workflow";

describe("createTimeTravelController", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not throw when play() is called before seeking with autoRecord disabled", () => {
    vi.useFakeTimers();

    const controller = createTimeTravelController({ autoRecord: false });

    const events: WorkflowEvent<unknown>[] = [
      { type: "workflow_start", workflowId: "wf-1", ts: 0 },
      { type: "workflow_success", workflowId: "wf-1", ts: 10, durationMs: 10 },
    ];

    for (const event of events) {
      controller.handleEvent(event);
    }

    expect(() => controller.play()).not.toThrow();
    controller.pause();
  });

  it("syncs currentIndex to latest snapshot when recording is started", () => {
    const controller = createTimeTravelController({ autoRecord: false });

    controller.handleEvent({ type: "workflow_start", workflowId: "wf-2", ts: 0 });
    controller.handleEvent({
      type: "workflow_success",
      workflowId: "wf-2",
      ts: 10,
      durationMs: 10,
    });

    controller.startRecording();

    const state = controller.getState();
    expect(state.currentIndex).toBe(state.snapshots.length - 1);
  });
});
