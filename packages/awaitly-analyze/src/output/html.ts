/**
 * Interactive HTML Generator
 *
 * Thin wrapper: extractNodeMetadata stays here (uses StaticWorkflowIR types).
 * Template generation imported from awaitly-visualizer.
 *
 * Pipeline:
 *   StaticWorkflowIR → renderStaticMermaid() → generateInteractiveHTML() → .html file
 */

import type {
  StaticWorkflowIR,
  StaticFlowNode,
  StaticStepNode,
  StaticSagaStepNode,
  StaticStreamNode,
  StaticConditionalNode,
  StaticDecisionNode,
  StaticSwitchNode,
  StaticLoopNode,
  StaticWorkflowRefNode,
} from "../types";

export type {
  NodeMetadata,
  WorkflowMetadata,
  InteractiveHTMLOptions,
} from "awaitly-visualizer";

export { generateInteractiveHTML } from "awaitly-visualizer";

import type { WorkflowMetadata } from "awaitly-visualizer";
import type { NodeMetadata } from "awaitly-visualizer";

// =============================================================================
// Metadata Extraction
// =============================================================================

/**
 * Extract node metadata from StaticWorkflowIR.
 *
 * Walks the IR tree in the same order as renderStaticMermaid() and generates
 * matching Mermaid node IDs so the click handler can look up metadata.
 */
export function extractNodeMetadata(ir: StaticWorkflowIR): WorkflowMetadata {
  const nodes: Record<string, NodeMetadata> = {};
  const counter = { value: 0 };

  // Walk the IR in the same order as renderStaticMermaid
  walkNodes(ir.root.children, nodes, counter);

  return {
    workflowName: ir.root.workflowName,
    description: ir.root.description ?? ir.root.jsdocDescription,
    filePath: ir.metadata.filePath,
    stats: {
      totalSteps: ir.metadata.stats.totalSteps,
      conditionalCount: ir.metadata.stats.conditionalCount,
      parallelCount: ir.metadata.stats.parallelCount,
      raceCount: ir.metadata.stats.raceCount,
      loopCount: ir.metadata.stats.loopCount,
    },
    nodes,
  };
}

function walkNodes(
  nodes: StaticFlowNode[],
  result: Record<string, NodeMetadata>,
  counter: { value: number },
): void {
  for (const node of nodes) {
    walkNode(node, result, counter);
  }
}

function walkNode(
  node: StaticFlowNode,
  result: Record<string, NodeMetadata>,
  counter: { value: number },
): void {
  switch (node.type) {
    case "step":
      walkStepNode(node, result, counter);
      break;
    case "saga-step":
      walkSagaStepNode(node, result, counter);
      break;
    case "stream":
      walkStreamNode(node, result, counter);
      break;
    case "sequence":
      walkNodes(node.children, result, counter);
      break;
    case "parallel":
      walkParallelNode(node, result, counter);
      break;
    case "race":
      walkRaceNode(node, result, counter);
      break;
    case "conditional":
      walkConditionalNode(node, result, counter);
      break;
    case "decision":
      walkDecisionNode(node, result, counter);
      break;
    case "switch":
      walkSwitchNode(node, result, counter);
      break;
    case "loop":
      walkLoopNode(node, result, counter);
      break;
    case "workflow-ref":
      walkWorkflowRefNode(node, result, counter);
      break;
    case "unknown":
      walkUnknownNode(node, result, counter);
      break;
  }
}

function walkStepNode(
  node: StaticStepNode,
  result: Record<string, NodeMetadata>,
  counter: { value: number },
): void {
  const mermaidId = `step_${++counter.value}`;
  result[mermaidId] = {
    mermaidId,
    type: "step",
    name: node.name ?? node.callee ?? "step",
    stepId: node.stepId,
    callee: node.callee,
    description: node.description ?? node.jsdocDescription,
    location: node.location,
    retry: node.retry,
    timeout: node.timeout,
    errors: node.errors,
    inputType: node.inputType,
    outputType: node.outputType,
    out: node.out,
    reads: node.reads,
  };
}

function walkSagaStepNode(
  node: StaticSagaStepNode,
  result: Record<string, NodeMetadata>,
  counter: { value: number },
): void {
  const mermaidId = `saga_step_${++counter.value}`;
  result[mermaidId] = {
    mermaidId,
    type: "saga-step",
    name: node.name ?? node.callee ?? "saga-step",
    callee: node.callee,
    description: node.description ?? node.jsdocDescription,
    location: node.location,
    hasCompensation: node.hasCompensation,
    compensationCallee: node.compensationCallee,
  };
}

function walkStreamNode(
  node: StaticStreamNode,
  result: Record<string, NodeMetadata>,
  counter: { value: number },
): void {
  const mermaidId = `stream_${++counter.value}`;
  result[mermaidId] = {
    mermaidId,
    type: "stream",
    name: node.namespace ? `stream:${node.namespace}` : `stream:${node.streamType}`,
    streamType: node.streamType,
    namespace: node.namespace,
    location: node.location,
  };
}

function walkParallelNode(
  node: StaticFlowNode & { type: "parallel" },
  result: Record<string, NodeMetadata>,
  counter: { value: number },
): void {
  const forkId = `parallel_fork_${++counter.value}`;
  const joinId = `parallel_join_${++counter.value}`;

  result[forkId] = {
    mermaidId: forkId,
    type: "parallel-fork",
    name: node.name ?? `Parallel (${node.mode})`,
    mode: node.mode,
    childCount: node.children.length,
    location: node.location,
  };

  // Walk children (same order as renderStaticMermaid)
  for (const child of node.children) {
    walkNode(child, result, counter);
  }

  result[joinId] = {
    mermaidId: joinId,
    type: "parallel-join",
    name: "Join",
  };
}

function walkRaceNode(
  node: StaticFlowNode & { type: "race" },
  result: Record<string, NodeMetadata>,
  counter: { value: number },
): void {
  const forkId = `race_fork_${++counter.value}`;
  const joinId = `race_join_${++counter.value}`;

  result[forkId] = {
    mermaidId: forkId,
    type: "race-fork",
    name: node.name ?? "Race",
    childCount: node.children.length,
    location: node.location,
  };

  for (const child of node.children) {
    walkNode(child, result, counter);
  }

  result[joinId] = {
    mermaidId: joinId,
    type: "race-join",
    name: "Winner",
  };
}

function walkConditionalNode(
  node: StaticConditionalNode,
  result: Record<string, NodeMetadata>,
  counter: { value: number },
): void {
  const mermaidId = `decision_${++counter.value}`;
  result[mermaidId] = {
    mermaidId,
    type: "conditional",
    name: node.condition,
    condition: node.condition,
    helper: node.helper ?? undefined,
    location: node.location,
  };

  // Walk consequent
  walkNodes(node.consequent, result, counter);

  // Walk alternate
  if (node.alternate && node.alternate.length > 0) {
    walkNodes(node.alternate, result, counter);
  }
}

function walkDecisionNode(
  node: StaticDecisionNode,
  result: Record<string, NodeMetadata>,
  counter: { value: number },
): void {
  const mermaidId = `decision_${++counter.value}`;
  result[mermaidId] = {
    mermaidId,
    type: "decision",
    name: node.conditionLabel || node.condition,
    condition: node.condition,
    location: node.location,
  };

  walkNodes(node.consequent, result, counter);

  if (node.alternate && node.alternate.length > 0) {
    walkNodes(node.alternate, result, counter);
  }
}

function walkSwitchNode(
  node: StaticSwitchNode,
  result: Record<string, NodeMetadata>,
  counter: { value: number },
): void {
  const mermaidId = `switch_${++counter.value}`;
  result[mermaidId] = {
    mermaidId,
    type: "switch",
    name: `switch: ${node.expression}`,
    expression: node.expression,
    cases: node.cases.map((c) => ({ value: c.value, isDefault: c.isDefault })),
    location: node.location,
  };

  for (const caseClause of node.cases) {
    if (caseClause.body.length > 0) {
      walkNodes(caseClause.body, result, counter);
    }
  }
}

function walkLoopNode(
  node: StaticLoopNode,
  result: Record<string, NodeMetadata>,
  counter: { value: number },
): void {
  const loopStartId = `loop_start_${++counter.value}`;
  const loopEndId = `loop_end_${++counter.value}`;

  result[loopStartId] = {
    mermaidId: loopStartId,
    type: "loop-start",
    name: node.iterSource ? `${node.loopType}: ${node.iterSource}` : node.loopType,
    loopType: node.loopType,
    iterSource: node.iterSource,
    boundCount: node.boundCount,
    location: node.location,
  };

  walkNodes(node.body, result, counter);

  result[loopEndId] = {
    mermaidId: loopEndId,
    type: "loop-end",
    name: "Continue?",
  };
}

function walkWorkflowRefNode(
  node: StaticWorkflowRefNode,
  result: Record<string, NodeMetadata>,
  counter: { value: number },
): void {
  const mermaidId = `workflow_ref_${++counter.value}`;
  result[mermaidId] = {
    mermaidId,
    type: "workflow-ref",
    name: node.workflowName,
    workflowName: node.workflowName,
    resolved: node.resolved,
    location: node.location,
  };
}

function walkUnknownNode(
  node: StaticFlowNode & { type: "unknown" },
  result: Record<string, NodeMetadata>,
  counter: { value: number },
): void {
  const mermaidId = `unknown_${++counter.value}`;
  result[mermaidId] = {
    mermaidId,
    type: "unknown",
    name: `Unknown: ${node.reason}`,
    location: node.location,
  };
}
