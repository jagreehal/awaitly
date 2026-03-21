/**
 * Diff Engine — Core diffWorkflows() function
 *
 * Compares two StaticWorkflowIR snapshots and produces a WorkflowDiff
 * describing step-level and structural changes between them.
 */

import type {
  StaticWorkflowIR,
  StaticFlowNode,
  StaticStepNode,
  StaticSagaStepNode,
} from "../types";
import { getStaticChildren } from "../types";
import type {
  WorkflowDiff,
  DiffOptions,
  StepDiffEntry,
  StructuralChange,
  DiffSummary,
} from "./types";

interface StepWithContext {
  stepId: string;
  callee: string | undefined;
  containerType: string;
  index: number;
}

/**
 * Walk the IR tree and collect every step/saga-step with its immediate
 * container type and flattened position index.
 */
function collectStepsWithContext(
  ir: StaticWorkflowIR
): StepWithContext[] {
  const result: StepWithContext[] = [];
  let index = 0;

  function walk(node: StaticFlowNode, containerType: string): void {
    if (node.type === "step") {
      const step = node as StaticStepNode;
      result.push({
        stepId: step.stepId,
        callee: step.callee,
        containerType,
        index: index++,
      });
      return;
    }

    if (node.type === "saga-step") {
      const saga = node as StaticSagaStepNode;
      result.push({
        // saga-step uses `name` (from StaticBaseNode) as its identifier
        stepId: saga.name ?? saga.id,
        callee: saga.callee,
        containerType,
        index: index++,
      });
      return;
    }

    for (const child of getStaticChildren(node)) {
      walk(child, node.type);
    }
  }

  for (const node of ir.root.children) {
    walk(node, "workflow");
  }

  return result;
}

const CONTAINER_TYPES = [
  "parallel",
  "race",
  "conditional",
  "decision",
  "switch",
  "loop",
  "stream",
  "sequence",
] as const;

function countContainerTypes(ir: StaticWorkflowIR): Map<string, number> {
  const counts = new Map<string, number>();

  function walk(node: StaticFlowNode): void {
    if (
      (CONTAINER_TYPES as readonly string[]).includes(node.type)
    ) {
      counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    }
    for (const child of getStaticChildren(node)) {
      walk(child);
    }
  }

  for (const node of ir.root.children) {
    walk(node);
  }

  return counts;
}

/**
 * Compare two workflow IR snapshots and produce a structured diff.
 *
 * Three-pass approach: exact stepId matches first (unchanged/moved),
 * then rename detection by callee+position, then remainder as added/removed.
 */
export function diffWorkflows(
  before: StaticWorkflowIR,
  after: StaticWorkflowIR,
  options?: DiffOptions
): WorkflowDiff {
  const detectRenames = options?.detectRenames ?? true;
  const regressionMode = options?.regressionMode ?? false;

  const beforeSteps = collectStepsWithContext(before);
  const afterSteps = collectStepsWithContext(after);

  const beforeMap = new Map<string, StepWithContext>();
  for (const s of beforeSteps) {
    beforeMap.set(s.stepId, s);
  }

  const afterMap = new Map<string, StepWithContext>();
  for (const s of afterSteps) {
    afterMap.set(s.stepId, s);
  }

  const steps: StepDiffEntry[] = [];
  const matchedBefore = new Set<string>();
  const matchedAfter = new Set<string>();

  // Pass 1: exact stepId matches — unchanged or moved
  for (const [stepId, beforeCtx] of beforeMap) {
    const afterCtx = afterMap.get(stepId);
    if (!afterCtx) continue;

    matchedBefore.add(stepId);
    matchedAfter.add(stepId);

    if (beforeCtx.containerType !== afterCtx.containerType) {
      steps.push({
        kind: "moved",
        stepId,
        callee: afterCtx.callee,
        containerBefore: beforeCtx.containerType,
        containerAfter: afterCtx.containerType,
      });
    } else {
      steps.push({
        kind: "unchanged",
        stepId,
        callee: afterCtx.callee,
      });
    }
  }

  // Pass 2: rename detection (same callee + same position index)
  if (detectRenames) {
    const unmatchedBefore = beforeSteps.filter(
      (s) => !matchedBefore.has(s.stepId)
    );
    const unmatchedAfter = afterSteps.filter(
      (s) => !matchedAfter.has(s.stepId)
    );

    for (const bStep of unmatchedBefore) {
      if (matchedBefore.has(bStep.stepId)) continue;

      const renameCandidate = unmatchedAfter.find(
        (aStep) =>
          !matchedAfter.has(aStep.stepId) &&
          aStep.callee !== undefined &&
          bStep.callee !== undefined &&
          aStep.callee === bStep.callee &&
          aStep.index === bStep.index
      );

      if (renameCandidate) {
        matchedBefore.add(bStep.stepId);
        matchedAfter.add(renameCandidate.stepId);

        steps.push({
          kind: "renamed",
          stepId: renameCandidate.stepId,
          previousStepId: bStep.stepId,
          callee: renameCandidate.callee,
        });
      }
    }
  }

  // Pass 3: remainder — removed + added
  for (const bStep of beforeSteps) {
    if (!matchedBefore.has(bStep.stepId)) {
      steps.push({
        kind: "removed",
        stepId: bStep.stepId,
        callee: bStep.callee,
      });
    }
  }

  for (const aStep of afterSteps) {
    if (!matchedAfter.has(aStep.stepId)) {
      steps.push({
        kind: "added",
        stepId: aStep.stepId,
        callee: aStep.callee,
      });
    }
  }

  const beforeContainers = countContainerTypes(before);
  const afterContainers = countContainerTypes(after);

  const allContainerTypes = new Set([
    ...beforeContainers.keys(),
    ...afterContainers.keys(),
  ]);

  const structuralChanges: StructuralChange[] = [];

  for (const nodeType of allContainerTypes) {
    const bCount = beforeContainers.get(nodeType) ?? 0;
    const aCount = afterContainers.get(nodeType) ?? 0;

    if (aCount > bCount) {
      const diff = aCount - bCount;
      structuralChanges.push({
        kind: "added",
        nodeType,
        description: `${diff} ${nodeType} block${diff > 1 ? "s" : ""}`,
      });
    } else if (bCount > aCount) {
      const diff = bCount - aCount;
      structuralChanges.push({
        kind: "removed",
        nodeType,
        description: `${diff} ${nodeType} block${diff > 1 ? "s" : ""}`,
      });
    }
  }

  const summary: DiffSummary = {
    stepsAdded: steps.filter((s) => s.kind === "added").length,
    stepsRemoved: steps.filter((s) => s.kind === "removed").length,
    stepsRenamed: steps.filter((s) => s.kind === "renamed").length,
    stepsMoved: steps.filter((s) => s.kind === "moved").length,
    stepsUnchanged: steps.filter((s) => s.kind === "unchanged").length,
    structuralChanges: structuralChanges.length,
    hasRegressions: regressionMode && steps.some((s) => s.kind === "removed"),
  };

  return {
    beforeName: before.root.workflowName,
    afterName: after.root.workflowName,
    diffedAt: Date.now(),
    steps,
    structuralChanges,
    summary,
  };
}
