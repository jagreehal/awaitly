import { describe, it, expect } from "vitest";
import { flowchartRenderer } from "./flowchart";
import { renderSparkline } from "./ascii";
import { defaultColorScheme, stripAnsi } from "./colors";
import type { EnhancedRenderOptions, WorkflowIR } from "../types";

describe("flowchartRenderer sparklines keyed by step key", () => {
  it("renders sparklines when timingHistory is keyed by step key", () => {
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
      showSparklines: true,
      timingHistory: new Map([["load-key", [5, 10, 20]]]),
    };

    const output = flowchartRenderer().render(ir, options);
    const sparkline = renderSparkline([5, 10, 20]);

    expect(stripAnsi(output)).toContain(sparkline);
  });
});
