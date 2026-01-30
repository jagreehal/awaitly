import { describe, it, expect } from "vitest";
import { flowchartRenderer } from "./flowchart";
import { defaultColorScheme, stripAnsi } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

describe("flowchartRenderer", () => {
  it("renders decision branch children even when no branch is marked taken", () => {
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
            type: "decision",
            id: "decision-1",
            state: "success",
            branches: [
              {
                label: "if",
                taken: false,
                children: [
                  {
                    type: "step",
                    id: "step-1",
                    name: "branch-step",
                    state: "success",
                    startTs: 0,
                    endTs: 1,
                    durationMs: 1,
                  },
                ],
              },
              { label: "else", taken: false, children: [] },
            ],
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const options: RenderOptions = {
      showTimings: false,
      showKeys: false,
      terminalWidth: 80,
      colors: defaultColorScheme,
    };

    const output = flowchartRenderer().render(ir, options);

    // Strip ANSI codes since renderer applies per-character coloring
    expect(stripAnsi(output)).toContain("branch-step");
  });
});
