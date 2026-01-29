import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR } from "../types";

describe("renderToHTML circular values", () => {
  it("handles circular input without throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

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
            type: "step",
            id: "step-1",
            name: "step",
            state: "success",
            startTs: 0,
            endTs: 1,
            durationMs: 1,
            input: circular,
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    expect(() => renderToHTML(ir, { showTimings: false })).not.toThrow();
  });
});
