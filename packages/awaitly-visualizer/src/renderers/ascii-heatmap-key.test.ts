import { describe, it, expect } from "vitest";
import { asciiRenderer } from "./ascii";
import { defaultColorScheme } from "./colors";
import type { EnhancedRenderOptions, WorkflowIR } from "../types";

describe("asciiRenderer heatmap key lookup", () => {
  it("applies heatmap colors when heatmap data is keyed by step key", () => {
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
            name: "Load data",
            key: "load-key",
            state: "success",
            durationMs: 10,
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const options: EnhancedRenderOptions = {
      showTimings: false,
      showKeys: false,
      terminalWidth: 80,
      colors: defaultColorScheme,
      showHeatmap: true,
      heatmapData: {
        heat: new Map([["load-key", 1]]),
        metric: "duration",
        stats: { min: 0, max: 1, mean: 1, threshold: 1 },
      },
    };

    const output = asciiRenderer().render(ir, options);

    // Critical heat uses red background (\x1b[41m)
    expect(output).toContain("\x1b[41m");
  });
});
