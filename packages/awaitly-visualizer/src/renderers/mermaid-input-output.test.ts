import { describe, it, expect } from "vitest";
import { mermaidRenderer } from "./mermaid";
import { defaultColorScheme } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

describe("mermaidRenderer I/O", () => {
  it("handles non-serializable input/output without throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

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
            input: circular,
            output: circular,
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
      showKeys: false,
      terminalWidth: 80,
      colors: defaultColorScheme,
    };

    expect(() => mermaidRenderer().render(ir, options)).not.toThrow();
  });
});
