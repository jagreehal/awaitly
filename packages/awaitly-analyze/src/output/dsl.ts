/**
 * Workflow Diagram DSL renderer.
 *
 * Converts StaticWorkflowIR to WorkflowDiagramDSL (types from awaitly/workflow)
 * for xstate-style visualization. Step state ids use step key when present
 * so they align with WorkflowSnapshot.execution.currentStepId.
 */

import type {
  WorkflowDiagramDSL,
  WorkflowDiagramState,
  WorkflowDiagramStateType,
  WorkflowDiagramTransition,
  WorkflowDiagramSourceLocation,
} from "awaitly/workflow";

import {
  extractFunctionName,
  type StaticWorkflowIR,
  type StaticFlowNode,
  type StaticStepNode,
  type StaticSequenceNode,
  type StaticParallelNode,
  type StaticRaceNode,
  type StaticConditionalNode,
  type StaticDecisionNode,
  type StaticSwitchNode,
  type StaticLoopNode,
  type StaticWorkflowRefNode,
  type StaticStreamNode,
  type StaticSagaStepNode,
  type StaticUnknownNode,
  type SourceLocation,
} from "../types";

// =============================================================================
// Helpers
// =============================================================================

function mapLocation(loc?: SourceLocation): WorkflowDiagramSourceLocation | undefined {
  if (!loc) return undefined;
  return {
    filePath: loc.filePath,
    line: loc.line,
    column: loc.column,
    endLine: loc.endLine,
    endColumn: loc.endColumn,
  };
}

/** Step state id: use key when present for snapshot alignment, else stepId (steps) or id (saga). */
function stepStateId(step: StaticStepNode | StaticSagaStepNode): string {
  if (step.key) return step.key;
  if (step.type === "step") return step.stepId ?? step.id;
  return step.id;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + "...";
}

// =============================================================================
// Build context
// =============================================================================

interface DSLContext {
  states: WorkflowDiagramState[];
  transitions: WorkflowDiagramTransition[];
  nodeCounter: number;
  lastNodeIds: string[];
}

function addState(
  ctx: DSLContext,
  id: string,
  label: string,
  type: WorkflowDiagramStateType,
  extra?: Partial<WorkflowDiagramState>
): void {
  ctx.states.push({
    id,
    label,
    type,
    ...extra,
  });
}

function link(ctx: DSLContext, fromId: string, toId: string, event: string, conditionLabel?: string): void {
  ctx.transitions.push({
    fromStateId: fromId,
    toStateId: toId,
    event,
    ...(conditionLabel ? { conditionLabel } : {}),
  });
}

// =============================================================================
// Node to DSL (returns first and last state ids for this subtree)
// =============================================================================

function processNodes(
  nodes: StaticFlowNode[],
  ctx: DSLContext,
  prevLastIds: string[]
): { firstId: string | null; lastIds: string[] } {
  if (nodes.length === 0) return { firstId: null, lastIds: prevLastIds };

  let firstId: string | null = null;
  let lastIds = prevLastIds;

  for (const node of nodes) {
    const result = processNode(node, ctx);

    if (result.firstId) {
      if (firstId === null) firstId = result.firstId;
      for (const prev of lastIds) {
        link(ctx, prev, result.firstId, "done");
      }
    }
    lastIds = result.lastIds;
  }

  return { firstId, lastIds };
}

function processNode(node: StaticFlowNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  switch (node.type) {
    case "step":
      return processStep(node, ctx);
    case "saga-step":
      return processSagaStep(node, ctx);
    case "stream":
      return processStream(node, ctx);
    case "sequence":
      return processSequence(node, ctx);
    case "parallel":
      return processParallel(node, ctx);
    case "race":
      return processRace(node, ctx);
    case "conditional":
      return processConditional(node, ctx);
    case "decision":
      return processDecision(node, ctx);
    case "switch":
      return processSwitch(node, ctx);
    case "loop":
      return processLoop(node, ctx);
    case "workflow-ref":
      return processWorkflowRef(node, ctx);
    case "unknown":
      return processUnknown(node, ctx);
    default:
      return { firstId: null, lastIds: [] };
  }
}

function processStep(node: StaticStepNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const id = stepStateId(node);
  const label = node.name ?? (node.callee ? extractFunctionName(node.callee) : "step");
  addState(ctx, id, label, "step", {
    outputType: (node as StaticStepNode & { outputType?: string }).outputType,
    inputType: (node as StaticStepNode & { inputType?: string }).inputType,
    location: mapLocation(node.location),
  });
  return { firstId: id, lastIds: [id] };
}

function processSagaStep(node: StaticSagaStepNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const id = stepStateId(node);
  const label = node.name ?? (node.callee ? extractFunctionName(node.callee) : "saga-step");
  addState(ctx, id, label, "step", { location: mapLocation(node.location) });
  return { firstId: id, lastIds: [id] };
}

function processStream(node: StaticStreamNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const id = `stream_${++ctx.nodeCounter}`;
  const label = node.namespace ? `stream:${node.namespace}` : `stream:${node.streamType}`;
  addState(ctx, id, label, "step", { location: mapLocation(node.location) });
  return { firstId: id, lastIds: [id] };
}

function processSequence(node: StaticSequenceNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  return processNodes(node.children, ctx, []);
}

function processParallel(node: StaticParallelNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const forkId = `parallel_fork_${++ctx.nodeCounter}`;
  const joinId = `parallel_join_${++ctx.nodeCounter}`;
  const label = node.name ? `${node.name} (${node.mode})` : `Parallel (${node.mode})`;
  addState(ctx, forkId, label, "decision");
  addState(ctx, joinId, "Join", "join");

  const joinLastIds: string[] = [];
  for (let i = 0; i < node.children.length; i++) {
    const result = processNode(node.children[i]!, ctx);
    if (result.firstId) {
      link(ctx, forkId, result.firstId, `branch:${i}`);
      for (const lastId of result.lastIds) {
        link(ctx, lastId, joinId, "done");
        joinLastIds.push(joinId);
      }
    }
  }
  return { firstId: forkId, lastIds: [joinId] };
}

function processRace(node: StaticRaceNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const forkId = `race_fork_${++ctx.nodeCounter}`;
  const joinId = `race_join_${++ctx.nodeCounter}`;
  addState(ctx, forkId, "Race", "decision");
  addState(ctx, joinId, "Winner", "join");

  for (let i = 0; i < node.children.length; i++) {
    const result = processNode(node.children[i]!, ctx);
    if (result.firstId) {
      link(ctx, forkId, result.firstId, `racer:${i}`);
      for (const lastId of result.lastIds) {
        link(ctx, lastId, joinId, "done");
      }
    }
  }
  return { firstId: forkId, lastIds: [joinId] };
}

function processConditional(node: StaticConditionalNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const decisionId = `decision_${++ctx.nodeCounter}`;
  const condLabel = truncate(node.condition, 40);
  addState(ctx, decisionId, condLabel, "decision", { location: mapLocation(node.location) });

  const lastIds: string[] = [];

  const trueResult = processNodes(node.consequent, ctx, []);
  if (trueResult.firstId) {
    link(ctx, decisionId, trueResult.firstId, node.helper === "unless" || node.helper === "unlessOr" ? "false" : "true");
    lastIds.push(...trueResult.lastIds);
  }

  if (node.alternate && node.alternate.length > 0) {
    const falseResult = processNodes(node.alternate, ctx, []);
    if (falseResult.firstId) {
      link(ctx, decisionId, falseResult.firstId, node.helper === "unless" || node.helper === "unlessOr" ? "true" : "false");
      lastIds.push(...falseResult.lastIds);
    }
  } else {
    lastIds.push(decisionId);
  }

  return { firstId: decisionId, lastIds };
}

function processDecision(node: StaticDecisionNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const decisionId = `decision_${++ctx.nodeCounter}`;
  const label = node.conditionLabel || truncate(node.condition, 40);
  addState(ctx, decisionId, label, "decision", { location: mapLocation(node.location) });

  const lastIds: string[] = [];

  const trueResult = processNodes(node.consequent, ctx, []);
  if (trueResult.firstId) {
    link(ctx, decisionId, trueResult.firstId, "true", node.conditionLabel);
    lastIds.push(...trueResult.lastIds);
  }

  if (node.alternate && node.alternate.length > 0) {
    const falseResult = processNodes(node.alternate, ctx, []);
    if (falseResult.firstId) {
      link(ctx, decisionId, falseResult.firstId, "false", node.conditionLabel);
      lastIds.push(...falseResult.lastIds);
    }
  } else {
    lastIds.push(decisionId);
  }

  return { firstId: decisionId, lastIds };
}

function processSwitch(node: StaticSwitchNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const switchId = `switch_${++ctx.nodeCounter}`;
  const label = truncate(`switch: ${node.expression}`, 40);
  addState(ctx, switchId, label, "decision", { location: mapLocation(node.location) });

  const lastIds: string[] = [];

  for (const caseClause of node.cases) {
    if (caseClause.body.length === 0) continue;
    const caseResult = processNodes(caseClause.body, ctx, []);
    if (caseResult.firstId) {
      const event = caseClause.isDefault ? "default" : (caseClause.value ?? "case");
      link(ctx, switchId, caseResult.firstId, event);
      lastIds.push(...caseResult.lastIds);
    }
  }

  if (lastIds.length === 0) lastIds.push(switchId);
  return { firstId: switchId, lastIds };
}

function processLoop(node: StaticLoopNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const entryId = `loop_entry_${++ctx.nodeCounter}`;
  const label = node.iterSource ? `${node.loopType}: ${truncate(node.iterSource, 20)}` : node.loopType;
  addState(ctx, entryId, label, "decision", { location: mapLocation(node.location) });

  const bodyResult = processNodes(node.body, ctx, []);
  if (!bodyResult.firstId) {
    return { firstId: entryId, lastIds: [entryId] };
  }

  link(ctx, entryId, bodyResult.firstId, "iterate");
  for (const lastId of bodyResult.lastIds) {
    link(ctx, lastId, entryId, "next");
  }

  const exitId = `loop_exit_${++ctx.nodeCounter}`;
  addState(ctx, exitId, "Loop done", "join");
  link(ctx, entryId, exitId, "done");

  return { firstId: entryId, lastIds: [exitId] };
}

function processWorkflowRef(node: StaticWorkflowRefNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const id = `workflow_ref_${++ctx.nodeCounter}`;
  addState(ctx, id, `[[${node.workflowName}]]`, "step", { location: mapLocation(node.location) });
  return { firstId: id, lastIds: [id] };
}

function processUnknown(node: StaticUnknownNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const id = `unknown_${++ctx.nodeCounter}`;
  addState(ctx, id, `Unknown: ${truncate(node.reason, 30)}`, "step");
  return { firstId: id, lastIds: [id] };
}

// =============================================================================
// Public API
// =============================================================================

const INITIAL_ID = "start";
const TERMINAL_ID = "end";

/**
 * Convert static workflow IR to WorkflowDiagramDSL for visualization.
 * Step state ids use step key when present so they align with
 * WorkflowSnapshot.execution.currentStepId.
 */
export function renderWorkflowDSL(ir: StaticWorkflowIR): WorkflowDiagramDSL {
  const ctx: DSLContext = {
    states: [],
    transitions: [],
    nodeCounter: 0,
    lastNodeIds: [],
  };

  addState(ctx, INITIAL_ID, "Start", "initial");
  addState(ctx, TERMINAL_ID, "End", "terminal");

  const result = processNodes(ir.root.children, ctx, []);

  if (result.firstId) {
    link(ctx, INITIAL_ID, result.firstId, "start");
    for (const lastId of result.lastIds) {
      link(ctx, lastId, TERMINAL_ID, "done");
    }
  } else {
    link(ctx, INITIAL_ID, TERMINAL_ID, "done");
  }

  return {
    workflowName: ir.root.workflowName,
    states: ctx.states,
    transitions: ctx.transitions,
    initialStateId: INITIAL_ID,
    terminalStateIds: [TERMINAL_ID],
    workflowReturnType: (ir.root as { workflowReturnType?: string }).workflowReturnType,
  };
}
