import { describe, it, expect } from "vitest";
import { flowchartRenderer } from "./flowchart";
import { defaultColorScheme } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

// ESC character for ANSI codes
const ESC = String.fromCharCode(27);

function hasAnsi(text: string): boolean {
  return text.includes(ESC);
}

describe("flowchartRenderer", () => {
  it("uses stream-specific color instead of falling back to step state", () => {
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
            type: "stream",
            id: "stream-1",
            namespace: "orders",
            state: "running",
            streamState: "active",
            startTs: 0,
            writeCount: 1,
            readCount: 0,
            finalPosition: 1,
            backpressureOccurred: true,
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

    // Stream nodes should render with their own color class; at minimum, ensure
    // we're not just using the running step color, which is yellow.
    expect(hasAnsi(output)).toBe(true);
    expect(output).not.toContain(`${ESC}[33m`);
  });
});
