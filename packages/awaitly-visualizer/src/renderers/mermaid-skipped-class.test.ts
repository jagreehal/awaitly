import { describe, it, expect } from "vitest";
import { mermaidRenderer } from "./mermaid";
import { defaultColorScheme } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

describe("mermaidRenderer skipped class", () => {
  it("does not apply the skipped class twice", () => {
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
            name: "Skipped step",
            state: "skipped",
            durationMs: 0,
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

    const diagram = mermaidRenderer().render(ir, options);

    expect(diagram).not.toContain(":::skipped:::skipped");
  });
});
