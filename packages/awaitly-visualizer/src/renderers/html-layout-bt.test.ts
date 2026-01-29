import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR } from "../types";

describe("renderToHTML layout", () => {
  it("renders BT layout with edges pointing bottom-to-top", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-4",
        workflowId: "wf-4",
        state: "success",
        startTs: 0,
        endTs: 1,
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
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const html = renderToHTML(ir, { layout: "BT", showTimings: false });

    const pathMatch = html.match(/<path class="wv-edge" d="M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)"/);
    expect(pathMatch).toBeTruthy();

    const [, , y1, , y2] = pathMatch ?? [];
    const y1Num = Number(y1);
    const y2Num = Number(y2);

    // Bottom-to-top edges should move upwards
    expect(y1Num).toBeGreaterThan(y2Num);
  });
});
