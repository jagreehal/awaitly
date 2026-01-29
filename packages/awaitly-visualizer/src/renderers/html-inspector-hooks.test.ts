import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR } from "../types";

describe("renderToHTML inspector hook timing", () => {
  it("includes hook duration for step nodes", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        startTs: 0,
        endTs: 2,
        children: [
          {
            type: "step",
            id: "step-1",
            key: "step-1",
            name: "step",
            state: "success",
            startTs: 0,
            endTs: 2,
            durationMs: 2,
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
      hooks: {
        onAfterStep: new Map([
          [
            "step-1",
            {
              type: "onAfterStep",
              state: "success",
              ts: 2,
              durationMs: 5,
              context: { stepKey: "step-1" },
            },
          ],
        ]),
      },
    };

    const html = renderToHTML(ir, { showTimings: false });

    expect(html).toContain("\"onAfterStep\":{\"step-1\"");
    expect(html).toContain("\"durationMs\":5");
  });
});
