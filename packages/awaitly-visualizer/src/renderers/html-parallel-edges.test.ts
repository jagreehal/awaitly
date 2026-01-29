import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR } from "../types";

describe("renderToHTML parallel edges", () => {
  it("does not connect parallel branches sequentially", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-parallel",
        workflowId: "wf-parallel",
        state: "success",
        startTs: 0,
        endTs: 1,
        children: [
          {
            type: "parallel",
            id: "parallel-1",
            state: "success",
            startTs: 0,
            endTs: 1,
            durationMs: 1,
            mode: "all",
            children: [
              {
                type: "step",
                id: "step-1",
                name: "branch-a",
                state: "success",
                startTs: 0,
                endTs: 1,
                durationMs: 1,
              },
              {
                type: "step",
                id: "step-2",
                name: "branch-b",
                state: "success",
                startTs: 0,
                endTs: 1,
                durationMs: 1,
              },
            ],
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const html = renderToHTML(ir, { showTimings: false });

    // Count only SVG edge paths (not CSS class names)
    const edgePaths = html.match(/<path class="wv-edge"/g);
    const edgeCount = edgePaths?.length ?? 0;
    expect(edgeCount).toBe(0);
  });
});
