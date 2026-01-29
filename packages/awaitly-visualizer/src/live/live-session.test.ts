import { describe, it, expect, vi, afterEach } from "vitest";
import { createLiveSession } from "./live-session";
import type { WorkflowEvent } from "awaitly/workflow";

function makeEvent(ts: number): WorkflowEvent<unknown> {
  return { type: "workflow_start", workflowId: "wf-1", ts };
}

describe("createLiveSession", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("posts at maxWait even with continuous updates before first post", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const postNew = vi.fn(async () => "msg-1");
    const updateExisting = vi.fn(async () => {});
    const finalize = vi.fn(async () => {});

    const session = createLiveSession(
      { title: "test", debounceMs: 500, maxWaitMs: 2000 },
      { postNew, updateExisting, finalize }
    );

    for (let t = 0; t <= 2100; t += 100) {
      session.update(makeEvent(t));
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(postNew).toHaveBeenCalledTimes(1);
    expect(updateExisting).not.toHaveBeenCalled();
  });

  it("resets max-wait timer after a post", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const postNew = vi.fn(async () => "msg-1");
    const updateExisting = vi.fn(async () => {});
    const finalize = vi.fn(async () => {});

    const session = createLiveSession(
      { title: "test", debounceMs: 500, maxWaitMs: 2000 },
      { postNew, updateExisting, finalize }
    );

    // First batch: should post at maxWait
    for (let t = 0; t <= 2100; t += 100) {
      session.update(makeEvent(t));
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(postNew).toHaveBeenCalledTimes(1);

    // More churn after the first post
    for (let t = 2200; t <= 4300; t += 100) {
      session.update(makeEvent(t));
      await vi.advanceTimersByTimeAsync(100);
    }

    // Should update existing once maxWait passes again
    expect(updateExisting).toHaveBeenCalledTimes(1);
  });

  it("finalize uses latest IR when updates are provided directly", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const postNew = vi.fn(async () => "msg-1");
    const updateExisting = vi.fn(async () => {});
    const finalize = vi.fn(async () => {});

    const session = createLiveSession(
      { title: "test", debounceMs: 10, maxWaitMs: 100 },
      { postNew, updateExisting, finalize }
    );

    const ir = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "running",
        children: [
          {
            type: "step",
            id: "step-1",
            state: "success",
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    session.update(ir);
    await vi.advanceTimersByTimeAsync(20);

    await session.finalize("completed");

    expect(finalize).toHaveBeenCalledTimes(1);
    const finalIr = finalize.mock.calls[0][1];
    expect(finalIr.root.children).toHaveLength(1);
    expect(finalIr.root.children[0]?.type).toBe("step");
  });

  it("tracks scope events and nests steps inside parallel nodes", async () => {
    const postNew = vi.fn(async () => "msg-1");
    const updateExisting = vi.fn(async () => {});
    const finalize = vi.fn(async () => {});

    const session = createLiveSession(
      { title: "test", debounceMs: 10, maxWaitMs: 100 },
      { postNew, updateExisting, finalize }
    );

    session.update({ type: "workflow_start", workflowId: "wf-1", ts: 0 });
    session.update({
      type: "scope_start",
      workflowId: "wf-1",
      scopeId: "scope-1",
      scopeType: "parallel",
      ts: 1,
    });
    session.update({
      type: "step_start",
      workflowId: "wf-1",
      stepId: "step-1",
      stepKey: "step-1",
      ts: 2,
    });
    session.update({
      type: "step_success",
      workflowId: "wf-1",
      stepId: "step-1",
      stepKey: "step-1",
      ts: 3,
      durationMs: 1,
    });
    session.update({
      type: "scope_end",
      workflowId: "wf-1",
      scopeId: "scope-1",
      ts: 4,
      durationMs: 3,
    });

    await session.finalize("completed");

    expect(finalize).toHaveBeenCalledTimes(1);
    const ir = finalize.mock.calls[0][1];
    expect(ir.root.children[0]?.type).toBe("parallel");
  });

  it("tracks decision events and emits a decision node", async () => {
    const postNew = vi.fn(async () => "msg-1");
    const updateExisting = vi.fn(async () => {});
    const finalize = vi.fn(async () => {});

    const session = createLiveSession(
      { title: "test", debounceMs: 10, maxWaitMs: 100 },
      { postNew, updateExisting, finalize }
    );

    session.update({ type: "workflow_start", workflowId: "wf-1", ts: 0 });
    session.update({
      type: "decision_start",
      workflowId: "wf-1",
      decisionId: "decision-1",
      ts: 1,
    });
    session.update({
      type: "decision_branch",
      workflowId: "wf-1",
      decisionId: "decision-1",
      branchLabel: "if",
      taken: true,
      ts: 2,
    });
    session.update({
      type: "decision_end",
      workflowId: "wf-1",
      decisionId: "decision-1",
      ts: 3,
      durationMs: 2,
    });

    await session.finalize("completed");

    const ir = finalize.mock.calls[0][1];
    const decisionNode = ir.root.children.find((node) => node.type === "decision");
    expect(decisionNode).toBeDefined();
  });
});
