import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR } from "../types";

describe("renderToHTML", () => {
  it("renders edges between steps inside decision branches", () => {
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
                    startTs: 0,
                    endTs: 1,
                    durationMs: 1,
                  },
                  {
                    type: "step",
                    id: "step-2",
                    name: "second",
                    state: "success",
                    startTs: 1,
                    endTs: 2,
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
    expect(edgeCount).toBeGreaterThan(0);
  });
});
