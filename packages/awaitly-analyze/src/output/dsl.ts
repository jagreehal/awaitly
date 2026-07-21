/**
 * Workflow Diagram DSL renderer.
 *
 * Converts StaticWorkflowIR to WorkflowDiagramDSL (types from awaitly/workflow)
 * for xstate-style visualization. State ids are the semantic ids authored in
 * the code (step()'s first argument, step.if()'s decision id) so the DSL works
 * directly as the runtime `graph` option; literal cache keys are carried on
 * `state.key` for snapshot alignment (`currentStepId === state.key ?? state.id`).
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

/**
 * Step state id: the semantic step id (the literal first argument to step()).
 * This is the identity runtime graph validation checks and runtime events
 * carry as `name`, so DSL graphs work directly as the `graph` option.
 * Keys are per-instance cache identity (often dynamic) — not graph identity.
 * Falls back to key, then internal id, when the semantic id is unusable.
 */
function stepStateId(step: StaticStepNode | StaticSagaStepNode): string {
  if (step.type === "step" && step.stepId && step.stepId !== "<missing>" && step.stepId !== "<dynamic>") {
    return step.stepId;
  }
  if (step.type === "saga-step" && step.name && step.name !== "<dynamic>") {
    return step.name;
  }
  if (step.key) return step.key;
  if (step.type === "step") return step.stepId ?? step.id;
  return step.id;
}

/** Reserve a unique state id: exact id first, `#2`, `#3`… suffix on collision. */
function uniqueStateId(ctx: DSLContext, id: string): string {
  if (!ctx.usedStateIds.has(id)) {
    ctx.usedStateIds.add(id);
    return id;
  }
  let n = 2;
  while (ctx.usedStateIds.has(`${id}#${n}`)) n++;
  const unique = `${id}#${n}`;
  ctx.usedStateIds.add(unique);
  return unique;
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
  usedStateIds: Set<string>;
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

/** Step kind suffix for DSL label from callee and node metadata. */
function getDSLStepKindSuffix(node: StaticStepNode): string {
  const callee = node.callee;
  if (!callee) return "";
  if (callee === "step.sleep") return node.sleepDuration ? ` (Sleep: ${node.sleepDuration})` : " (Sleep)";
  if (callee === "step.retry") {
    const attempts = node.retry?.attempts;
    return attempts != null && attempts !== "<dynamic>" ? ` (Retry: ${attempts})` : " (Retry)";
  }
  if (callee === "step.withTimeout") {
    const ms = node.timeout?.ms;
    return ms != null && ms !== "<dynamic>" ? ` (Timeout: ${ms}ms)` : " (Timeout)";
  }
  if (callee === "step.try") return " (Try)";
  if (callee === "step.fromResult") return " (FromResult)";
  if (callee === "step.run") return " (Run)";
  if (callee === "step.andThen") return " (AndThen)";
  if (callee === "step.match") return " (Match)";
  if (callee === "step.map") return " (Map)";
  if (callee === "step.withFallback") return " (Fallback)";
  if (callee === "step.withResource") return " (Resource)";
  if (callee === "step.workflow") return " (Workflow)";
  return "";
}

function processStep(node: StaticStepNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const authoredId = stepStateId(node);
  const id = uniqueStateId(ctx, authoredId);
  let label = node.name ?? (node.callee ? extractFunctionName(node.callee) : "step");

  const kindSuffix = getDSLStepKindSuffix(node);
  if (kindSuffix) {
    label += kindSuffix;
  } else {
    if (node.retry) {
      const attempts = node.retry.attempts;
      label += attempts != null && attempts !== "<dynamic>" ? ` (Retry: ${attempts})` : " (Retry)";
    }
    if (node.timeout) {
      const ms = node.timeout.ms;
      label += ms != null && ms !== "<dynamic>" ? ` (Timeout: ${ms}ms)` : " (Timeout)";
    }
  }

  const sourceLabel = node.depSource ?? node.stepKind;
  if (sourceLabel) {
    label += ` (dep: ${sourceLabel})`;
  }

  addState(ctx, id, label, "step", {
    ...(id !== authoredId ? { semanticId: authoredId } : {}),
    // Literal cache key for snapshot alignment
    // (currentStepId === key ?? semanticId ?? id).
    ...(node.key && node.key !== "<dynamic>" ? { key: node.key } : {}),
    outputType: (node as StaticStepNode & { outputType?: string }).outputType,
    inputType: (node as StaticStepNode & { inputType?: string }).inputType,
    location: mapLocation(node.location),
  });
  return { firstId: id, lastIds: [id] };
}

function processSagaStep(node: StaticSagaStepNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const authoredId = stepStateId(node);
  const id = uniqueStateId(ctx, authoredId);
  const label = node.name ?? (node.callee ? extractFunctionName(node.callee) : "saga-step");
  addState(ctx, id, label, "step", {
    ...(id !== authoredId ? { semanticId: authoredId } : {}),
    ...(node.key && node.key !== "<dynamic>" && node.key !== id ? { key: node.key } : {}),
    location: mapLocation(node.location),
  });
  return { firstId: id, lastIds: [id] };
}

function processStream(node: StaticStreamNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const id = uniqueStateId(ctx, `stream_${++ctx.nodeCounter}`);
  const label = node.namespace ? `stream:${node.namespace}` : `stream:${node.streamType}`;
  addState(ctx, id, label, "step", { location: mapLocation(node.location) });
  return { firstId: id, lastIds: [id] };
}

function processSequence(node: StaticSequenceNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  return processNodes(node.children, ctx, []);
}

function processParallel(node: StaticParallelNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const forkId = uniqueStateId(ctx, `parallel_fork_${++ctx.nodeCounter}`);
  const joinId = uniqueStateId(ctx, `parallel_join_${++ctx.nodeCounter}`);
  const modeLabel = node.mode === "allSettled" ? "AllSettled" : node.mode;
  const label = node.name ? `${node.name} (${modeLabel})` : `Parallel (${modeLabel})`;
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
  const forkId = uniqueStateId(ctx, `race_fork_${++ctx.nodeCounter}`);
  const joinId = uniqueStateId(ctx, `race_join_${++ctx.nodeCounter}`);
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
  const decisionId = uniqueStateId(ctx, `decision_${++ctx.nodeCounter}`);
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
  // Explicit step.if decisions keep their authored id — it's the identity the
  // runtime emits decision events under and graph validation checks.
  const decisionId =
    node.decisionId && node.decisionId !== "<dynamic>"
      ? uniqueStateId(ctx, node.decisionId)
      : uniqueStateId(ctx, `decision_${++ctx.nodeCounter}`);
  const label = node.conditionLabel || truncate(node.condition, 40);
  addState(ctx, decisionId, label, "decision", {
    ...(node.decisionId !== "<dynamic>" && decisionId !== node.decisionId
      ? { semanticId: node.decisionId }
      : {}),
    location: mapLocation(node.location),
  });

  // Use semantic edge labels from conditionLabel when available
  const hasSemanticLabel =
    node.conditionLabel && node.conditionLabel !== "<dynamic>";
  const trueEvent = hasSemanticLabel ? node.conditionLabel : "true";
  const falseEvent = hasSemanticLabel
    ? `Not ${node.conditionLabel}`
    : "false";

  const lastIds: string[] = [];

  const trueResult = processNodes(node.consequent, ctx, []);
  if (trueResult.firstId) {
    link(ctx, decisionId, trueResult.firstId, trueEvent, node.conditionLabel);
    lastIds.push(...trueResult.lastIds);
  }

  if (node.alternate && node.alternate.length > 0) {
    const falseResult = processNodes(node.alternate, ctx, []);
    if (falseResult.firstId) {
      link(ctx, decisionId, falseResult.firstId, falseEvent, node.conditionLabel);
      lastIds.push(...falseResult.lastIds);
    }
  } else {
    lastIds.push(decisionId);
  }

  return { firstId: decisionId, lastIds };
}

function processSwitch(node: StaticSwitchNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const switchId = uniqueStateId(ctx, `switch_${++ctx.nodeCounter}`);
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
  const entryId = uniqueStateId(ctx, `loop_entry_${++ctx.nodeCounter}`);
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

  const exitId = uniqueStateId(ctx, `loop_exit_${++ctx.nodeCounter}`);
  addState(ctx, exitId, "Loop done", "join");
  link(ctx, entryId, exitId, "done");

  return { firstId: entryId, lastIds: [exitId] };
}

function processWorkflowRef(node: StaticWorkflowRefNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const id = uniqueStateId(ctx, `workflow_ref_${++ctx.nodeCounter}`);
  addState(ctx, id, `[[${node.workflowName}]]`, "step", { location: mapLocation(node.location) });
  return { firstId: id, lastIds: [id] };
}

function processUnknown(node: StaticUnknownNode, ctx: DSLContext): { firstId: string | null; lastIds: string[] } {
  const id = uniqueStateId(ctx, `unknown_${++ctx.nodeCounter}`);
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
 * Step and decision state ids are the semantic ids authored in the code
 * (step()'s first argument, step.if()'s decision id), so the DSL works
 * directly as the runtime `graph` option and matches runtime event `name`s.
 * Un-keyed steps also align with WorkflowSnapshot.execution.currentStepId.
 */
export function renderWorkflowDSL(ir: StaticWorkflowIR): WorkflowDiagramDSL {
  const ctx: DSLContext = {
    states: [],
    transitions: [],
    nodeCounter: 0,
    lastNodeIds: [],
    // Reserve the fixed initial/terminal ids so a step authored as
    // "start"/"end" gets a suffixed state id instead of colliding.
    usedStateIds: new Set([INITIAL_ID, TERMINAL_ID]),
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
