import { describe, it, expect } from "vitest";
import { flowchartRenderer } from "./flowchart";
import { defaultColorScheme, stripAnsi } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

describe("flowchartRenderer decision branch selection", () => {
  it("renders branch children even if the taken branch is empty", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        children: [
          {
            type: "decision",
            id: "decision-1",
            state: "success",
            branches: [
              { label: "if", taken: true, children: [] },
              {
                label: "else",
                taken: false,
                children: [
                  {
                    type: "step",
                    id: "step-1",
                    name: "else-branch-step",
                    state: "success",
                    durationMs: 1,
                  },
                ],
              },
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

    expect(stripAnsi(output)).toContain("else-branch-step");
  });
});
