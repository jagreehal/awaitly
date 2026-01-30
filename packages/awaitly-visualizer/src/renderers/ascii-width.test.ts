import { describe, it, expect } from "vitest";
import { asciiRenderer } from "./ascii";
import { defaultColorScheme } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

describe("asciiRenderer width", () => {
  it("handles very small terminal widths without throwing", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        startTs: 0,
        endTs: 1,
        children: [],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const options: RenderOptions = {
      showTimings: false,
      showKeys: false,
      terminalWidth: 1,
      colors: defaultColorScheme,
    };

    expect(() => asciiRenderer().render(ir, options)).not.toThrow();
  });
});
