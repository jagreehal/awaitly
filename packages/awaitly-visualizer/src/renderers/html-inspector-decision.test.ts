import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR } from "../types";

describe("renderToHTML inspector decision data", () => {
  it("includes decision condition/value in embedded node data", () => {
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
            name: "check",
            condition: "user.role === 'admin'",
            decisionValue: "admin",
            branchTaken: "if",
            state: "success",
            branches: [
              { label: "if", taken: true, children: [] },
              { label: "else", taken: false, children: [] },
            ],
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const html = renderToHTML(ir, { showTimings: false });

    expect(html).toContain("\"condition\":\"user.role === 'admin'\"");
    expect(html).toContain("\"decisionValue\":\"admin\"");
  });
});
