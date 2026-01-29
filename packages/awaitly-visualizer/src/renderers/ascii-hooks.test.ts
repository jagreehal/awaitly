import { describe, it, expect } from "vitest";
import { asciiRenderer } from "./ascii";
import { defaultColorScheme } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

const options: RenderOptions = {
  showTimings: false,
  showKeys: false,
  terminalWidth: 80,
  colors: defaultColorScheme,
};

describe("asciiRenderer hooks", () => {
  it("renders onAfterStep hooks even when step has no key", () => {
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
            name: "no-key-step",
            state: "success",
            startTs: 0,
            endTs: 1,
            durationMs: 1,
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
      hooks: {
        onAfterStep: new Map([
          ["step-1", { type: "onAfterStep", state: "success", ts: 1, durationMs: 1, context: { stepKey: "step-1" } }],
        ]),
      },
    };

    const output = asciiRenderer().render(ir, options);

    expect(output).toContain("⚙");
  });
});
