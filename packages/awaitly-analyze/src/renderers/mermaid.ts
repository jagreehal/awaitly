/**
 * Mermaid Diagram Generator
 *
 * Generates Mermaid flowchart diagrams from static workflow analysis.
 * Shows all possible paths, not just executed ones.
 */

import type {
  StaticWorkflowIR,
  StaticFlowNode,
  StaticStepNode,
  StaticSequenceNode,
  StaticParallelNode,
  StaticRaceNode,
  StaticConditionalNode,
  StaticLoopNode,
  StaticWorkflowRefNode,
} from "../types";

// =============================================================================
// Options
// =============================================================================

export interface MermaidOptions {
  /** Diagram direction: TB (top-bottom), LR (left-right), etc. */
  direction?: "TB" | "LR" | "BT" | "RL";
  /** Show step keys in labels */
  showKeys?: boolean;
  /** Show condition labels on edges */
  showConditions?: boolean;
  /** Use subgraphs for parallel/race blocks */
  useSubgraphs?: boolean;
  /** Custom node styles */
  styles?: MermaidStyles;
}

export interface MermaidStyles {
  step?: string;
  parallel?: string;
  race?: string;
  conditional?: string;
  loop?: string;
  workflowRef?: string;
  start?: string;
  end?: string;
}

const DEFAULT_OPTIONS: Required<MermaidOptions> = {
  direction: "TB",
  showKeys: false,
  showConditions: true,
  useSubgraphs: true,
  styles: {
    step: "fill:#e1f5fe,stroke:#01579b",
    parallel: "fill:#e8f5e9,stroke:#1b5e20",
    race: "fill:#fff3e0,stroke:#e65100",
    conditional: "fill:#fce4ec,stroke:#880e4f",
    loop: "fill:#f3e5f5,stroke:#4a148c",
    workflowRef: "fill:#e0f2f1,stroke:#004d40",
    start: "fill:#c8e6c9,stroke:#2e7d32",
    end: "fill:#ffcdd2,stroke:#c62828",
  },
};

// =============================================================================
// Main Generator
// =============================================================================

/**
 * Generate a Mermaid flowchart from static workflow IR.
 */
export function renderStaticMermaid(
  ir: StaticWorkflowIR,
  options: MermaidOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const context: RenderContext = {
    opts,
    nodeCounter: 0,
    edges: [],
    subgraphs: [],
    styleClasses: new Map(),
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
  lines.push(`  classDef parallelStyle ${opts.styles.parallel}`);
  lines.push(`  classDef raceStyle ${opts.styles.race}`);
  lines.push(`  classDef conditionalStyle ${opts.styles.conditional}`);
  lines.push(`  classDef loopStyle ${opts.styles.loop}`);
  lines.push(`  classDef workflowRefStyle ${opts.styles.workflowRef}`);
  lines.push(`  classDef startStyle ${opts.styles.start}`);
  lines.push(`  classDef endStyle ${opts.styles.end}`);

  // Apply styles
  lines.push(`  class ${startId} startStyle`);
  lines.push(`  class ${endId} endStyle`);

  for (const [nodeId, styleClass] of context.styleClasses) {
    lines.push(`  class ${nodeId} ${styleClass}`);
  }

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

    case "sequence":
      return renderSequenceNode(node, context, lines);

    case "parallel":
      return renderParallelNode(node, context, lines);

    case "race":
      return renderRaceNode(node, context, lines);

    case "conditional":
      return renderConditionalNode(node, context, lines);

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

function renderStepNode(
  node: StaticStepNode,
  context: RenderContext,
  lines: string[]
): RenderResult {
  const nodeId = `step_${++context.nodeCounter}`;
  let label = node.name ?? node.callee ?? "step";

  if (context.opts.showKeys && node.key) {
    label = `${label}\\n[${node.key}]`;
  }

  // Add retry/timeout indicators
  if (node.retry) {
    label += "\\n(retry)";
  }
  if (node.timeout) {
    label += "\\n(timeout)";
  }

  lines.push(`  ${nodeId}[${escapeLabel(label)}]`);
  context.styleClasses.set(nodeId, "stepStyle");

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

  // Fork node (diamond shape for parallel)
  const parallelLabel = node.name ? `${node.name} (${node.mode})` : `Parallel (${node.mode})`;
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

  // Fork node (hexagon for race)
  const raceLabel = node.name ? node.name : "Race";
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
  lines.push(`  ${decisionId}{${escapeLabel(conditionLabel)}}`);
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
  lines.push(`  ${loopStartId}([${escapeLabel(loopLabel)}])`);
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
  lines.push(`  ${loopEndId}([Continue?])`);
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
    .replace(/"/g, "'")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  // Key by nodeId (unique), store both the generated ID and display label
  const stepNodes = new Map<string, { id: string; label: string }>();
  let nodeCounter = 0;

  for (const path of paths) {
    for (const step of path.steps) {
      // Use nodeId as unique key to prevent merging distinct steps with same name
      if (!stepNodes.has(step.nodeId)) {
        stepNodes.set(step.nodeId, {
          id: `step_${++nodeCounter}`,
          label: step.name ?? step.nodeId,
        });
      }
    }
  }

  // Add start and end nodes
  lines.push("  start((Start))");
  lines.push("  end_node((End))");
  lines.push("");

  // Add all step nodes
  for (const [, { id, label }] of stepNodes) {
    lines.push(`  ${id}[${escapeLabel(label)}]`);
  }
  lines.push("");

  // Add edges for each path
  const edges = new Set<string>();

  for (const path of paths) {
    if (path.steps.length === 0) continue;

    // Start to first step
    const firstStep = path.steps[0];
    const firstStepId = stepNodes.get(firstStep.nodeId)!.id;
    edges.add(`start --> ${firstStepId}`);

    // Between steps
    for (let i = 0; i < path.steps.length - 1; i++) {
      const current = path.steps[i];
      const next = path.steps[i + 1];
      const currentId = stepNodes.get(current.nodeId)!.id;
      const nextId = stepNodes.get(next.nodeId)!.id;
      edges.add(`${currentId} --> ${nextId}`);
    }

    // Last step to end
    const lastStep = path.steps[path.steps.length - 1];
    const lastStepId = stepNodes.get(lastStep.nodeId)!.id;
    edges.add(`${lastStepId} --> end_node`);
  }

  // Add edges
  lines.push("  %% Edges");
  for (const edge of edges) {
    lines.push(`  ${edge}`);
  }

  return lines.join("\n");
}
