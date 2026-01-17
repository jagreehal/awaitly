import { describe, it, expect } from "vitest";
import {
  detectParallelGroups,
  createParallelDetector,
} from "./parallel-detector";
import type { StepNode, FlowNode, ParallelNode } from "./types";

// =============================================================================
// Test Helpers
// =============================================================================

function createStepNode(
  id: string,
  startTs: number,
  endTs: number,
  name?: string
): StepNode {
  return {
    type: "step",
    id,
    name: name ?? id,
    state: "success",
    startTs,
    endTs,
    durationMs: endTs - startTs,
  };
}

function isParallelNode(node: FlowNode): node is ParallelNode {
  return node.type === "parallel";
}

// =============================================================================
// Core Detection Logic Tests
// =============================================================================

describe("detectParallelGroups", () => {
  describe("strictly sequential steps", () => {
    it("does NOT group steps that execute one after another", () => {
      // Step A: 0-100ms, Step B: 100-200ms (B starts exactly when A ends)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 100),
        createStepNode("b", 100, 200),
      ];

      const result = detectParallelGroups(nodes);

      // Should remain as two separate step nodes, not grouped
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("step");
      expect(result[1].type).toBe("step");
    });

    it("does NOT group steps with a gap between them", () => {
      // Step A: 0-100ms, Step B: 150-250ms (50ms gap)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 100),
        createStepNode("b", 150, 250),
      ];

      const result = detectParallelGroups(nodes);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("step");
      expect(result[1].type).toBe("step");
    });

    it("does NOT group fast sequential steps outside maxGapMs", () => {
      // Step A: 0-10ms, Step B: 20-30ms (10ms gap, > default maxGapMs of 5)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 10),
        createStepNode("b", 20, 30),
      ];

      const result = detectParallelGroups(nodes);

      expect(result).toHaveLength(2);
      expect(result.every((n) => n.type === "step")).toBe(true);
    });
  });

  describe("truly overlapping steps", () => {
    it("groups steps with clear overlap", () => {
      // Step A: 0-100ms, Step B: 50-150ms (50ms overlap)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 100),
        createStepNode("b", 50, 150),
      ];

      const result = detectParallelGroups(nodes);

      expect(result).toHaveLength(1);
      expect(isParallelNode(result[0])).toBe(true);
      if (isParallelNode(result[0])) {
        expect(result[0].children).toHaveLength(2);
      }
    });

    it("groups multiple overlapping steps", () => {
      // A: 0-100, B: 30-80, C: 60-120 (all overlap)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 100),
        createStepNode("b", 30, 80),
        createStepNode("c", 60, 120),
      ];

      const result = detectParallelGroups(nodes);

      expect(result).toHaveLength(1);
      expect(isParallelNode(result[0])).toBe(true);
      if (isParallelNode(result[0])) {
        expect(result[0].children).toHaveLength(3);
      }
    });

    it("groups steps where one is contained within another", () => {
      // A: 0-200ms, B: 50-100ms (B fully inside A)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 200),
        createStepNode("b", 50, 100),
      ];

      const result = detectParallelGroups(nodes);

      expect(result).toHaveLength(1);
      expect(isParallelNode(result[0])).toBe(true);
    });
  });

  describe("steps starting together (maxGapMs)", () => {
    it("groups steps that start within default maxGapMs (5ms)", () => {
      // A: 0-100ms, B: 3-100ms (started 3ms apart, within 5ms tolerance)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 100),
        createStepNode("b", 3, 100),
      ];

      const result = detectParallelGroups(nodes);

      expect(result).toHaveLength(1);
      expect(isParallelNode(result[0])).toBe(true);
    });

    it("groups steps that start exactly at maxGapMs boundary", () => {
      // A: 0-100ms, B: 5-100ms (started exactly 5ms apart)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 100),
        createStepNode("b", 5, 100),
      ];

      const result = detectParallelGroups(nodes);

      expect(result).toHaveLength(1);
      expect(isParallelNode(result[0])).toBe(true);
    });

    it("does NOT group steps starting beyond maxGapMs when no overlap", () => {
      // A: 0-10ms, B: 15-25ms (started 15ms apart, no overlap)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 10),
        createStepNode("b", 15, 25),
      ];

      const result = detectParallelGroups(nodes);

      expect(result).toHaveLength(2);
      expect(result.every((n) => n.type === "step")).toBe(true);
    });

    it("respects custom maxGapMs option", () => {
      // A: 0-10ms, B: 8-20ms (started 8ms apart)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 10),
        createStepNode("b", 8, 20),
      ];

      // With default maxGapMs=5, they wouldn't be grouped by "started together"
      // but they DO have true overlap (B starts at 8, A ends at 10)
      const resultDefault = detectParallelGroups(nodes);
      expect(resultDefault).toHaveLength(1); // grouped due to overlap

      // With maxGapMs=10, they should be grouped by "started together"
      const resultCustom = detectParallelGroups(nodes, { maxGapMs: 10 });
      expect(resultCustom).toHaveLength(1);
    });

    it("maxGapMs=0 disables started-together grouping", () => {
      // A: 0-100ms, B: 3-100ms (started 3ms apart)
      // With maxGapMs=0, only true overlap counts
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 100),
        createStepNode("b", 3, 100),
      ];

      const result = detectParallelGroups(nodes, { maxGapMs: 0 });

      // Still grouped because there IS true overlap (B starts at 3, A ends at 100)
      expect(result).toHaveLength(1);
    });
  });

  describe("minOverlapMs threshold", () => {
    it("groups steps meeting minOverlapMs threshold", () => {
      // A: 0-100ms, B: 90-150ms (10ms overlap)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 100),
        createStepNode("b", 90, 150),
      ];

      const result = detectParallelGroups(nodes, { minOverlapMs: 10 });

      expect(result).toHaveLength(1);
      expect(isParallelNode(result[0])).toBe(true);
    });

    it("does NOT group steps below minOverlapMs threshold", () => {
      // A: 0-100ms, B: 95-150ms (5ms overlap, below 10ms threshold)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 100),
        createStepNode("b", 95, 150),
      ];

      const result = detectParallelGroups(nodes, { minOverlapMs: 10 });

      expect(result).toHaveLength(2);
      expect(result.every((n) => n.type === "step")).toBe(true);
    });

    it("started-together bypasses minOverlapMs", () => {
      // A: 0-10ms, B: 3-15ms (started together, but only 7ms overlap)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 10),
        createStepNode("b", 3, 15),
      ];

      // minOverlapMs=10 would reject 7ms overlap, but started-together wins
      const result = detectParallelGroups(nodes, { minOverlapMs: 10 });

      expect(result).toHaveLength(1);
      expect(isParallelNode(result[0])).toBe(true);
    });
  });

  describe("mixed sequential and parallel", () => {
    it("correctly separates parallel group followed by sequential step", () => {
      // A: 0-100ms, B: 50-100ms (parallel), C: 150-200ms (sequential)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 100),
        createStepNode("b", 50, 100),
        createStepNode("c", 150, 200),
      ];

      const result = detectParallelGroups(nodes);

      expect(result).toHaveLength(2);
      expect(isParallelNode(result[0])).toBe(true);
      expect(result[1].type).toBe("step");
      expect(result[1].id).toBe("c");
    });

    it("correctly separates sequential step followed by parallel group", () => {
      // A: 0-50ms (sequential), B: 100-200ms, C: 150-250ms (parallel)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 50),
        createStepNode("b", 100, 200),
        createStepNode("c", 150, 250),
      ];

      const result = detectParallelGroups(nodes);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("step");
      expect(result[0].id).toBe("a");
      expect(isParallelNode(result[1])).toBe(true);
    });

    it("handles alternating sequential and parallel", () => {
      // A: 0-50 (seq), B: 100-200, C: 150-250 (parallel), D: 300-350 (seq)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 50),
        createStepNode("b", 100, 200),
        createStepNode("c", 150, 250),
        createStepNode("d", 300, 350),
      ];

      const result = detectParallelGroups(nodes);

      expect(result).toHaveLength(3);
      expect(result[0].type).toBe("step");
      expect(isParallelNode(result[1])).toBe(true);
      expect(result[2].type).toBe("step");
    });
  });

  describe("edge cases", () => {
    it("returns empty array for empty input", () => {
      const result = detectParallelGroups([]);
      expect(result).toHaveLength(0);
    });

    it("returns single step unchanged", () => {
      const nodes: FlowNode[] = [createStepNode("a", 0, 100)];
      const result = detectParallelGroups(nodes);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("step");
    });

    it("handles steps with zero duration", () => {
      // Instant steps at different times
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 0),
        createStepNode("b", 10, 10),
      ];

      const result = detectParallelGroups(nodes);

      expect(result).toHaveLength(2);
    });

    it("handles steps with same start and end times", () => {
      // Two instant steps at the same time
      const nodes: FlowNode[] = [
        createStepNode("a", 100, 100),
        createStepNode("b", 100, 100),
      ];

      const result = detectParallelGroups(nodes);

      // Should be grouped (started together)
      expect(result).toHaveLength(1);
      expect(isParallelNode(result[0])).toBe(true);
    });

    it("preserves non-step nodes in output", () => {
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 100),
        {
          type: "parallel",
          id: "existing-parallel",
          name: "Existing",
          state: "success",
          mode: "all",
          children: [],
        } as ParallelNode,
        createStepNode("b", 50, 150),
      ];

      // When real scope nodes exist, heuristic detection is skipped
      const result = detectParallelGroups(nodes);

      // Should return unchanged (real scope node detected)
      expect(result).toHaveLength(3);
    });

    it("skips nodes without startTs", () => {
      const nodeWithoutTiming: StepNode = {
        type: "step",
        id: "no-timing",
        name: "No Timing",
        state: "pending",
        // No startTs
      };

      const nodes: FlowNode[] = [
        createStepNode("a", 0, 100),
        nodeWithoutTiming,
        createStepNode("b", 50, 150),
      ];

      const result = detectParallelGroups(nodes);

      // a and b should be grouped, nodeWithoutTiming preserved
      expect(result).toHaveLength(2);
    });
  });

  describe("timing precision scenarios", () => {
    it("handles 1ms overlap correctly", () => {
      // A: 0-100ms, B: 99-150ms (1ms overlap)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 100),
        createStepNode("b", 99, 150),
      ];

      const result = detectParallelGroups(nodes);

      // Should be grouped (true overlap exists)
      expect(result).toHaveLength(1);
      expect(isParallelNode(result[0])).toBe(true);
    });

    it("does NOT group with 0ms overlap (boundary case)", () => {
      // A: 0-100ms, B: 100-150ms (starts exactly when A ends)
      const nodes: FlowNode[] = [
        createStepNode("a", 0, 100),
        createStepNode("b", 100, 150),
      ];

      const result = detectParallelGroups(nodes);

      // No overlap - sequential
      expect(result).toHaveLength(2);
    });
  });
});

// =============================================================================
// createParallelDetector Factory Tests
// =============================================================================

describe("createParallelDetector", () => {
  it("creates detector with default options", () => {
    const detector = createParallelDetector();

    const nodes: FlowNode[] = [
      createStepNode("a", 0, 100),
      createStepNode("b", 50, 150),
    ];

    const result = detector.detect(nodes);

    expect(result).toHaveLength(1);
    expect(isParallelNode(result[0])).toBe(true);
  });

  it("creates detector with custom options", () => {
    const detector = createParallelDetector({ minOverlapMs: 100 });

    // 50ms overlap, below 100ms threshold
    const nodes: FlowNode[] = [
      createStepNode("a", 0, 100),
      createStepNode("b", 50, 150),
    ];

    const result = detector.detect(nodes);

    // Not grouped due to minOverlapMs threshold
    expect(result).toHaveLength(2);
  });

  it("detector is reusable", () => {
    const detector = createParallelDetector();

    const result1 = detector.detect([
      createStepNode("a", 0, 100),
      createStepNode("b", 50, 150),
    ]);

    const result2 = detector.detect([
      createStepNode("c", 0, 50),
      createStepNode("d", 100, 150),
    ]);

    expect(result1).toHaveLength(1); // grouped
    expect(result2).toHaveLength(2); // not grouped
  });
});
