import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR } from "../types";

describe("renderToHTML layout", () => {
  it("draws horizontal edges for LR layout", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-2",
        workflowId: "wf-2",
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

    const html = renderToHTML(ir, { layout: "LR", showTimings: false });

    const pathMatch = html.match(/<path class="wv-edge" d="M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)"/);
    expect(pathMatch).toBeTruthy();

    const [, , y1, , y2] = pathMatch ?? [];
    const y1Num = Number(y1);
    const y2Num = Number(y2);

    // Horizontal edges should keep y constant (allow small rounding tolerance)
    expect(Math.abs(y1Num - y2Num)).toBeLessThanOrEqual(1);
  });

  it("renders RL layout with edges pointing right-to-left", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-3",
        workflowId: "wf-3",
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

    const html = renderToHTML(ir, { layout: "RL", showTimings: false });

    const pathMatch = html.match(/<path class="wv-edge" d="M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)"/);
    expect(pathMatch).toBeTruthy();

    const [, x1, , x2] = pathMatch ?? [];
    const x1Num = Number(x1);
    const x2Num = Number(x2);

    // Right-to-left edges should move leftwards
    expect(x1Num).toBeGreaterThan(x2Num);
  });
});
