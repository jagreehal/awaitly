import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR } from "../types";

describe("renderToHTML hooks map", () => {
  it("serializes hooks.onAfterStep entries into embedded JSON", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        startTs: 0,
        endTs: 1,
        children: [],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
      hooks: {
        onAfterStep: new Map([
          [
            "step-a",
            {
              type: "onAfterStep",
              state: "success",
              ts: 1,
              durationMs: 2,
              context: { stepKey: "step-a" },
            },
          ],
        ]),
      },
    };

    const html = renderToHTML(ir, { showTimings: false });

    expect(html).toContain("\"onAfterStep\":{\"step-a\"");
  });

  it("accepts JSON-shaped hooks (plain object onAfterStep) without throwing", () => {
    const ir = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        startTs: 0,
        endTs: 1,
        children: [],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
      hooks: {
        onAfterStep: {
          "step-1": {
            type: "onAfterStep",
            state: "success",
            ts: 1,
            durationMs: 1,
            context: { stepKey: "step-1" },
          },
        },
      },
    } as WorkflowIR;

    expect(() => renderToHTML(ir, { showTimings: false })).not.toThrow();
  });
});
