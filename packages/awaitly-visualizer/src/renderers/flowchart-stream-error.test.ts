import { describe, it, expect } from "vitest";
import { flowchartRenderer } from "./flowchart";
import { defaultColorScheme } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

describe("flowchartRenderer stream errors", () => {
  it("shows error state for streams that ended with errors", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        children: [
          {
            type: "stream",
            id: "stream-1",
            namespace: "topic",
            state: "error",
            streamState: "error",
            startTs: 0,
            endTs: 1,
            durationMs: 1,
            writeCount: 1,
            readCount: 0,
            finalPosition: 10,
            backpressureOccurred: false,
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

    // Should render ✗ for error streams rather than defaulting to a success icon
    expect(output).toContain("✗");
  });
});
