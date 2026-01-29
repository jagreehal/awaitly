import { describe, it, expect } from "vitest";
import { countSteps } from "./types";
import type { WorkflowIR } from "../types";

describe("countSteps decision node children", () => {
  it("does not double-count decision children when branches are present", () => {
    const stepNode = {
      type: "step",
      id: "step-1",
      name: "taken",
      state: "success",
    } as const;

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
            // Some IRs include decision.children for the taken branch.
            children: [stepNode],
            branches: [
              {
                label: "if",
                taken: true,
                children: [stepNode],
              },
              {
                label: "else",
                taken: false,
                children: [],
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
