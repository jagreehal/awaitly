import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR } from "../types";

describe("renderToHTML decision edges", () => {
  it("does not connect parallel decision branches together", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-decision",
        workflowId: "wf-decision",
        state: "success",
        startTs: 0,
        endTs: 1,
        children: [
          {
            type: "decision",
            id: "decision-1",
            state: "success",
            branches: [
              {
                label: "if",
                taken: true,
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
                ],
              },
              {
                label: "else",
                taken: false,
                children: [
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
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const html = renderToHTML(ir, { showTimings: false });

    const edgeCount = html.split("wv-edge").length - 1;

    // Expect at least two edges (decision -> each branch), not a single edge
    // that incorrectly connects the branches together.
    expect(edgeCount).toBeGreaterThanOrEqual(2);
  });
});
