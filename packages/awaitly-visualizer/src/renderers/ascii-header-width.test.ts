import { describe, it, expect } from "vitest";
import { asciiRenderer } from "./ascii";
import { defaultColorScheme, stripAnsi } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

describe("asciiRenderer header width", () => {
  it("keeps the header line at the requested terminal width", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        name: "test",
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
      terminalWidth: 30,
      colors: defaultColorScheme,
    };

    const output = asciiRenderer().render(ir, options);
    const firstLine = output.split("\n")[0];

    expect(stripAnsi(firstLine).length).toBe(30);
  });
});
