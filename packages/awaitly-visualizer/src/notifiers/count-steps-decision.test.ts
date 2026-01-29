import { describe, it, expect } from "vitest";
import { countSteps } from "./types";
import type { WorkflowIR } from "../types";

describe("countSteps decision branches", () => {
  it("counts only steps in taken decision branches", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
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
                    name: "taken",
                    state: "success",
                  },
                ],
              },
              {
                label: "else",
                taken: false,
                children: [
                  {
                    type: "step",
                    id: "step-2",
                    name: "skipped",
                    state: "skipped",
                  },
                ],
              },
            ],
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    expect(countSteps(ir)).toBe(1);
  });
});
