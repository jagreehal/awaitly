import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR } from "../types";

describe("renderToHTML decision edges (branch sequence)", () => {
  it("does not connect decision directly to later steps in a branch", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-decision",
        workflowId: "wf-decision",
        state: "success",
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
                    name: "first",
                    state: "success",
                  },
                  {
                    type: "step",
                    id: "step-2",
                    name: "second",
                    state: "success",
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

    // Expected edges: decision -> step-1, step-1 -> step-2
    expect(edgeCount).toBe(2);
  });
});
