import { describe, it, expect } from "vitest";
import { mermaidRenderer } from "./mermaid";
import { defaultColorScheme } from "./colors";
import type { EnhancedRenderOptions, WorkflowIR } from "../types";

describe("mermaidRenderer heatmap key lookup", () => {
  it("applies heatmap classes when heatmap data is keyed by step key", () => {
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

    const diagram = mermaidRenderer().render(ir, options);

    expect(diagram).toMatch(/step_load_key\[[^\]]*\]:::heat_critical/);
  });
});
