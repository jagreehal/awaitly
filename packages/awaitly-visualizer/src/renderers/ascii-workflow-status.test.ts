import { describe, it, expect } from "vitest";
import { asciiRenderer } from "./ascii";
import { defaultColorScheme, stripAnsi } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

describe("asciiRenderer workflow status", () => {
  it("renders cancelled status for aborted workflows", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "aborted",
        startTs: 0,
        endTs: 10,
        durationMs: 10,
        children: [],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const options: RenderOptions = {
      showTimings: true,
      showKeys: false,
      terminalWidth: 60,
      colors: defaultColorScheme,
    };

    const output = stripAnsi(asciiRenderer().render(ir, options));

    expect(output).toContain("Cancelled");
  });
});
