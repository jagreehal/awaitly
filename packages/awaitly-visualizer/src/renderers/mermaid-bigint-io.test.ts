import { describe, it, expect } from "vitest";
import { mermaidRenderer } from "./mermaid";
import { defaultColorScheme } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

describe("mermaidRenderer BigInt I/O", () => {
  it("renders BigInt input/output values", () => {
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
            name: "step",
            state: "success",
            startTs: 0,
            endTs: 1,
            durationMs: 1,
            input: BigInt(42),
            output: BigInt(99),
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

    const output = mermaidRenderer().render(ir, options);

    expect(output).toContain("in: 42");
    expect(output).toContain("out: 99");
  });
});
