import { describe, it, expect } from "vitest";
import { createIRBuilder } from "./ir-builder";
import type { WorkflowEvent } from "awaitly/workflow";

describe("createIRBuilder stream error handling", () => {
  it("preserves stream error state after workflow completion", () => {
    const builder = createIRBuilder();

    const events: WorkflowEvent<unknown>[] = [
      { type: "workflow_start", workflowId: "wf-1", ts: 0 },
      { type: "stream_created", workflowId: "wf-1", namespace: "topic", ts: 1 },
      {
        type: "stream_error",
        workflowId: "wf-1",
        namespace: "topic",
        error: new Error("boom"),
        position: 10,
        ts: 2,
      },
      { type: "workflow_success", workflowId: "wf-1", ts: 3, durationMs: 3 },
    ];

    events.forEach((e) => builder.handleEvent(e));

    const ir = builder.getIR();
    const streamNode = ir.root.children.find((node) => node.type === "stream");

    expect(streamNode?.type).toBe("stream");
    if (streamNode?.type !== "stream") return;
    expect(streamNode.state).toBe("error");
  });
});
