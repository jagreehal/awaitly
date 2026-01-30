import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR, HeatmapData } from "../types";

describe("renderToHTML heatmap initial data", () => {
  it("embeds provided heatmap data for static rendering", () => {
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
            name: "step",
            state: "success",
            durationMs: 5,
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const heatmapData: HeatmapData = {
      heat: new Map([["step-1", 0.5]]),
      metric: "duration",
      stats: { min: 0, max: 10, mean: 5, threshold: 7.5 },
    };

    const html = renderToHTML(ir, {
      heatmap: true,
      heatmapData,
      showTimings: false,
    });

    expect(html).toContain("__PERFORMANCE_DATA__");
    expect(html).toContain("step-1");
  });
});
