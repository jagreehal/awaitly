import { describe, it, expect } from "vitest";
import { createPerformanceAnalyzer } from "./performance-analyzer";
import type { WorkflowIR } from "./types";
import type { WorkflowEvent } from "awaitly/workflow";

describe("performance analyzer heatmap lookup", () => {
  it("maps heat values when steps have stepId + name (no key)", () => {
    const analyzer = createPerformanceAnalyzer();

    const events: WorkflowEvent<unknown>[] = [
      {
        type: "step_start",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "My Step",
        ts: 0,
      },
      {
        type: "step_success",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "My Step",
        ts: 10,
        durationMs: 10,
      },
    ];

    analyzer.addRun({ id: "run-1", startTime: 0, events });

    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        children: [
          {
            type: "step",
            id: "step-1",
            name: "My Step",
            state: "success",
            durationMs: 10,
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const heatmap = analyzer.getHeatmap(ir, "duration");

    expect(heatmap.heat.has("step-1")).toBe(true);
  });
});
