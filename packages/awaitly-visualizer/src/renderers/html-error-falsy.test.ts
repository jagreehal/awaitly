import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR } from "../types";

describe("renderToHTML falsy error values", () => {
  it("includes error when error is 0", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "error",
        startTs: 0,
        endTs: 1,
        children: [
          {
            type: "step",
            id: "step-1",
            name: "step",
            state: "error",
            startTs: 0,
            endTs: 1,
            durationMs: 1,
            error: 0,
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const html = renderToHTML(ir, { showTimings: false });

    expect(html).toContain("\"error\":\"0\"");
  });
});
