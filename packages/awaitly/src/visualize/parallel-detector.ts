/**
 * Parallel Detection - Heuristic detection of parallel execution from timing.
 *
 * When steps overlap in time (one starts before another ends), they are
 * likely running in parallel. This module detects such patterns and
 * groups overlapping steps into ParallelNode structures.
 */

import type { FlowNode, ParallelNode, StepNode } from "./types";

/**
 * Options for parallel detection.
 */
export interface ParallelDetectorOptions {
  /**
   * Minimum overlap in milliseconds to consider steps parallel.
   * Default: 0 (any overlap counts)
   */
  minOverlapMs?: number;

  /**
   * Maximum gap in milliseconds to still consider steps as part of same parallel group.
   * Default: 5 (steps starting within 5ms are grouped)
   */
  maxGapMs?: number;
}

/**
 * Step timing information for overlap detection.
 */
interface StepTiming {
  node: StepNode;
  startTs: number;
  endTs: number;
}

/**
 * Check if nodes contain real scope nodes (from scope_start/scope_end events).
 * When real scope nodes exist, heuristic detection should be skipped to avoid
 * duplicating or conflicting with the explicit structure.
 */
function hasRealScopeNodes(nodes: FlowNode[]): boolean {
  for (const node of nodes) {
    // Real scope nodes are parallel/race/sequence that came from scope events
    // (not from heuristic detection, which uses ids starting with "detected_")
    if (
      (node.type === "parallel" || node.type === "race" || node.type === "sequence") &&
      !node.id.startsWith("detected_")
    ) {
      return true;
    }
    // Also check for decision nodes if present
    if ("decisionId" in node) {
      return true;
    }
  }
  return false;
}

/**
 * Group overlapping steps into parallel nodes.
 *
 * Algorithm:
 * 1. Sort steps by start time
 * 2. For each step, check if it overlaps with existing parallel groups
 * 3. If it overlaps, add to group; otherwise start new sequence
 * 4. Merge overlapping groups when step bridges them
 *
 * Note: If real scope nodes (from scope_start/scope_end) are present,
 * heuristic detection is skipped to avoid conflicts.
 */
export function detectParallelGroups(
  nodes: FlowNode[],
  options: ParallelDetectorOptions = {}
): FlowNode[] {
  // If real scope nodes exist, skip heuristic detection
  // The explicit scope events provide accurate structure
  if (hasRealScopeNodes(nodes)) {
    return nodes;
  }

  const { minOverlapMs = 0, maxGapMs = 5 } = options;

  // Extract step nodes with timing info, preserving indices for position restoration
  const stepsWithTiming: (StepTiming & { originalIndex: number })[] = [];
  const nonStepNodes: { node: FlowNode; originalIndex: number }[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === "step" && node.startTs !== undefined) {
      stepsWithTiming.push({
        node,
        startTs: node.startTs,
        endTs: node.endTs ?? node.startTs + (node.durationMs ?? 0),
        originalIndex: i,
      });
    } else {
      // Keep non-step nodes with their original position
      nonStepNodes.push({ node, originalIndex: i });
    }
  }

  if (stepsWithTiming.length <= 1) {
    return nodes; // Nothing to group
  }

  // Sort by start time
  stepsWithTiming.sort((a, b) => a.startTs - b.startTs);

  // Group overlapping steps
  type StepTimingWithIndex = StepTiming & { originalIndex: number };
  const groups: StepTimingWithIndex[][] = [];
  let currentGroup: StepTimingWithIndex[] = [stepsWithTiming[0]];

  for (let i = 1; i < stepsWithTiming.length; i++) {
    const step = stepsWithTiming[i];
    const groupStart = Math.min(...currentGroup.map((s) => s.startTs));
    const groupEnd = Math.max(...currentGroup.map((s) => s.endTs));

    // Two ways steps can be parallel:
    // 1. They started together (within maxGapMs) - handles timing jitter
    // 2. They genuinely overlap (step starts before group ends)
    const startedTogether = step.startTs <= groupStart + maxGapMs;
    const hasTrueOverlap = step.startTs < groupEnd;

    if (!startedTogether && !hasTrueOverlap) {
      // Sequential: step started after group ended AND not with the group
      groups.push(currentGroup);
      currentGroup = [step];
      continue;
    }

    // Check minOverlapMs threshold for overlap duration
    // For steps that started together, overlap is measured from step start to group end
    // For steps with true overlap, it's from step start to min(step end, group end)
    const overlapDuration = hasTrueOverlap
      ? Math.min(step.endTs, groupEnd) - step.startTs
      : 0;

    // Started together bypasses minOverlapMs (they're parallel by definition)
    // True overlap must meet the minOverlapMs threshold
    if (startedTogether || overlapDuration >= minOverlapMs) {
      currentGroup.push(step);
    } else {
      // Overlap too small - treat as sequential
      groups.push(currentGroup);
      currentGroup = [step];
    }
  }
  groups.push(currentGroup);

  // Convert groups to nodes with position tracking
  const groupedNodes: { node: FlowNode; position: number }[] = [];

  for (const group of groups) {
    // Use the minimum original index as the position for the group
    const position = Math.min(...group.map((s) => s.originalIndex));

    if (group.length === 1) {
      // Single step - no parallel grouping needed
      groupedNodes.push({ node: group[0].node, position });
    } else {
      // Multiple overlapping steps - create parallel node
      const children = group.map((s) => s.node);
      const startTs = Math.min(...group.map((s) => s.startTs));
      const endTs = Math.max(...group.map((s) => s.endTs));

      const parallelNode: ParallelNode = {
        type: "parallel",
        id: `detected_parallel_${startTs}`,
        name: `${children.length} parallel steps`,
        state: deriveGroupState(children),
        mode: "all",
        children,
        startTs,
        endTs,
        durationMs: endTs - startTs,
      };

      groupedNodes.push({ node: parallelNode, position });
    }
  }

  // Add non-step nodes with their original positions
  for (const { node, originalIndex } of nonStepNodes) {
    groupedNodes.push({ node, position: originalIndex });
  }

  // Sort by original position to preserve ordering
  groupedNodes.sort((a, b) => a.position - b.position);

  return groupedNodes.map((g) => g.node);
}

/**
 * Derive the state of a group from its children.
 */
function deriveGroupState(
  children: FlowNode[]
): "pending" | "running" | "success" | "error" | "aborted" | "cached" {
  const hasError = children.some((c) => c.state === "error");
  if (hasError) return "error";

  const hasRunning = children.some((c) => c.state === "running");
  if (hasRunning) return "running";

  const hasPending = children.some((c) => c.state === "pending");
  if (hasPending) return "pending";

  const allSuccess = children.every(
    (c) => c.state === "success" || c.state === "cached"
  );
  if (allSuccess) return "success";

  return "success";
}

/**
 * Create a parallel detector that processes nodes.
 */
export function createParallelDetector(options: ParallelDetectorOptions = {}) {
  return {
    /**
     * Process nodes and group overlapping ones into parallel nodes.
     */
    detect: (nodes: FlowNode[]) => detectParallelGroups(nodes, options),
  };
}
