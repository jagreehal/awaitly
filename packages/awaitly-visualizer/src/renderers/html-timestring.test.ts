import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR } from "../types";

describe("renderToHTML time formatting", () => {
  it("mirrors utils formatDuration behavior for 0ms", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        startTs: 0,
        endTs: 0,
        durationMs: 0,
        children: [
          {
            type: "step",
            id: "step-1",
            name: "step",
            state: "success",
            startTs: 0,
            endTs: 0,
            durationMs: 0,
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const html = renderToHTML(ir, { showTimings: true });

    expect(html).toContain("0ms");
    expect(html).not.toContain("<1ms");
  });
});
