/**
 * Mermaid Diagram Renderer
 *
 * Renders the workflow IR as a Mermaid flowchart diagram.
 * Supports sequential flows, parallel (subgraph), and race patterns.
 */

import { ok, err, type Result } from "awaitly";
import type {
  FlowNode,
  ParallelNode,
  RaceNode,
  DecisionNode,
  StreamNode,
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
import { isParallelNode, isRaceNode, isStepNode, isDecisionNode, isStreamNode } from "../types";
import { formatDuration } from "../utils/timing";
import { getHeatLevel } from "../performance-analyzer";

/**
 * Error types for stringify operations.
 */
export type StringifyError = "STRINGIFY_ERROR";

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
    // Stream - purple/violet, indicates streaming operation
    "    classDef stream fill:#ede9fe,stroke:#8b5cf6,stroke-width:3px,color:#5b21b6",
    // Stream active - purple with animation indicator
    "    classDef streamActive fill:#ddd6fe,stroke:#7c3aed,stroke-width:3px,color:#4c1d95",
    // Stream error - purple-red for stream errors
    "    classDef streamError fill:#fce7f3,stroke:#db2777,stroke-width:3px,color:#9d174d",
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
 * Safely stringify a value, handling circular references and BigInt.
 * Returns Result with either the stringified value or an error.
 */
function safeStringify(value: unknown): Result<string, StringifyError> {
  try {
    const replacer = (_key: string, v: unknown): unknown => {
      if (typeof v !== "bigint") return v;
      const n = Number(v);
      return Number.isSafeInteger(n) ? n : v.toString();
    };
    return ok(JSON.stringify(value, replacer));
  } catch {
    return err("STRINGIFY_ERROR");
  }
}

/**
 * Get stringified value or fallback for unserializable values.
 */
function getStringified(value: unknown): string {
  const result = safeStringify(value);
  return result.ok ? result.value : "[unserializable]";
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
const usedDecisionIds = new Set<string>();
const usedStepIds = new Set<string>();

function generateNodeId(prefix: string = "node"): string {
  return `${prefix}_${++nodeCounter}`;
}

function resetNodeCounter(): void {
  nodeCounter = 0;
  usedDecisionIds.clear();
  usedStepIds.clear();
}

// =============================================================================
// Mermaid Text Escaping
// =============================================================================

/**
 * Escape text for use in Mermaid diagrams.
 * Only escapes characters that break quoted strings in Mermaid.
 *
 * With bracket-quote syntax (e.g., `nodeId["label"]`), special characters
 * like {}[]() are allowed inside the quoted label.
 *
 * @param text - Text to escape
 * @returns Escaped text safe for Mermaid quoted labels
 */
function escapeMermaidText(text: string): string {
  return text
    .replace(/"/g, "#quot;")  // Escape double quotes for Mermaid
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim();
}

/**
 * Escape text for use in Mermaid subgraph names.
 * Subgraph names need special handling - brackets and braces must be removed.
 *
 * @param text - Text to escape for subgraph name
 * @returns Escaped text safe for subgraph names
 */
function escapeSubgraphName(text: string): string {
  return escapeMermaidText(text)
    .replace(/[{}[\]()]/g, ""); // Remove brackets, braces, and parentheses from subgraph names
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

      // End node (if workflow reached a terminal state) - more visually distinctive
      const terminalStates = ["success", "error", "aborted"] as const;
      if (terminalStates.includes(ir.root.state as (typeof terminalStates)[number])) {
        const endId = "finish";
        const endIcon =
          ir.root.state === "success" ? "✓"
            : ir.root.state === "error" ? "✗"
              : "⊘";
        const endLabel =
          ir.root.state === "success" ? "Done"
            : ir.root.state === "error" ? "Failed"
              : "Cancelled";
        const endShape = `(("${endIcon} ${endLabel}"))`;
        const endClass =
          ir.root.state === "success" ? ":::success"
            : ir.root.state === "error" ? ":::error"
              : ":::aborted";
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
  } else if (isStreamNode(node)) {
    return renderStreamNode(node, options, lines);
  }

  // Fallback for sequence or unknown nodes
  const id = generateNodeId("unknown");
  lines.push(`    ${id}["Unknown Node"]`);
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

  // Generate step ID, ensuring uniqueness even with duplicate keys
  let id = node.key
    ? `step_${node.key.replace(/[^a-zA-Z0-9]/g, "_")}`
    : generateNodeId("step");

  // Ensure uniqueness by appending suffix if collision
  if (usedStepIds.has(id)) {
    let suffix = 2;
    while (usedStepIds.has(`${id}_${suffix}`)) {
      suffix++;
    }
    id = `${id}_${suffix}`;
  }
  usedStepIds.add(id);

  const baseLabel = node.name ?? node.key ?? "Step";
  const labelText = options.showKeys && node.key && node.name
    ? `${baseLabel} [${node.key}]`
    : baseLabel;
  const label = escapeMermaidText(labelText);

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
      : escapeMermaidText(getStringified(node.input).slice(0, 20));
    ioInfo += `\\nin: ${inputStr}`;
  }
  if (node.output !== undefined && node.state === "success") {
    const outputStr = typeof node.output === "string"
      ? escapeMermaidText(node.output)
      : escapeMermaidText(getStringified(node.output).slice(0, 20));
    ioInfo += `\\nout: ${outputStr}`;
  }

  // Add onAfterStep hook info if present (check by key first, then by id)
  let hookInfo = "";
  const hookKey = node.key ?? node.id;
  if (hooks && hookKey && hooks.onAfterStep.has(hookKey)) {
    const hookExec = hooks.onAfterStep.get(hookKey)!;
    const hookIcon = hookExec.state === "success" ? "⚙" : "⚠";
    const hookTiming = options.showTimings && hookExec.durationMs !== undefined
      ? ` ${formatDuration(hookExec.durationMs)}`
      : "";
    hookInfo = `\\n${hookIcon} hook${hookTiming}`;
  }

  // Combine all label parts with icon (retry/timeout info moved to edges)
  const escapedLabel = (stateIcon + label + ioInfo + hookInfo + timing).trim();

  // Determine class: use heatmap if enabled and data available, otherwise use state
  // Lookup order matches PerformanceAnalyzer: key ?? name ?? id
  let nodeClass: string;
  const heat = enhanced?.showHeatmap && enhanced.heatmapData
    ? enhanced.heatmapData.heat.get(node.key ?? "") ??
      enhanced.heatmapData.heat.get(node.name ?? "") ??
      enhanced.heatmapData.heat.get(node.id)
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
      shape = `{{"${escapedLabel}"}}`;
      break;
    case "cached":
      // Rounded rectangle with double border for cached
      shape = `[("${escapedLabel}")]`;
      break;
    case "skipped":
      // Dashed border via class (applied once in lines.push below)
      shape = `["${escapedLabel}"]`;
      break;
    default:
      // Standard rectangle for normal steps
      shape = `["${escapedLabel}"]`;
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
    lines.push(`    ${errorNodeId}{{"${errorLabel}"}}`);
    lines.push(`    ${id} -->|error| ${errorNodeId}`);
    lines.push(`    style ${errorNodeId} fill:#fee2e2,stroke:#dc2626`);
  }

  // NEW: Add timeout edge (alternative timeout path)
  if (showTimeoutEdges && node.timedOut) {
    const timeoutNodeId = `TO_${id}`;
    const timeoutMs = node.timeoutMs !== undefined ? `${node.timeoutMs}ms` : "";
    lines.push(`    ${timeoutNodeId}{{"⏱ Timeout ${timeoutMs}"}}`);
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
    lines.push(`    ${id}["${label}${timing}\\n${note}"]:::${getStateClass(node.state)}`);
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

    lines.push(`    ${id}["⚡ ${label}${timing}\\n${note}"]:::${getStateClass(node.state)}`);
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
    const isWinner = node.winnerId === child.id;
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
  // Generate decision ID, ensuring uniqueness even with duplicate keys
  let decisionId = node.key
    ? `decision_${node.key.replace(/[^a-zA-Z0-9]/g, "_")}`
    : generateNodeId("decision");

  // Ensure uniqueness by appending suffix if collision
  if (usedDecisionIds.has(decisionId)) {
    let suffix = 2;
    while (usedDecisionIds.has(`${decisionId}_${suffix}`)) {
      suffix++;
    }
    decisionId = `${decisionId}_${suffix}`;
  }
  usedDecisionIds.add(decisionId);

  // Escape condition and decision value - remove characters that break Mermaid
  const condition = escapeMermaidText(node.condition ?? "condition");
  const decisionValue = node.decisionValue !== undefined
    ? ` = ${escapeMermaidText(String(node.decisionValue)).slice(0, 30)}`
    : "";

  // Decision diamond - ensure no invalid characters
  const decisionLabel = `${condition}${decisionValue}`.trim();
  lines.push(`    ${decisionId}{"${decisionLabel}"}`);

  // Render branches
  const branchExitIds: string[] = [];
  let takenBranchExitId: string | undefined;
  const usedBranchIds = new Set<string>();

  for (const branch of node.branches) {
    // Generate base branch ID from sanitized label
    let branchId = `${decisionId}_${branch.label.replace(/[^a-zA-Z0-9]/g, "_")}`;
    // Ensure uniqueness by appending index if collision
    if (usedBranchIds.has(branchId)) {
      let suffix = 2;
      while (usedBranchIds.has(`${branchId}_${suffix}`)) {
        suffix++;
      }
      branchId = `${branchId}_${suffix}`;
    }
    usedBranchIds.add(branchId);
    // Escape branch label - remove parentheses and other special chars
    const branchLabelText = escapeMermaidText(branch.label);
    const branchLabel = branch.taken
      ? `${branchLabelText} ✓`
      : `${branchLabelText} skipped`;
    const branchClass = branch.taken ? ":::success" : ":::skipped";

    // Branch label node
    lines.push(`    ${branchId}["${branchLabel}"]${branchClass}`);

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

/**
 * Render a stream node.
 * Uses hexagonal shape to distinguish from regular steps.
 */
function renderStreamNode(
  node: StreamNode,
  options: RenderOptions,
  lines: string[]
): RenderResult {
  const id = `stream_${node.namespace.replace(/[^a-zA-Z0-9]/g, "_")}_${generateNodeId("")}`;

  // Format counts
  const counts = `W:${node.writeCount} R:${node.readCount}`;

  // Add state icon
  let stateIcon = "";
  switch (node.streamState) {
    case "active":
      stateIcon = "⟳ ";
      break;
    case "closed":
      stateIcon = "✓ ";
      break;
    case "error":
      stateIcon = "✗ ";
      break;
  }

  // Format timing
  const timing =
    options.showTimings && node.durationMs !== undefined
      ? ` ${formatDuration(node.durationMs)}`
      : "";

  // Backpressure indicator
  const backpressure = node.backpressureOccurred ? "\\nbackpressure" : "";

  // Combine label parts - use hexagon shape for streams
  const label = `${stateIcon}stream:${escapeMermaidText(node.namespace)}\\n${counts}${backpressure}${timing}`;

  // Determine class based on stream state
  let nodeClass: string;
  if (node.streamState === "error") {
    nodeClass = "streamError";
  } else if (node.streamState === "active") {
    nodeClass = "streamActive";
  } else {
    nodeClass = "stream";
  }

  // Hexagonal shape for streams: {{"label"}}
  lines.push(`    ${id}{{"${label}"}}:::${nodeClass}`);

  return { entryId: id, exitId: id };
}

export { mermaidRenderer as default };
