import { describe, it, expect } from "vitest";
import { detectParallelGroups } from "./parallel-detector";
import type { DecisionNode, StepNode } from "./types";

describe("detectParallelGroups", () => {
  it("does not group steps when a decision node is present", () => {
    const stepA: StepNode = {
      type: "step",
      id: "step-a",
      state: "success",
      startTs: 0,
      endTs: 10,
      durationMs: 10,
    };

    const decision: DecisionNode = {
      type: "decision",
      id: "decision-1",
      state: "success",
      branches: [
        { label: "if", taken: true, children: [] },
        { label: "else", taken: false, children: [] },
      ],
      startTs: 5,
      endTs: 6,
      durationMs: 1,
    };

    const stepB: StepNode = {
      type: "step",
      id: "step-b",
      state: "success",
      startTs: 1,
      endTs: 9,
      durationMs: 8,
    };

    const nodes = [stepA, decision, stepB];
    const result = detectParallelGroups(nodes);

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("step");
    expect(result[1].type).toBe("decision");
    expect(result[2].type).toBe("step");
    expect(result.some((node) => node.type === "parallel")).toBe(false);
  });
});
