import { describe, it, expect } from "vitest";
import { flowchartRenderer } from "./flowchart";
import { defaultColorScheme } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";
import type { HeatmapData } from "../types";

const makeHeatmap = (id: string): HeatmapData => ({
  metric: "duration",
  heat: new Map([[id, 1]]),
  stats: { min: 0, max: 1, mean: 1, threshold: 1 },
});

describe("flowchartRenderer heatmap", () => {
  it("applies heatmap to steps using stepKey when name is missing", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        startTs: 0,
        endTs: 1,
        children: [
          {
            type: "step",
            id: "step-1",
            key: "step-key",
            state: "success",
            startTs: 0,
            endTs: 1,
            durationMs: 1,
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const options = {
      showTimings: false,
      showKeys: false,
      terminalWidth: 80,
      colors: defaultColorScheme,
      showHeatmap: true,
      heatmapData: makeHeatmap("step-key"),
    } satisfies RenderOptions;

    const output = flowchartRenderer().render(ir, options);

    // Heatmap uses red background (critical) when heat is 1
    expect(output).toContain("\x1b[41m");
  });
});
