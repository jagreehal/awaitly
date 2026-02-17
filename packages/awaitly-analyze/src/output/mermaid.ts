/**
 * Mermaid Diagram Generator
 *
 * Generates Mermaid flowchart diagrams from static workflow analysis.
 * Shows all possible paths, not just executed ones.
 */

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
} from "../types";

// =============================================================================
// Options
// =============================================================================

export interface MermaidOptions {
  /** Diagram direction: TD/TB (top-down), LR (left-right), etc. */
  direction?: "TD" | "TB" | "LR" | "BT" | "RL";
  /** Show step keys in labels */
  showKeys?: boolean;
  /** Show condition labels on edges */
  showConditions?: boolean;
  /** Use subgraphs for parallel/race blocks */
  useSubgraphs?: boolean;
  /** Show inline error exit nodes on main flow for steps with declared errors */
  showInlineErrors?: boolean;
  /** Expand retry steps into separate retry logic nodes */
  expandRetry?: boolean;
  /** Custom node styles */
  styles?: MermaidStyles;
}

export interface MermaidStyles {
  step?: string;
  sagaStep?: string;
  stream?: string;
  parallel?: string;
  race?: string;
  conditional?: string;
  switch?: string;
  loop?: string;
  workflowRef?: string;
  start?: string;
  end?: string;
  errorExit?: string;
  retryLogic?: string;
}

const DEFAULT_OPTIONS: Required<MermaidOptions> = {
  direction: "TD",
  showKeys: false,
  showConditions: true,
  useSubgraphs: true,
  showInlineErrors: false,
  expandRetry: false,
  styles: {
    step: "fill:#e1f5fe,stroke:#01579b",
    sagaStep: "fill:#e8eaf6,stroke:#1a237e",
    stream: "fill:#e0f7fa,stroke:#006064",
    parallel: "fill:#e8f5e9,stroke:#1b5e20",
    race: "fill:#fff3e0,stroke:#e65100",
    conditional: "fill:#fce4ec,stroke:#880e4f",
    switch: "fill:#f3e5f5,stroke:#4a148c",
    loop: "fill:#f3e5f5,stroke:#4a148c",
    workflowRef: "fill:#e0f2f1,stroke:#004d40",
    start: "fill:#c8e6c9,stroke:#2e7d32",
    end: "fill:#ffcdd2,stroke:#c62828",
    errorExit: "fill:#ffcdd2,stroke:#c62828,stroke-width:2px",
    retryLogic: "fill:#fff3e0,stroke:#e65100",
  },
};

// =============================================================================
// Main Generator
// =============================================================================

/**
 * Internal: render the static Mermaid flowchart and return structured result
 * for reuse by renderEnhancedMermaid.
 */
function renderStaticMermaidInternal(
  ir: StaticWorkflowIR,
  opts: Required<MermaidOptions>,
  stepLabelAnnotations?: Map<string, string[]>
): { lines: string[]; context: RenderContext } {
  const context: RenderContext = {
    opts,
    nodeCounter: 0,
    edges: [],
    subgraphs: [],
    styleClasses: new Map(),
    stepIdMap: new Map(),
    stepLabelAnnotations,
  };

  const lines: string[] = [];

  // Flowchart header
  lines.push(`flowchart ${opts.direction}`);
  lines.push("");

  // Add workflow title as comment
  lines.push(`  %% Workflow: ${ir.root.workflowName}`);
  lines.push("");

  // Add start node
  const startId = "start";
  lines.push(`  ${startId}((Start))`);

  // Process workflow body
  const { firstNodeId, lastNodeIds } = renderNodes(
    ir.root.children,
    context,
    lines
  );

  // Connect start to first node
  if (firstNodeId) {
    context.edges.push({ from: startId, to: firstNodeId });
  }

  // Add end node and connect last nodes to it
  const endId = "end_node";
  lines.push(`  ${endId}((End))`);

  for (const lastId of lastNodeIds) {
    context.edges.push({ from: lastId, to: endId });
  }

  // Add subgraphs
  for (const subgraph of context.subgraphs) {
    lines.push("");
    lines.push(`  subgraph ${subgraph.id}[${subgraph.label}]`);
    for (const line of subgraph.content) {
      lines.push(`    ${line}`);
    }
    lines.push("  end");
  }

  // Add edges
  lines.push("");
  lines.push("  %% Edges");
  for (const edge of context.edges) {
    if (edge.label && opts.showConditions) {
      lines.push(`  ${edge.from} -->|${escapeLabel(edge.label)}| ${edge.to}`);
    } else {
      lines.push(`  ${edge.from} --> ${edge.to}`);
    }
  }

  // Add styles
  lines.push("");
  lines.push("  %% Styles");
  lines.push(`  classDef stepStyle ${opts.styles.step}`);
  lines.push(`  classDef sagaStepStyle ${opts.styles.sagaStep}`);
  lines.push(`  classDef streamStyle ${opts.styles.stream}`);
  lines.push(`  classDef parallelStyle ${opts.styles.parallel}`);
  lines.push(`  classDef raceStyle ${opts.styles.race}`);
  lines.push(`  classDef conditionalStyle ${opts.styles.conditional}`);
  lines.push(`  classDef switchStyle ${opts.styles.switch}`);
  lines.push(`  classDef loopStyle ${opts.styles.loop}`);
  lines.push(`  classDef workflowRefStyle ${opts.styles.workflowRef}`);
  lines.push(`  classDef startStyle ${opts.styles.start}`);
  lines.push(`  classDef endStyle ${opts.styles.end}`);
  if (opts.showInlineErrors) {
    lines.push(`  classDef errorExitStyle ${opts.styles.errorExit}`);
  }
  if (opts.expandRetry) {
    lines.push(`  classDef retryLogicStyle ${opts.styles.retryLogic}`);
  }

  // Apply styles
  lines.push(`  class ${startId} startStyle`);
  lines.push(`  class ${endId} endStyle`);

  for (const [nodeId, styleClass] of context.styleClasses) {
    lines.push(`  class ${nodeId} ${styleClass}`);
  }

  return { lines, context };
}

/**
 * Generate a Mermaid flowchart from static workflow IR.
 */
export function renderStaticMermaid(
  ir: StaticWorkflowIR,
  options: MermaidOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { lines } = renderStaticMermaidInternal(ir, opts);
  return lines.join("\n");
}

// =============================================================================
// Internal Types
// =============================================================================

interface RenderContext {
  opts: Required<MermaidOptions>;
  nodeCounter: number;
  edges: Edge[];
  subgraphs: Subgraph[];
  styleClasses: Map<string, string>;
  /** Map from IR stepId to mermaid node ID (for overlay features) */
  stepIdMap: Map<string, string>;
  /** Optional label annotations appended to step labels (stepId -> annotation lines) */
  stepLabelAnnotations?: Map<string, string[]>;
}

interface Edge {
  from: string;
  to: string;
  label?: string;
}

interface Subgraph {
  id: string;
  label: string;
  content: string[];
}

interface RenderResult {
  firstNodeId: string | null;
  lastNodeIds: string[];
}

// =============================================================================
// Node Rendering
// =============================================================================

function renderNodes(
  nodes: StaticFlowNode[],
  context: RenderContext,
  lines: string[]
): RenderResult {
  if (nodes.length === 0) {
    return { firstNodeId: null, lastNodeIds: [] };
  }

  let firstNodeId: string | null = null;
  let prevLastNodeIds: string[] = [];

  for (const node of nodes) {
    const result = renderNode(node, context, lines);

    // Track first node
    if (firstNodeId === null && result.firstNodeId) {
      firstNodeId = result.firstNodeId;
    }

    // Connect previous nodes to current first node
    if (result.firstNodeId) {
      for (const prevId of prevLastNodeIds) {
        context.edges.push({ from: prevId, to: result.firstNodeId });
      }
    }

    prevLastNodeIds = result.lastNodeIds;
  }

  return {
    firstNodeId,
    lastNodeIds: prevLastNodeIds,
  };
}

function renderNode(
  node: StaticFlowNode,
  context: RenderContext,
  lines: string[]
): RenderResult {
  switch (node.type) {
    case "step":
      return renderStepNode(node, context, lines);

    case "saga-step":
      return renderSagaStepNode(node, context, lines);

    case "stream":
      return renderStreamNode(node, context, lines);

    case "sequence":
      return renderSequenceNode(node, context, lines);

    case "parallel":
      return renderParallelNode(node, context, lines);

    case "race":
      return renderRaceNode(node, context, lines);

    case "conditional":
      return renderConditionalNode(node, context, lines);

    case "decision":
      return renderDecisionNode(node, context, lines);

    case "switch":
      return renderSwitchNode(node, context, lines);

    case "loop":
      return renderLoopNode(node, context, lines);

    case "workflow-ref":
      return renderWorkflowRefNode(node, context, lines);

    case "unknown":
      return renderUnknownNode(node, context, lines);

    default:
      return { firstNodeId: null, lastNodeIds: [] };
  }
}

/**
 * Step kind suffix for Mermaid label from callee and node metadata.
 * Returns empty string if callee is not a known step.* helper.
 */
function getStepKindSuffix(node: StaticStepNode): string {
  const callee = node.callee;
  if (!callee) return "";
  if (callee === "step.sleep") {
    return node.sleepDuration ? ` (Sleep: ${node.sleepDuration})` : " (Sleep)";
  }
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
  return "";
}

function renderStepNode(
  node: StaticStepNode,
  context: RenderContext,
  lines: string[]
): RenderResult {
  const nodeId = `step_${++context.nodeCounter}`;
  let label = node.name ?? (node.callee ? extractFunctionName(node.callee) : "step");

  // Determine if retry should be expanded into a separate node
  const isRetryStep =
    node.callee === "step.retry" ||
    (!node.callee?.startsWith("step.") && node.retry);
  const shouldExpandRetry = context.opts.expandRetry && isRetryStep && node.retry;

  const kindSuffix = getStepKindSuffix(node);
  if (shouldExpandRetry) {
    // When expanding retry, don't add retry suffix to the step label
    // Strip retry suffix from kind suffix if present
    if (kindSuffix && !kindSuffix.includes("Retry")) {
      label += kindSuffix;
    }
  } else if (kindSuffix) {
    label += kindSuffix;
  } else {
    // When callee is a regular step() with retry/timeout options
    if (node.retry) {
      const attempts = node.retry.attempts;
      label += attempts != null && attempts !== "<dynamic>" ? ` (Retry: ${attempts})` : " (Retry)";
    }
    if (node.timeout) {
      const ms = node.timeout.ms;
      label += ms != null && ms !== "<dynamic>" ? ` (Timeout: ${ms}ms)` : " (Timeout)";
    }
  }

  if (context.opts.showKeys && node.key) {
    label = `${label}\\n[${node.key}]`;
  }

  if (node.depSource) {
    label += `\\n(dep: ${node.depSource})`;
  }

  // Apply label annotations from enhanced renderer (data flow, errors)
  if (context.stepLabelAnnotations && node.stepId) {
    const annotations = context.stepLabelAnnotations.get(node.stepId);
    if (annotations) {
      for (const annotation of annotations) {
        label += `\\n${annotation}`;
      }
    }
  }

  lines.push(`  ${nodeId}["${escapeLabel(label)}"]`);
  context.styleClasses.set(nodeId, "stepStyle");

  // Track step ID -> mermaid node ID for overlay features
  if (node.stepId) {
    context.stepIdMap.set(node.stepId, nodeId);
  }

  // Track the last node IDs that continue the normal flow
  let lastNodeIds: string[] = [nodeId];

  // Expand retry into a separate retry logic node
  if (shouldExpandRetry) {
    const retryId = `retry_${context.nodeCounter}`;
    const attempts = node.retry!.attempts;
    const retryLabel =
      attempts != null && attempts !== "<dynamic>"
        ? `Retry Logic (${attempts} attempts)`
        : "Retry Logic";
    lines.push(`  ${retryId}{"${escapeLabel(retryLabel)}"}`);
    context.styleClasses.set(retryId, "retryLogicStyle");

    // Step connects to retry node
    context.edges.push({ from: nodeId, to: retryId });

    // Retry node has two outcomes
    const retrySuccessId = `retry_ok_${context.nodeCounter}`;
    lines.push(`  ${retrySuccessId}["Success"]`);
    context.styleClasses.set(retrySuccessId, "stepStyle");
    context.edges.push({ from: retryId, to: retrySuccessId, label: "Success" });

    // "Retries Exhausted" terminal node
    const retryFailId = `retry_fail_${context.nodeCounter}`;
    lines.push(`  ${retryFailId}["Retries Exhausted"]`);
    context.styleClasses.set(retryFailId, "errorExitStyle");
    context.edges.push({
      from: retryId,
      to: retryFailId,
      label: "Retries Exhausted",
    });

    lastNodeIds = [retrySuccessId];
  }

  // Inline error exit nodes for steps with declared errors
  if (context.opts.showInlineErrors && node.errors && node.errors.length > 0) {
    for (const errorName of node.errors) {
      const errNodeId = `err_${nodeId}_${sanitizeId(errorName)}`;
      lines.push(`  ${errNodeId}["${escapeLabel(errorName)}"]`);
      context.styleClasses.set(errNodeId, "errorExitStyle");
      context.edges.push({
        from: nodeId,
        to: errNodeId,
        label: errorName,
      });
    }
  }

  return {
    firstNodeId: nodeId,
    lastNodeIds,
  };
}

function renderSagaStepNode(
  node: StaticSagaStepNode,
  context: RenderContext,
  lines: string[]
): RenderResult {
  const nodeId = `saga_step_${++context.nodeCounter}`;
  let label = node.name ?? (node.callee ? extractFunctionName(node.callee) : "saga-step");

  if (context.opts.showKeys && node.key) {
    label = `${label}\\n[${node.key}]`;
  }

  if (node.hasCompensation) {
    label += "\\n(compensable)";
  }
  if (node.isTryStep) {
    label += "\\n(try)";
  }

  lines.push(`  ${nodeId}["${escapeLabel(label)}"]`);
  context.styleClasses.set(nodeId, "sagaStepStyle");

  return {
    firstNodeId: nodeId,
    lastNodeIds: [nodeId],
  };
}

function renderStreamNode(
  node: StaticStreamNode,
  context: RenderContext,
  lines: string[]
): RenderResult {
  const nodeId = `stream_${++context.nodeCounter}`;
  const label = node.namespace ? `stream:${node.namespace}` : `stream:${node.streamType}`;

  lines.push(`  ${nodeId}[/"${escapeLabel(label)}"/]`);
  context.styleClasses.set(nodeId, "streamStyle");

  return {
    firstNodeId: nodeId,
    lastNodeIds: [nodeId],
  };
}

function renderSequenceNode(
  node: StaticSequenceNode,
  context: RenderContext,
  lines: string[]
): RenderResult {
  return renderNodes(node.children, context, lines);
}

function renderParallelNode(
  node: StaticParallelNode,
  context: RenderContext,
  lines: string[]
): RenderResult {
  const forkId = `parallel_fork_${++context.nodeCounter}`;
  const joinId = `parallel_join_${++context.nodeCounter}`;

  // Fork node (diamond shape for parallel) - include name if present
  const modeLabel = node.mode === "allSettled" ? "AllSettled" : node.mode;
  const parallelLabel = node.name
    ? `${escapeLabel(node.name)} (${modeLabel})`
    : `Parallel (${modeLabel})`;
  lines.push(`  ${forkId}{{"${parallelLabel}"}}`);
  context.styleClasses.set(forkId, "parallelStyle");

  // Join node
  lines.push(`  ${joinId}{{"Join"}}`);
  context.styleClasses.set(joinId, "parallelStyle");

  // Render each branch
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const branchResult = renderNode(child, context, lines);

    // Connect fork to branch start
    if (branchResult.firstNodeId) {
      context.edges.push({
        from: forkId,
        to: branchResult.firstNodeId,
        label: `branch ${i + 1}`,
      });
    }

    // Connect branch end to join
    for (const lastId of branchResult.lastNodeIds) {
      context.edges.push({ from: lastId, to: joinId });
    }
  }

  return {
    firstNodeId: forkId,
    lastNodeIds: [joinId],
  };
}

function renderRaceNode(
  node: StaticRaceNode,
  context: RenderContext,
  lines: string[]
): RenderResult {
  const forkId = `race_fork_${++context.nodeCounter}`;
  const joinId = `race_join_${++context.nodeCounter}`;

  // Fork node (hexagon for race) - include name if present
  const raceLabel = node.name ? escapeLabel(node.name) : "Race";
  lines.push(`  ${forkId}{{{"${raceLabel}"}}}`);
  context.styleClasses.set(forkId, "raceStyle");

  // Join node
  lines.push(`  ${joinId}{{{"Winner"}}}`);
  context.styleClasses.set(joinId, "raceStyle");

  // Render each competing branch
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const branchResult = renderNode(child, context, lines);

    // Connect fork to branch start
    if (branchResult.firstNodeId) {
      context.edges.push({
        from: forkId,
        to: branchResult.firstNodeId,
        label: `racer ${i + 1}`,
      });
    }

    // Connect branch end to join (dashed - only winner proceeds)
    for (const lastId of branchResult.lastNodeIds) {
      context.edges.push({ from: lastId, to: joinId });
    }
  }

  return {
    firstNodeId: forkId,
    lastNodeIds: [joinId],
  };
}

function renderConditionalNode(
  node: StaticConditionalNode,
  context: RenderContext,
  lines: string[]
): RenderResult {
  const decisionId = `decision_${++context.nodeCounter}`;

  // Decision diamond
  const conditionLabel = truncate(node.condition, 30);
  lines.push(`  ${decisionId}{"${escapeLabel(conditionLabel)}"}`);
  context.styleClasses.set(decisionId, "conditionalStyle");

  const lastNodeIds: string[] = [];

  // True/consequent branch
  const trueResult = renderNodes(node.consequent, context, lines);
  if (trueResult.firstNodeId) {
    const trueLabel =
      node.helper === "unless" || node.helper === "unlessOr" ? "false" : "true";
    context.edges.push({
      from: decisionId,
      to: trueResult.firstNodeId,
      label: trueLabel,
    });
    lastNodeIds.push(...trueResult.lastNodeIds);
  }

  // False/alternate branch
  if (node.alternate && node.alternate.length > 0) {
    const falseResult = renderNodes(node.alternate, context, lines);
    if (falseResult.firstNodeId) {
      const falseLabel =
        node.helper === "unless" || node.helper === "unlessOr"
          ? "true"
          : "false";
      context.edges.push({
        from: decisionId,
        to: falseResult.firstNodeId,
        label: falseLabel,
      });
      lastNodeIds.push(...falseResult.lastNodeIds);
    }
  } else {
    // No alternate - decision can skip directly
    lastNodeIds.push(decisionId);
  }

  return {
    firstNodeId: decisionId,
    lastNodeIds,
  };
}

function renderDecisionNode(
  node: StaticDecisionNode,
  context: RenderContext,
  lines: string[]
): RenderResult {
  const nodeId = `decision_${++context.nodeCounter}`;

  // Decision diamond - use conditionLabel for better readability
  const label = node.conditionLabel || truncate(node.condition, 30);
  lines.push(`  ${nodeId}{"${escapeLabel(label)}"}`);
  context.styleClasses.set(nodeId, "conditionalStyle");

  const lastNodeIds: string[] = [];

  // Determine semantic edge labels from conditionLabel
  const hasSemanticLabel =
    node.conditionLabel && node.conditionLabel !== "<dynamic>";
  const trueBranchLabel = hasSemanticLabel ? node.conditionLabel : "true";
  const falseBranchLabel = hasSemanticLabel
    ? `Not ${node.conditionLabel}`
    : "false";

  // True/consequent branch
  const trueResult = renderNodes(node.consequent, context, lines);
  if (trueResult.firstNodeId) {
    context.edges.push({
      from: nodeId,
      to: trueResult.firstNodeId,
      label: trueBranchLabel,
    });
    lastNodeIds.push(...trueResult.lastNodeIds);
  }

  // False/alternate branch
  if (node.alternate && node.alternate.length > 0) {
    const falseResult = renderNodes(node.alternate, context, lines);
    if (falseResult.firstNodeId) {
      context.edges.push({
        from: nodeId,
        to: falseResult.firstNodeId,
        label: falseBranchLabel,
      });
      lastNodeIds.push(...falseResult.lastNodeIds);
    }
  } else {
    // No alternate - decision can skip directly
    lastNodeIds.push(nodeId);
  }

  return {
    firstNodeId: nodeId,
    lastNodeIds,
  };
}

function renderSwitchNode(
  node: StaticSwitchNode,
  context: RenderContext,
  lines: string[]
): RenderResult {
  const switchId = `switch_${++context.nodeCounter}`;

  // Switch diamond
  const exprLabel = truncate(node.expression, 30);
  lines.push(`  ${switchId}{"${escapeLabel(`switch: ${exprLabel}`)}"}`);
  context.styleClasses.set(switchId, "switchStyle");

  const lastNodeIds: string[] = [];

  // Each case branch
  for (const caseClause of node.cases) {
    if (caseClause.body.length === 0) continue;

    const caseResult = renderNodes(caseClause.body, context, lines);
    if (caseResult.firstNodeId) {
      const caseLabel = caseClause.isDefault
        ? "default"
        : truncate(caseClause.value ?? "", 15);
      context.edges.push({
        from: switchId,
        to: caseResult.firstNodeId,
        label: caseLabel,
      });
      lastNodeIds.push(...caseResult.lastNodeIds);
    }
  }

  // If no cases with bodies, switch itself is the end
  if (lastNodeIds.length === 0) {
    lastNodeIds.push(switchId);
  }

  return {
    firstNodeId: switchId,
    lastNodeIds,
  };
}

function renderLoopNode(
  node: StaticLoopNode,
  context: RenderContext,
  lines: string[]
): RenderResult {
  const loopStartId = `loop_start_${++context.nodeCounter}`;
  const loopEndId = `loop_end_${++context.nodeCounter}`;

  // Loop start (stadium shape)
  const loopLabel = node.iterSource
    ? `${node.loopType}: ${truncate(node.iterSource, 20)}`
    : node.loopType;
  lines.push(`  ${loopStartId}(["${escapeLabel(loopLabel)}"])`);
  context.styleClasses.set(loopStartId, "loopStyle");

  // Loop body
  const bodyResult = renderNodes(node.body, context, lines);

  // Connect loop start to body
  if (bodyResult.firstNodeId) {
    context.edges.push({
      from: loopStartId,
      to: bodyResult.firstNodeId,
      label: "iterate",
    });
  }

  // Loop end check
  lines.push(`  ${loopEndId}(["Continue?"])`);
  context.styleClasses.set(loopEndId, "loopStyle");

  // Connect body end to loop check
  for (const lastId of bodyResult.lastNodeIds) {
    context.edges.push({ from: lastId, to: loopEndId });
  }

  // Loop back
  context.edges.push({
    from: loopEndId,
    to: loopStartId,
    label: "next",
  });

  return {
    firstNodeId: loopStartId,
    lastNodeIds: [loopEndId],
  };
}

function renderWorkflowRefNode(
  node: StaticWorkflowRefNode,
  context: RenderContext,
  lines: string[]
): RenderResult {
  const nodeId = `workflow_ref_${++context.nodeCounter}`;

  // Subroutine shape for workflow reference
  const label = `[[${node.workflowName}]]`;
  lines.push(`  ${nodeId}${label}`);
  context.styleClasses.set(nodeId, "workflowRefStyle");

  return {
    firstNodeId: nodeId,
    lastNodeIds: [nodeId],
  };
}

function renderUnknownNode(
  node: StaticFlowNode & { type: "unknown" },
  context: RenderContext,
  lines: string[]
): RenderResult {
  const nodeId = `unknown_${++context.nodeCounter}`;

  lines.push(`  ${nodeId}[/"Unknown: ${escapeLabel(node.reason)}"/]`);

  return {
    firstNodeId: nodeId,
    lastNodeIds: [nodeId],
  };
}

// =============================================================================
// Utilities
// =============================================================================

function escapeLabel(label: string): string {
  return label
    .replace(/\r?\n/g, " ")
    .replace(/"/g, "'")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/#/g, "&num;")
    .replace(/\|/g, "&#124;");
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

// =============================================================================
// Simplified Mermaid (Path-based)
// =============================================================================

/**
 * Generate a simplified Mermaid diagram showing just the paths.
 */
export function renderPathsMermaid(
  paths: Array<{
    id: string;
    steps: Array<{ name?: string; nodeId: string }>;
    conditions: Array<{ expression: string; mustBe: boolean }>;
  }>,
  options: MermaidOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = [];

  lines.push(`flowchart ${opts.direction}`);
  lines.push("");

  // Create unique node IDs for each step across all paths
  // Use nodeId as the unique key to avoid merging distinct steps with the same name
  const stepNodes = new Map<string, { id: string; name: string }>();
  let nodeCounter = 0;

  for (const path of paths) {
    for (const step of path.steps) {
      const key = step.nodeId; // Use nodeId to keep distinct steps separate
      if (!stepNodes.has(key)) {
        stepNodes.set(key, {
          id: `step_${++nodeCounter}`,
          name: step.name ?? step.nodeId,
        });
      }
    }
  }

  // Add start and end nodes
  lines.push("  start((Start))");
  lines.push("  end_node((End))");
  lines.push("");

  // Add all step nodes
  for (const [_nodeId, stepInfo] of stepNodes) {
    lines.push(`  ${stepInfo.id}["${escapeLabel(stepInfo.name)}"]`);
  }
  lines.push("");

  // Add edges for each path
  const edges = new Set<string>();

  for (const path of paths) {
    if (path.steps.length === 0) continue;

    // Start to first step
    const firstStep = path.steps[0];
    const firstStepInfo = stepNodes.get(firstStep.nodeId)!;
    edges.add(`start --> ${firstStepInfo.id}`);

    // Between steps
    for (let i = 0; i < path.steps.length - 1; i++) {
      const current = path.steps[i];
      const next = path.steps[i + 1];
      const currentInfo = stepNodes.get(current.nodeId)!;
      const nextInfo = stepNodes.get(next.nodeId)!;
      edges.add(`${currentInfo.id} --> ${nextInfo.id}`);
    }

    // Last step to end
    const lastStep = path.steps[path.steps.length - 1];
    const lastStepInfo = stepNodes.get(lastStep.nodeId)!;
    edges.add(`${lastStepInfo.id} --> end_node`);
  }

  // Add edges
  lines.push("  %% Edges");
  for (const edge of edges) {
    lines.push(`  ${edge}`);
  }

  return lines.join("\n");
}

// =============================================================================
// Enhanced Mermaid with Data Flow & Errors
// =============================================================================

import { buildDataFlowGraph } from "../data-flow";
import { analyzeErrorFlow } from "../error-flow";

/**
 * Options for enhanced Mermaid rendering.
 */
export interface EnhancedMermaidOptions extends MermaidOptions {
  /** Show data flow edges between steps */
  showDataFlow?: boolean;
  /** Show errors as annotations on steps */
  showErrors?: boolean;
  /** Show errors as separate nodes */
  showErrorNodes?: boolean;
  /** Show steps that don't declare errors with warning style */
  highlightMissingErrors?: boolean;
}

const DEFAULT_ENHANCED_OPTIONS: EnhancedMermaidOptions = {
  ...DEFAULT_OPTIONS,
  showDataFlow: true,
  showErrors: true,
  showErrorNodes: false,
  highlightMissingErrors: true,
};

/**
 * Generate an enhanced Mermaid diagram with data flow and error annotations.
 * Uses renderStaticMermaid as the base and overlays data-flow edges and
 * error annotations from the error-flow analyzer.
 */
export function renderEnhancedMermaid(
  ir: StaticWorkflowIR,
  options: EnhancedMermaidOptions = {}
): string {
  const opts = { ...DEFAULT_ENHANCED_OPTIONS, ...options };

  // Build data flow and error analysis
  const dataFlow = buildDataFlowGraph(ir);
  const errorFlow = analyzeErrorFlow(ir);

  // Build step label annotations from data flow and error analysis
  const stepLabelAnnotations = new Map<string, string[]>();
  for (const stepError of errorFlow.stepErrors) {
    const annotations: string[] = [];

    // Data flow annotation
    if (opts.showDataFlow) {
      const dataNode = dataFlow.nodes.find(n => n.id === stepError.stepId);
      if (dataNode?.writes) {
        annotations.push(`out: ${dataNode.writes}`);
      }
    }

    // Error annotation
    if (opts.showErrors && stepError.errors.length > 0) {
      const errorList = stepError.errors.slice(0, 2).join(", ");
      const suffix = stepError.errors.length > 2 ? "..." : "";
      annotations.push(`errors: ${errorList}${suffix}`);
    }

    if (annotations.length > 0) {
      stepLabelAnnotations.set(stepError.stepId, annotations);
    }
  }

  // Use static renderer with inline errors enabled as the base
  const baseOpts: Required<MermaidOptions> = {
    ...DEFAULT_OPTIONS,
    ...opts,
    showInlineErrors: opts.showInlineErrors ?? false,
    expandRetry: opts.expandRetry ?? false,
  };
  const { lines, context } = renderStaticMermaidInternal(ir, baseOpts, stepLabelAnnotations);

  // Use stepIdMap from the static renderer context
  const stepIdMap = context.stepIdMap;

  // Overlay: data flow edges
  if (opts.showDataFlow && dataFlow.edges.length > 0) {
    lines.push("");
    lines.push("  %% Data Flow");
    for (const edge of dataFlow.edges) {
      const fromId = stepIdMap.get(edge.from);
      const toId = stepIdMap.get(edge.to);
      if (fromId && toId) {
        lines.push(`  ${fromId} -.->|${edge.key}| ${toId}`);
      }
    }
  }

  // Overlay: error nodes in subgraph (from error-flow analysis)
  if (opts.showErrorNodes && errorFlow.allErrors.length > 0) {
    lines.push("");
    lines.push("  %% Error Types");
    lines.push("  subgraph Errors");
    for (const error of errorFlow.allErrors) {
      lines.push(`    err_${sanitizeId(error)}(["${error}"])`);
    }
    lines.push("  end");
    lines.push("");
    lines.push("  %% Error Edges");
    for (const step of errorFlow.stepErrors) {
      const mermaidId = stepIdMap.get(step.stepId);
      if (mermaidId) {
        for (const error of step.errors) {
          lines.push(`  ${mermaidId} -.->|throws| err_${sanitizeId(error)}`);
        }
      }
    }
  }

  // Overlay: additional enhanced styles
  lines.push("  classDef errorStyle fill:#ffcdd2,stroke:#c62828");
  lines.push("  classDef noErrorStyle fill:#fff3cd,stroke:#856404");
  lines.push("  classDef dataFlowStyle stroke:#1565c0,stroke-width:2px,stroke-dasharray:5");

  // Apply missing-error highlighting
  if (opts.highlightMissingErrors) {
    for (const [stepId, mermaidId] of stepIdMap) {
      const hasErrors = errorFlow.stepErrors.find(s => s.stepId === stepId)?.errors.length ?? 0;
      if (hasErrors === 0) {
        lines.push(`  class ${mermaidId} noErrorStyle`);
      }
    }
  }

  // Style error subgraph nodes
  if (opts.showErrorNodes) {
    for (const error of errorFlow.allErrors) {
      lines.push(`  class err_${sanitizeId(error)} errorStyle`);
    }
  }

  return lines.join("\n");
}

/**
 * Sanitize a string for use as a Mermaid node ID.
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}
