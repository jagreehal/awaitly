import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR } from "../types";

describe("renderToHTML decision edges (no branch-to-branch links)", () => {
  it("does not create sequential edges between decision branches", () => {
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
    const edgeCount = html.match(/class="wv-edge"/g)?.length ?? 0;

    // Expect only two edges from the decision container to each branch step.
    expect(edgeCount).toBe(2);
  });
});
