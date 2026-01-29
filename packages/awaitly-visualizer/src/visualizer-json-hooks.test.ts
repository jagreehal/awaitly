import { describe, it, expect } from "vitest";
import { createVisualizer } from "./index";
import type { WorkflowEvent } from "awaitly/workflow";

describe("visualizer json output", () => {
  it("serializes onAfterStep hooks into JSON output", () => {
    const viz = createVisualizer();

    const events: WorkflowEvent<unknown>[] = [
      { type: "workflow_start", workflowId: "wf-1", ts: 0 },
      { type: "step_start", workflowId: "wf-1", stepId: "step-1", stepKey: "step-1", ts: 1 },
      { type: "step_success", workflowId: "wf-1", stepId: "step-1", stepKey: "step-1", ts: 2, durationMs: 1 },
      { type: "hook_after_step", workflowId: "wf-1", stepKey: "step-1", ts: 3, durationMs: 1 },
      { type: "workflow_success", workflowId: "wf-1", ts: 4, durationMs: 4 },
    ];

    events.forEach((event) => viz.handleEvent(event));

    const json = viz.renderAs("json");
    const parsed = JSON.parse(json) as { hooks?: { onAfterStep?: Record<string, unknown> } };

    expect(parsed.hooks).toBeDefined();
    expect(parsed.hooks?.onAfterStep).toBeDefined();
    expect(parsed.hooks?.onAfterStep?.["step-1"]).toBeDefined();
  });
});
