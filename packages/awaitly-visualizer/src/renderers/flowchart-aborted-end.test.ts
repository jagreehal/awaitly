import { describe, it, expect } from "vitest";
import { flowchartRenderer } from "./flowchart";
import { defaultColorScheme, stripAnsi } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

describe("flowchartRenderer aborted workflows", () => {
  it("renders an end node for aborted workflows", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "aborted",
        startTs: 0,
        endTs: 1,
        durationMs: 1,
        children: [],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const options: RenderOptions = {
      showTimings: false,
      showKeys: false,
      terminalWidth: 80,
      colors: defaultColorScheme,
    };

    const output = stripAnsi(flowchartRenderer().render(ir, options));

    // Aborted workflows should still render a terminal node label.
    expect(output).toContain("Cancelled");
  });
});
