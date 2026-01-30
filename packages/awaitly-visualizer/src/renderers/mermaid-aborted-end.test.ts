import { describe, it, expect } from "vitest";
import { mermaidRenderer } from "./mermaid";
import { defaultColorScheme } from "./colors";
import type { RenderOptions, WorkflowIR } from "../types";

describe("mermaidRenderer aborted workflows", () => {
  it("renders an end node for aborted workflows", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "aborted",
        startTs: 0,
        endTs: 1,
        durationMs: 1,
        children: [],
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

    // Aborted workflows should still have a terminal node.
    expect(diagram).toContain("finish");
  });
});
