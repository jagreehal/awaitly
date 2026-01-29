import { describe, it, expect } from "vitest";
import { loggerRenderer } from "./logger";
import { defaultColorScheme } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

const options: RenderOptions = {
  showTimings: false,
  showKeys: false,
  terminalWidth: 80,
  colors: defaultColorScheme,
};

describe("loggerRenderer decision branches", () => {
  it("includes only steps from taken decision branches", () => {
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
              {
                label: "if",
                taken: true,
                children: [
                  { type: "step", id: "step-1", name: "taken", state: "success" },
                ],
              },
              {
                label: "else",
                taken: false,
                children: [
                  { type: "step", id: "step-2", name: "skipped", state: "skipped" },
                ],
              },
            ],
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const output = loggerRenderer().render(ir, options);
    const parsed = JSON.parse(output) as { steps: Array<{ id: string }>; summary: { totalSteps: number } };

    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0].id).toBe("step-1");
    expect(parsed.summary.totalSteps).toBe(1);
  });
});
