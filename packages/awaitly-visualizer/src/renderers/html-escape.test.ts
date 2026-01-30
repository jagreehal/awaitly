import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR } from "../types";

describe("renderToHTML escaping", () => {
  it("escapes special characters in data-node-id attributes", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf&1",
        workflowId: "wf&1",
        state: "success",
        startTs: 0,
        endTs: 1,
        children: [
          {
            type: "step",
            id: "step&1",
            name: "step",
            state: "success",
            startTs: 0,
            endTs: 1,
            durationMs: 1,
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const html = renderToHTML(ir, { showTimings: false });

    expect(html).toContain('data-node-id="step&amp;1"');
  });
});
