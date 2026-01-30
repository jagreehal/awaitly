import { describe, it, expect } from "vitest";
import { flowchartRenderer } from "./flowchart";
import { defaultColorScheme, stripAnsi } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

describe("flowchartRenderer showKeys", () => {
  it("includes step key when showKeys is true even if name is missing", () => {
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

    const options: RenderOptions = {
      showTimings: false,
      showKeys: true,
      terminalWidth: 80,
      colors: defaultColorScheme,
    };

    const output = flowchartRenderer().render(ir, options);

    expect(stripAnsi(output)).toContain("step-key");
  });
});
