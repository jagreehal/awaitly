import { describe, it, expect } from "vitest";
import { mermaidRenderer } from "./mermaid";
import { defaultColorScheme } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

describe("mermaidRenderer showKeys", () => {
  it("includes step keys in labels when showKeys is enabled", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        children: [
          {
            type: "step",
            id: "step-1",
            name: "Load data",
            key: "load-key",
            state: "success",
            durationMs: 10,
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

    const diagram = mermaidRenderer().render(ir, options);

    // Key should appear in the quoted label when showKeys is true
    expect(diagram).toMatch(/\["[^"]*load-key[^"]*"\]/);
  });
});
