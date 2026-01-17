/**
 * Mermaid Diagram Renderer
 *
 * Renders the workflow IR as a Mermaid flowchart diagram.
 * Supports sequential flows, parallel (subgraph), and race patterns.
 */

import type {
  FlowNode,
  ParallelNode,
  RaceNode,
  DecisionNode,
  Renderer,
  RenderOptions,
  MermaidRenderOptions,
  StepNode,
  StepState,
  WorkflowIR,
  EnhancedRenderOptions,
  HeatLevel,
  WorkflowHooks,
} from "../types";
import { isParallelNode, isRaceNode, isStepNode, isDecisionNode } from "../types";
import { formatDuration } from "../utils/timing";
import { getHeatLevel } from "../performance-analyzer";

// =============================================================================
// Mermaid Style Definitions
// =============================================================================

/**
 * Get Mermaid class definition for step states.
 * Colors inspired by AWS Step Functions and XState visualizers for professional appearance.
 */
function getStyleDefinitions(): string[] {
  return [
    // Pending - light gray, subtle
    "    classDef pending fill:#f3f4f6,stroke:#9ca3af,stroke-width:2px,color:#374151",
    // Running - amber/yellow, indicates active execution
    "    classDef running fill:#fef3c7,stroke:#f59e0b,stroke-width:3px,color:#92400e",
    // Success - green, clear positive indicator
    "    classDef success fill:#d1fae5,stroke:#10b981,stroke-width:3px,color:#065f46",
    // Error - red, clear negative indicator
    "    classDef error fill:#fee2e2,stroke:#ef4444,stroke-width:3px,color:#991b1b",
    // Aborted - gray, indicates cancellation
    "    classDef aborted fill:#f3f4f6,stroke:#6b7280,stroke-width:2px,color:#4b5563,stroke-dasharray: 5 5",
    // Cached - blue, indicates cache hit
    "    classDef cached fill:#dbeafe,stroke:#3b82f6,stroke-width:3px,color:#1e40af",
    // Skipped - light gray with dashed border
    "    classDef skipped fill:#f9fafb,stroke:#d1d5db,stroke-width:2px,color:#6b7280,stroke-dasharray: 5 5",
  ];
}

/**
 * Get Mermaid class definitions for heatmap visualization.
 */
function getHeatmapStyleDefinitions(): string[] {
  return [
    // Heatmap colors - cold to hot
    "    classDef heat_cold fill:#dbeafe,stroke:#3b82f6,stroke-width:2px,color:#1e40af",
    "    classDef heat_cool fill:#ccfbf1,stroke:#14b8a6,stroke-width:2px,color:#0f766e",
    "    classDef heat_neutral fill:#f3f4f6,stroke:#6b7280,stroke-width:2px,color:#374151",
    "    classDef heat_warm fill:#fef3c7,stroke:#f59e0b,stroke-width:2px,color:#92400e",
    "    classDef heat_hot fill:#fed7aa,stroke:#f97316,stroke-width:3px,color:#c2410c",
    "    classDef heat_critical fill:#fecaca,stroke:#ef4444,stroke-width:3px,color:#b91c1c",
  ];
}

/**
 * Get the Mermaid class name for a heat level.
 */
function getHeatClass(level: HeatLevel): string {
  return `heat_${level}`;
}

/**
 * Get the Mermaid class name for a step state.
 */
function getStateClass(state: StepState): string {
  return state;
}

/**
 * Get Mermaid class definitions for hook visualization.
 */
function getHookStyleDefinitions(): string[] {
  return [
    // Hook styles - gear icon aesthetic
    "    classDef hook_success fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0c4a6e",
    "    classDef hook_error fill:#fef2f2,stroke:#dc2626,stroke-width:2px,color:#7f1d1d",
  ];
}

/**
 * Render hooks as nodes before the workflow starts.
 * Returns the ID of the last hook node (to connect to workflow start).
 */
function renderHooks(
  hooks: WorkflowHooks,
  lines: string[],
  options: RenderOptions
): { lastHookId: string | undefined } {
  let lastHookId: string | undefined;

  // Render shouldRun hook
  if (hooks.shouldRun) {
    const hookId = "hook_shouldRun";
    const state = hooks.shouldRun.state === "success" ? "hook_success" : "hook_error";
    const icon = hooks.shouldRun.state === "success" ? "⚙" : "⚠";
    const timing = options.showTimings && hooks.shouldRun.durationMs !== undefined
      ? ` ${formatDuration(hooks.shouldRun.durationMs)}`
      : "";
    const context = hooks.shouldRun.context?.skipped
      ? "\\nskipped workflow"
      : hooks.shouldRun.context?.result === true
        ? "\\nproceed"
        : "";

    lines.push(`    ${hookId}[["${icon} shouldRun${context}${timing}"]]:::${state}`);
    lastHookId = hookId;
  }

  // Render onBeforeStart hook
  if (hooks.onBeforeStart) {
    const hookId = "hook_beforeStart";
    const state = hooks.onBeforeStart.state === "success" ? "hook_success" : "hook_error";
    const icon = hooks.onBeforeStart.state === "success" ? "⚙" : "⚠";
    const timing = options.showTimings && hooks.onBeforeStart.durationMs !== undefined
      ? ` ${formatDuration(hooks.onBeforeStart.durationMs)}`
      : "";
    const context = hooks.onBeforeStart.context?.skipped
      ? "\\nskipped workflow"
      : "";

    lines.push(`    ${hookId}[["${icon} onBeforeStart${context}${timing}"]]:::${state}`);

    // Connect from previous hook if exists
    if (lastHookId) {
      lines.push(`    ${lastHookId} --> ${hookId}`);
    }
    lastHookId = hookId;
  }

  return { lastHookId };
}

// =============================================================================
// Node ID Generation
// =============================================================================

let nodeCounter = 0;

function generateNodeId(prefix: string = "node"): string {
  return `${prefix}_${++nodeCounter}`;
}

function resetNodeCounter(): void {
  nodeCounter = 0;
}

// =============================================================================
// Mermaid Text Escaping
// =============================================================================

/**
 * Escape text for use in Mermaid diagrams.
 * Removes characters that break Mermaid parsing.
 * 
 * Characters removed:
 * - {}[]() - Brackets and parentheses break parsing in labels
 * - <> - Angle brackets can cause issues
 * - " - Double quotes replaced with single quotes
 * 
 * @param text - Text to escape
 * @returns Escaped text safe for Mermaid
 */
function escapeMermaidText(text: string): string {
  return text
    .replace(/[{}[\]()]/g, "") // Remove brackets and parentheses (they break parsing)
    .replace(/[<>]/g, "") // Remove angle brackets
    .replace(/"/g, "'") // Replace double quotes with single
    .trim();
}

/**
 * Escape text for use in Mermaid subgraph names.
 * Subgraph names in brackets need special handling.
 * 
 * @param text - Text to escape for subgraph name
 * @returns Escaped text safe for subgraph names
 */
function escapeSubgraphName(text: string): string {
  return escapeMermaidText(text)
    .replace(/[[\]]/g, ""); // Also remove brackets from subgraph names
}

// =============================================================================
// Mermaid Renderer
// =============================================================================

/**
 * Create the Mermaid diagram renderer.
 */
export function mermaidRenderer(): Renderer {
  return {
    name: "mermaid",
    supportsLive: false,

    render(ir: WorkflowIR, options: RenderOptions): string {
      resetNodeCounter();
      const lines: string[] = [];

      // Check for enhanced options (heatmap)
      const enhanced = options as EnhancedRenderOptions;

      // Diagram header
      lines.push("flowchart TD");

      // Render hooks first (if any)
      let hookExitId: string | undefined;
      if (ir.hooks) {
        const hookResult = renderHooks(ir.hooks, lines, options);
        hookExitId = hookResult.lastHookId;
      }

      // Start node - more visually distinctive
      const startId = "start";
      lines.push(`    ${startId}(("▶ Start"))`);

      // Connect hooks to start node
      if (hookExitId) {
        lines.push(`    ${hookExitId} --> ${startId}`);
      }

      // Track the last node for connections
      let prevNodeId = startId;

      // Render children (passing hooks for onAfterStep annotations)
      for (const child of ir.root.children) {
        const result = renderNode(child, options, lines, enhanced, ir.hooks);
        lines.push(`    ${prevNodeId} --> ${result.entryId}`);
        prevNodeId = result.exitId;
      }

      // End node (if workflow completed) - more visually distinctive
      if (ir.root.state === "success" || ir.root.state === "error") {
        const endId = "finish";
        const endIcon = ir.root.state === "success" ? "✓" : "✗";
        const endLabel = ir.root.state === "success" ? "Done" : "Failed";
        const endShape = `(("${endIcon} ${endLabel}"))`;
        const endClass =
          ir.root.state === "success" ? ":::success" : ":::error";
        lines.push(`    ${endId}${endShape}${endClass}`);
        lines.push(`    ${prevNodeId} --> ${endId}`);
      }

      // Add style definitions
      lines.push("");
      lines.push(...getStyleDefinitions());

      // Add heatmap styles if enabled
      if (enhanced.showHeatmap) {
        lines.push(...getHeatmapStyleDefinitions());
      }

      // Add hook styles if hooks were rendered
      if (ir.hooks) {
        lines.push(...getHookStyleDefinitions());
      }

      return lines.join("\n");
    },
  };
}

/**
 * Render result with entry and exit node IDs.
 */
interface RenderResult {
  entryId: string;
  exitId: string;
}

/**
 * Render a node and return its entry/exit IDs.
 */
function renderNode(
  node: FlowNode,
  options: RenderOptions,
  lines: string[],
  enhanced?: EnhancedRenderOptions,
  hooks?: WorkflowHooks
): RenderResult {
  if (isStepNode(node)) {
    return renderStepNode(node, options, lines, enhanced, hooks);
  } else if (isParallelNode(node)) {
    return renderParallelNode(node, options, lines, enhanced, hooks);
  } else if (isRaceNode(node)) {
    return renderRaceNode(node, options, lines, enhanced, hooks);
  } else if (isDecisionNode(node)) {
    return renderDecisionNode(node, options, lines, enhanced, hooks);
  }

  // Fallback for sequence or unknown nodes
  const id = generateNodeId("unknown");
  lines.push(`    ${id}[Unknown Node]`);
  return { entryId: id, exitId: id };
}

/**
 * Render a step node.
 */
function renderStepNode(
  node: StepNode,
  options: RenderOptions,
  lines: string[],
  enhanced?: EnhancedRenderOptions,
  hooks?: WorkflowHooks
): RenderResult {
  // Cast to MermaidRenderOptions to access extended options
  const mermaidOpts = options as MermaidRenderOptions;
  const showRetryEdges = mermaidOpts.showRetryEdges ?? true;
  const showErrorEdges = mermaidOpts.showErrorEdges ?? true;
  const showTimeoutEdges = mermaidOpts.showTimeoutEdges ?? true;

  const id = node.key
    ? `step_${node.key.replace(/[^a-zA-Z0-9]/g, "_")}`
    : generateNodeId("step");

  const label = escapeMermaidText(node.name ?? node.key ?? "Step");

  // Format timing - use space instead of parentheses to avoid Mermaid parse errors
  const timing =
    options.showTimings && node.durationMs !== undefined
      ? ` ${formatDuration(node.durationMs)}`
      : "";

  // Add visual indicators based on state (like XState/AWS Step Functions)
  let stateIcon = "";
  switch (node.state) {
    case "success":
      stateIcon = "✓ ";
      break;
    case "error":
      stateIcon = "✗ ";
      break;
    case "cached":
      stateIcon = "💾 ";
      break;
    case "running":
      stateIcon = "⏳ ";
      break;
    case "skipped":
      stateIcon = "⊘ ";
      break;
  }

  // Add input/output info if available
  // Use newlines for multi-line labels, but escape special characters
  let ioInfo = "";
  if (node.input !== undefined) {
    const inputStr = typeof node.input === "string"
      ? escapeMermaidText(node.input)
      : escapeMermaidText(JSON.stringify(node.input).slice(0, 20));
    ioInfo += `\\nin: ${inputStr}`;
  }
  if (node.output !== undefined && node.state === "success") {
    const outputStr = typeof node.output === "string"
      ? escapeMermaidText(node.output)
      : escapeMermaidText(JSON.stringify(node.output).slice(0, 20));
    ioInfo += `\\nout: ${outputStr}`;
  }

  // Add onAfterStep hook info if present
  let hookInfo = "";
  if (hooks && node.key && hooks.onAfterStep.has(node.key)) {
    const hookExec = hooks.onAfterStep.get(node.key)!;
    const hookIcon = hookExec.state === "success" ? "⚙" : "⚠";
    const hookTiming = options.showTimings && hookExec.durationMs !== undefined
      ? ` ${formatDuration(hookExec.durationMs)}`
      : "";
    hookInfo = `\\n${hookIcon} hook${hookTiming}`;
  }

  // Combine all label parts with icon (retry/timeout info moved to edges)
  const escapedLabel = (stateIcon + label + ioInfo + hookInfo + timing).trim();

  // Determine class: use heatmap if enabled and data available, otherwise use state
  let nodeClass: string;
  const nodeId = node.name ?? node.id;
  const heat = enhanced?.showHeatmap && enhanced.heatmapData
    ? enhanced.heatmapData.heat.get(node.id) ?? enhanced.heatmapData.heat.get(nodeId)
    : undefined;

  if (heat !== undefined) {
    const level = getHeatLevel(heat);
    nodeClass = getHeatClass(level);
  } else {
    nodeClass = getStateClass(node.state);
  }

  // Use different shapes based on state (like AWS Step Functions)
  let shape: string;
  switch (node.state) {
    case "error":
      // Hexagon for errors (more distinctive)
      shape = `{{${escapedLabel}}}`;
      break;
    case "cached":
      // Rounded rectangle with double border for cached
      shape = `[(${escapedLabel})]`;
      break;
    case "skipped":
      // Dashed border for skipped
      shape = `[${escapedLabel}]:::skipped`;
      break;
    default:
      // Standard rectangle for normal steps
      shape = `[${escapedLabel}]`;
  }

  lines.push(`    ${id}${shape}:::${nodeClass}`);

  // NEW: Add retry loop edge (self-loop showing retries)
  if (showRetryEdges && node.retryCount !== undefined && node.retryCount > 0) {
    const retryLabel = `↻ ${node.retryCount} retr${node.retryCount === 1 ? "y" : "ies"}`;
    lines.push(`    ${id} -.->|"${retryLabel}"| ${id}`);
  }

  // NEW: Add error path edge (flow to error node)
  if (showErrorEdges && node.state === "error" && node.error !== undefined) {
    const errorNodeId = `ERR_${id}`;
    const errorLabel = escapeMermaidText(String(node.error)).slice(0, 30);
    lines.push(`    ${errorNodeId}{{${errorLabel}}}`);
    lines.push(`    ${id} -->|error| ${errorNodeId}`);
    lines.push(`    style ${errorNodeId} fill:#fee2e2,stroke:#dc2626`);
  }

  // NEW: Add timeout edge (alternative timeout path)
  if (showTimeoutEdges && node.timedOut) {
    const timeoutNodeId = `TO_${id}`;
    const timeoutMs = node.timeoutMs !== undefined ? `${node.timeoutMs}ms` : "";
    lines.push(`    ${timeoutNodeId}{{⏱ Timeout ${timeoutMs}}}`);
    lines.push(`    ${id} -.->|timeout| ${timeoutNodeId}`);
    lines.push(`    style ${timeoutNodeId} fill:#fef3c7,stroke:#f59e0b`);
  }

  return { entryId: id, exitId: id };
}

/**
 * Render a parallel node as a subgraph with fork/join.
 */
function renderParallelNode(
  node: ParallelNode,
  options: RenderOptions,
  lines: string[],
  enhanced?: EnhancedRenderOptions,
  hooks?: WorkflowHooks
): RenderResult {
  const subgraphId = generateNodeId("parallel");
  const forkId = `${subgraphId}_fork`;
  const joinId = `${subgraphId}_join`;
  const name = escapeSubgraphName(node.name ?? "Parallel");
  const modeLabel = node.mode === "allSettled" ? " (allSettled)" : "";

  // If no children, render as a simple step-like node with note
  if (node.children.length === 0) {
    const id = subgraphId;
    const label = escapeMermaidText(`${name}${modeLabel}`);
    const note = "operations not individually tracked";
    const timing = options.showTimings && node.durationMs !== undefined
      ? ` ${formatDuration(node.durationMs)}`
      : "";
    
    // Use a rounded rectangle to indicate it's a parallel operation
    lines.push(`    ${id}[${label}${timing}\\n${note}]:::${getStateClass(node.state)}`);
    return { entryId: id, exitId: id };
  }

  // Subgraph for parallel block with proper visual hierarchy
  lines.push(`    subgraph ${subgraphId}["${name}${modeLabel}"]`);
  lines.push(`    direction TB`);

  // Fork node (diamond) - more visually distinct
  lines.push(`    ${forkId}{"⚡ Fork"}`);

  // Child branches - render in parallel columns
  const childExitIds: string[] = [];
  for (const child of node.children) {
    const result = renderNode(child, options, lines, enhanced, hooks);
    lines.push(`    ${forkId} --> ${result.entryId}`);
    childExitIds.push(result.exitId);
  }

  // Join node (diamond) - visually distinct
  lines.push(`    ${joinId}{"✓ Join"}`);
  for (const exitId of childExitIds) {
    lines.push(`    ${exitId} --> ${joinId}`);
  }

  lines.push(`    end`);

  // Apply state styling to subgraph
  const stateClass = getStateClass(node.state);
  lines.push(`    class ${subgraphId} ${stateClass}`);

  return { entryId: forkId, exitId: joinId };
}

/**
 * Render a race node as a subgraph with racing indicator.
 */
function renderRaceNode(
  node: RaceNode,
  options: RenderOptions,
  lines: string[],
  enhanced?: EnhancedRenderOptions,
  hooks?: WorkflowHooks
): RenderResult {
  const subgraphId = generateNodeId("race");
  const startId = `${subgraphId}_start`;
  const endId = `${subgraphId}_end`;
  const name = escapeSubgraphName(node.name ?? "Race");

  // If no children, render as a simple step-like node with note
  if (node.children.length === 0) {
    const id = subgraphId;
    const label = escapeMermaidText(name);
    const note = "operations not individually tracked";
    const timing = options.showTimings && node.durationMs !== undefined
      ? ` ${formatDuration(node.durationMs)}`
      : "";
    
    lines.push(`    ${id}[⚡ ${label}${timing}\\n${note}]:::${getStateClass(node.state)}`);
    return { entryId: id, exitId: id };
  }

  // Subgraph for race block - escape name and emoji is safe in quoted strings
  lines.push(`    subgraph ${subgraphId}["⚡ ${name}"]`);
  lines.push(`    direction TB`);

  // Start node - use a more distinctive shape
  lines.push(`    ${startId}(("🏁 Start"))`);

  // Child branches
  const childExitIds: Array<{ exitId: string; isWinner: boolean }> = [];
  let winnerExitId: string | undefined;

  for (const child of node.children) {
    const result = renderNode(child, options, lines, enhanced, hooks);
    const isWinner = isStepNode(child) && node.winnerId === child.id;
    lines.push(`    ${startId} --> ${result.entryId}`);

    if (isWinner) {
      winnerExitId = result.exitId;
    }
    childExitIds.push({ exitId: result.exitId, isWinner });
  }

  // End node - more distinctive
  lines.push(`    ${endId}(("✓ First"))`);
  
  // Connect winner with thick line, others with dashed (cancelled)
  for (const { exitId, isWinner } of childExitIds) {
    if (isWinner && winnerExitId) {
      lines.push(`    ${exitId} ==>|🏆 Winner| ${endId}`);
    } else if (node.winnerId) {
      // Non-winner: show as cancelled
      lines.push(`    ${exitId} -. cancelled .-> ${endId}`);
    } else {
      // No winner determined, normal connection
      lines.push(`    ${exitId} --> ${endId}`);
    }
  }

  lines.push(`    end`);

  const stateClass = getStateClass(node.state);
  lines.push(`    class ${subgraphId} ${stateClass}`);

  return { entryId: startId, exitId: endId };
}

/**
 * Render a decision node as a diamond with branches.
 */
function renderDecisionNode(
  node: DecisionNode,
  options: RenderOptions,
  lines: string[],
  enhanced?: EnhancedRenderOptions,
  hooks?: WorkflowHooks
): RenderResult {
  const decisionId = node.key
    ? `decision_${node.key.replace(/[^a-zA-Z0-9]/g, "_")}`
    : generateNodeId("decision");

  // Escape condition and decision value - remove characters that break Mermaid
  const condition = escapeMermaidText(node.condition ?? "condition");
  const decisionValue = node.decisionValue !== undefined
    ? ` = ${escapeMermaidText(String(node.decisionValue)).slice(0, 30)}`
    : "";

  // Decision diamond - ensure no invalid characters
  const decisionLabel = `${condition}${decisionValue}`.trim();
  lines.push(`    ${decisionId}{${decisionLabel}}`);

  // Render branches
  const branchExitIds: string[] = [];
  let takenBranchExitId: string | undefined;

  for (const branch of node.branches) {
    const branchId = `${decisionId}_${branch.label.replace(/[^a-zA-Z0-9]/g, "_")}`;
    // Escape branch label - remove parentheses and other special chars
    const branchLabelText = escapeMermaidText(branch.label);
    const branchLabel = branch.taken
      ? `${branchLabelText} ✓`
      : `${branchLabelText} skipped`;
    const branchClass = branch.taken ? ":::success" : ":::skipped";

    // Branch label node
    lines.push(`    ${branchId}[${branchLabel}]${branchClass}`);

    // Connect decision to branch
    // Mermaid edge labels must be simple text - escape special characters
    // Also remove pipe character as it's used for edge label syntax
    const edgeLabel = branch.condition 
      ? `|${escapeMermaidText(branch.condition).replace(/\|/g, "")}|` 
      : "";
    lines.push(`    ${decisionId} -->${edgeLabel} ${branchId}`);

    // Render children of this branch
    if (branch.children.length > 0) {
      let prevId = branchId;
      for (const child of branch.children) {
        const result = renderNode(child, options, lines, enhanced, hooks);
        lines.push(`    ${prevId} --> ${result.entryId}`);
        prevId = result.exitId;
      }
      branchExitIds.push(prevId);
      if (branch.taken) {
        takenBranchExitId = prevId;
      }
    } else {
      branchExitIds.push(branchId);
      if (branch.taken) {
        takenBranchExitId = branchId;
      }
    }
  }

  // Join point (if we have a taken branch)
  if (takenBranchExitId) {
    return { entryId: decisionId, exitId: takenBranchExitId };
  }

  // If no branch was taken, return decision as exit
  return { entryId: decisionId, exitId: decisionId };
}

export { mermaidRenderer as default };
