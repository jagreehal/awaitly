import { describe, it, expect } from "vitest";
import { createVisualizer } from "./index";
import type { WorkflowIR } from "./types";

describe("createVisualizer onUpdate", () => {
  it("applies workflowName to IR passed to update callbacks", () => {
    const viz = createVisualizer({ workflowName: "My Workflow" });
    let latest: WorkflowIR | undefined;

    viz.onUpdate((ir) => {
      latest = ir;
    });

    viz.handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: 0 });

    expect(latest?.root.name).toBe("My Workflow");
  });
});
