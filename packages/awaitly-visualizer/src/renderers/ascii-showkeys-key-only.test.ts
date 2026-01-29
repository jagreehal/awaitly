import { describe, it, expect } from "vitest";
import { asciiRenderer } from "./ascii";
import { defaultColorScheme } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

describe("asciiRenderer showKeys with key-only steps", () => {
  it("does not duplicate key when name is missing", () => {
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
            key: "fetch-user",
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

    const output = asciiRenderer().render(ir, options);

    expect(output).not.toContain("[key: fetch-user]");
  });
});
