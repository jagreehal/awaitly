/**
 * ASCII Terminal Renderer
 *
 * Renders the workflow IR as ASCII art with box-drawing characters
 * and ANSI colors for terminal display.
 */

import type {
  FlowNode,
  ParallelNode,
  RaceNode,
  DecisionNode,
  Renderer,
  RenderOptions,
  StepNode,
  WorkflowIR,
  EnhancedRenderOptions,
  HeatLevel,
  WorkflowHooks,
  HookExecution,
} from "../types";
import { isParallelNode, isRaceNode, isStepNode, isDecisionNode } from "../types";
import { formatDuration } from "../utils/timing";
import {
  bold,
  colorByState,
  colorize,
  defaultColorScheme,
  dim,
  getColoredSymbol,
  stripAnsi,
} from "./colors";

// =============================================================================
// Box Drawing Characters
// =============================================================================

const BOX = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  teeRight: "├",
  teeLeft: "┤",
  teeDown: "┬",
  teeUp: "┴",
  cross: "┼",
} as const;

// =============================================================================
// Heatmap Colors (ANSI)
// =============================================================================

/**
 * ANSI color codes for heatmap visualization.
 */
const HEAT_COLORS: Record<HeatLevel, string> = {
  cold: "\x1b[34m",      // Blue
  cool: "\x1b[36m",      // Cyan
  neutral: "",           // Default (no color)
  warm: "\x1b[33m",      // Yellow
  hot: "\x1b[31m",       // Red
  critical: "\x1b[41m",  // Red background
};

const RESET = "\x1b[0m";

/**
 * Get ANSI color code for a heat level.
 */
function getHeatColor(heat: number): string {
  if (heat < 0.2) return HEAT_COLORS.cold;
  if (heat < 0.4) return HEAT_COLORS.cool;
  if (heat < 0.6) return HEAT_COLORS.neutral;
  if (heat < 0.8) return HEAT_COLORS.warm;
  if (heat < 0.95) return HEAT_COLORS.hot;
  return HEAT_COLORS.critical;
}

/**
 * Apply heat coloring to a string.
 */
function applyHeatColor(text: string, heat: number): string {
  const color = getHeatColor(heat);
  if (!color) return text;
  return `${color}${text}${RESET}`;
}

// =============================================================================
// Sparkline Characters
// =============================================================================

const SPARK_CHARS = "▁▂▃▄▅▆▇█";

/**
 * Render a sparkline from an array of values.
 *
 * @param values Array of numeric values
 * @param width Maximum characters to use (default: 10)
 * @returns Sparkline string
 */
export function renderSparkline(values: number[], width = 10): string {
  if (values.length === 0) return "";

  // Take last N values
  const subset = values.slice(-width);
  const min = Math.min(...subset);
  const max = Math.max(...subset);
  const range = max - min || 1;

  return subset
    .map((v) => {
      const normalized = (v - min) / range;
      const index = Math.floor(normalized * (SPARK_CHARS.length - 1));
      return SPARK_CHARS[index];
    })
    .join("");
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Pad a string to a fixed width, accounting for ANSI codes.
 */
function padEnd(str: string, width: number): string {
  const visibleLen = stripAnsi(str).length;
  const padding = Math.max(0, width - visibleLen);
  return str + " ".repeat(padding);
}

/**
 * Create a horizontal line with optional title.
 */
function horizontalLine(width: number, title?: string): string {
  if (!title) {
    return BOX.horizontal.repeat(width);
  }

  const titleText = ` ${title} `;
  const remainingWidth = width - titleText.length;
  if (remainingWidth < 4) {
    return BOX.horizontal.repeat(width);
  }

  const leftPad = 2;
  const rightPad = remainingWidth - leftPad;

  return (
    BOX.horizontal.repeat(leftPad) + titleText + BOX.horizontal.repeat(rightPad)
  );
}

// =============================================================================
// Hook Rendering
// =============================================================================

/**
 * Render a single hook execution.
 */
function renderHookExecution(
  hook: HookExecution,
  label: string,
  colors: ReturnType<typeof Object.assign>
): string {
  const symbol = hook.state === "success"
    ? colorize("⚙", colors.success)
    : colorize("⚠", colors.error);

  const timing = hook.durationMs !== undefined
    ? dim(` [${formatDuration(hook.durationMs)}]`)
    : "";

  let context = "";
  if (hook.type === "shouldRun" && hook.context?.skipped) {
    context = dim(" → workflow skipped");
  } else if (hook.type === "shouldRun" && hook.context?.result === true) {
    context = dim(" → proceed");
  } else if (hook.type === "onBeforeStart" && hook.context?.skipped) {
    context = dim(" → workflow skipped");
  } else if (hook.type === "onAfterStep" && hook.context?.stepKey) {
    context = dim(` (${hook.context.stepKey})`);
  }

  const error = hook.state === "error" && hook.error
    ? dim(` error: ${String(hook.error)}`)
    : "";

  return `${symbol} ${dim(label)}${context}${timing}${error}`;
}

/**
 * Render workflow hooks section.
 */
function renderHooks(
  hooks: WorkflowHooks,
  colors: ReturnType<typeof Object.assign>
): string[] {
  const lines: string[] = [];

  // Render shouldRun hook
  if (hooks.shouldRun) {
    lines.push(renderHookExecution(hooks.shouldRun, "shouldRun", colors));
  }

  // Render onBeforeStart hook
  if (hooks.onBeforeStart) {
    lines.push(renderHookExecution(hooks.onBeforeStart, "onBeforeStart", colors));
  }

  // We don't render onAfterStep hooks here - they're shown inline with steps
  // But if there are any, add a separator
  if (lines.length > 0) {
    lines.push(dim("────────────────────")); // Separator between hooks and steps
  }

  return lines;
}

// =============================================================================
// ASCII Renderer
// =============================================================================

/**
 * Create the ASCII terminal renderer.
 */
export function asciiRenderer(): Renderer {
  return {
    name: "ascii",
    supportsLive: true,

    render(ir: WorkflowIR, options: RenderOptions): string {
      const colors = { ...defaultColorScheme, ...options.colors };
      const width = options.terminalWidth ?? 60;
      const innerWidth = width - 4; // Account for borders

      const lines: string[] = [];

      // Header
      const workflowName = ir.root.name ?? "workflow";
      const headerTitle = bold(workflowName);
      lines.push(
        `${BOX.topLeft}${horizontalLine(width - 2, headerTitle)}${BOX.topRight}`
      );
      lines.push(`${BOX.vertical}${" ".repeat(width - 2)}${BOX.vertical}`);

      // Render hooks (if any)
      if (ir.hooks) {
        const hookLines = renderHooks(ir.hooks, colors);
        for (const line of hookLines) {
          lines.push(
            `${BOX.vertical}  ${padEnd(line, innerWidth)}${BOX.vertical}`
          );
        }
      }

      // Render children
      const childLines = renderNodes(ir.root.children, options, colors, 0, ir.hooks);
      for (const line of childLines) {
        lines.push(
          `${BOX.vertical}  ${padEnd(line, innerWidth)}${BOX.vertical}`
        );
      }

      // Footer with timing
      lines.push(`${BOX.vertical}${" ".repeat(width - 2)}${BOX.vertical}`);

      if (ir.root.durationMs !== undefined && options.showTimings) {
        const status = ir.root.state === "success" ? "Completed" : "Failed";
        const statusColored = colorByState(status, ir.root.state, colors);
        const footer = `${statusColored} in ${formatDuration(ir.root.durationMs)}`;
        lines.push(
          `${BOX.vertical}  ${padEnd(footer, innerWidth)}${BOX.vertical}`
        );
        lines.push(`${BOX.vertical}${" ".repeat(width - 2)}${BOX.vertical}`);
      }

      lines.push(
        `${BOX.bottomLeft}${BOX.horizontal.repeat(width - 2)}${BOX.bottomRight}`
      );

      return lines.join("\n");
    },
  };
}

/**
 * Render a list of nodes.
 */
function renderNodes(
  nodes: FlowNode[],
  options: RenderOptions,
  colors: ReturnType<typeof Object.assign>,
  depth: number,
  hooks?: WorkflowHooks
): string[] {
  const lines: string[] = [];

  for (const node of nodes) {
    if (isStepNode(node)) {
      lines.push(renderStepNode(node, options, colors, hooks));
    } else if (isParallelNode(node)) {
      lines.push(...renderParallelNode(node, options, colors, depth, hooks));
    } else if (isRaceNode(node)) {
      lines.push(...renderRaceNode(node, options, colors, depth, hooks));
    } else if (isDecisionNode(node)) {
      lines.push(...renderDecisionNode(node, options, colors, depth, hooks));
    }
  }

  return lines;
}

/**
 * Render a single step node.
 */
function renderStepNode(
  node: StepNode,
  options: RenderOptions,
  colors: ReturnType<typeof Object.assign>,
  hooks?: WorkflowHooks
): string {
  const symbol = getColoredSymbol(node.state, colors);
  const name = node.name ?? node.key ?? "step";

  // Check for enhanced options
  const enhanced = options as EnhancedRenderOptions;
  const nodeId = node.name ?? node.id;

  // Get heat value for this node (if heatmap is enabled)
  const heat = enhanced.showHeatmap && enhanced.heatmapData
    ? enhanced.heatmapData.heat.get(node.id) ?? enhanced.heatmapData.heat.get(nodeId)
    : undefined;

  // Apply heat coloring or default state coloring
  let nameColored: string;
  if (heat !== undefined) {
    nameColored = applyHeatColor(name, heat);
  } else {
    nameColored = colorByState(name, node.state, colors);
  }

  let line = `${symbol} ${nameColored}`;

  // Add key if requested
  if (options.showKeys && node.key) {
    line += dim(` [key: ${node.key}]`);
  }

  // Add input/output if available (for decision understanding)
  if (node.input !== undefined) {
    const inputStr = typeof node.input === "string"
      ? node.input
      : JSON.stringify(node.input).slice(0, 30);
    line += dim(` [in: ${inputStr}${inputStr.length >= 30 ? "..." : ""}]`);
  }
  if (node.output !== undefined && node.state === "success") {
    const outputStr = typeof node.output === "string"
      ? node.output
      : JSON.stringify(node.output).slice(0, 30);
    line += dim(` [out: ${outputStr}${outputStr.length >= 30 ? "..." : ""}]`);
  }

  // Add timing if available and requested
  if (options.showTimings && node.durationMs !== undefined) {
    // Apply heat coloring to timing if enabled
    const timingStr = formatDuration(node.durationMs);
    const timingDisplay = heat !== undefined
      ? applyHeatColor(`[${timingStr}]`, heat)
      : dim(`[${timingStr}]`);
    line += ` ${timingDisplay}`;
  }

  // Add sparkline if enabled and history available
  if (enhanced.showSparklines && enhanced.timingHistory) {
    const history = enhanced.timingHistory.get(nodeId);
    if (history && history.length > 1) {
      line += ` ${dim(renderSparkline(history))}`;
    }
  }

  // Add retry indicator if retries occurred
  if (node.retryCount !== undefined && node.retryCount > 0) {
    line += dim(` [${node.retryCount} ${node.retryCount === 1 ? "retry" : "retries"}]`);
  }

  // Add timeout indicator if step timed out
  if (node.timedOut) {
    const timeoutInfo = node.timeoutMs !== undefined ? ` ${node.timeoutMs}ms` : "";
    line += dim(` [timeout${timeoutInfo}]`);
  }

  // Add onAfterStep hook indicator if present
  if (hooks && node.key && hooks.onAfterStep.has(node.key)) {
    const hookExec = hooks.onAfterStep.get(node.key)!;
    const hookSymbol = hookExec.state === "success"
      ? colorize("⚙", colors.success)
      : colorize("⚠", colors.error);
    const hookTiming = hookExec.durationMs !== undefined
      ? dim(` ${formatDuration(hookExec.durationMs)}`)
      : "";
    line += ` ${hookSymbol}${hookTiming}`;
  }

  return line;
}

/**
 * Render a parallel node (allAsync).
 */
function renderParallelNode(
  node: ParallelNode,
  options: RenderOptions,
  colors: ReturnType<typeof Object.assign>,
  depth: number,
  hooks?: WorkflowHooks
): string[] {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);

  // Header
  const symbol = getColoredSymbol(node.state, colors);
  const name = node.name ?? "parallel";
  const mode = node.mode === "allSettled" ? " (allSettled)" : "";
  lines.push(`${indent}${BOX.teeRight}${BOX.teeDown}${BOX.horizontal} ${symbol} ${bold(name)}${mode}`);

  // Children
  if (node.children.length === 0) {
    // Empty parallel scope - operations inside allAsync/anyAsync weren't tracked as steps
    lines.push(`${indent}${BOX.vertical} ${dim("(operations not individually tracked)")}`);
    lines.push(`${indent}${BOX.vertical} ${dim("(wrap each operation with step() to see individual steps)")}`);
  } else {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const isLast = i === node.children.length - 1;
      const prefix = isLast ? `${indent}${BOX.vertical} ${BOX.bottomLeft}` : `${indent}${BOX.vertical} ${BOX.teeRight}`;

      if (isStepNode(child)) {
        lines.push(`${prefix} ${renderStepNode(child, options, colors, hooks)}`);
      } else {
        // Nested structure - recurse
        const nestedLines = renderNodes([child], options, colors, depth + 1, hooks);
        for (const line of nestedLines) {
          lines.push(`${indent}${BOX.vertical}   ${line}`);
        }
      }
    }
  }

  // Timing footer
  if (options.showTimings && node.durationMs !== undefined) {
    lines.push(`${indent}${BOX.bottomLeft}${BOX.horizontal}${BOX.horizontal} ${dim(`[${formatDuration(node.durationMs)}]`)}`);
  }

  return lines;
}

/**
 * Render a race node (anyAsync).
 */
function renderRaceNode(
  node: RaceNode,
  options: RenderOptions,
  colors: ReturnType<typeof Object.assign>,
  depth: number,
  hooks?: WorkflowHooks
): string[] {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);

  // Header with lightning bolt for race
  const symbol = getColoredSymbol(node.state, colors);
  const name = node.name ?? "race";
  lines.push(`${indent}${BOX.teeRight}⚡ ${symbol} ${bold(name)}`);

  // Children
  if (node.children.length === 0) {
    // Empty race scope - operations inside anyAsync weren't tracked as steps
    lines.push(`${indent}${BOX.vertical} ${dim("(operations not individually tracked)")}`);
    lines.push(`${indent}${BOX.vertical} ${dim("(wrap each operation with step() to see individual steps)")}`);
  } else {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const isLast = i === node.children.length - 1;
      const prefix = isLast ? `${indent}${BOX.vertical} ${BOX.bottomLeft}` : `${indent}${BOX.vertical} ${BOX.teeRight}`;

      // Mark winner
      const isWinner = node.winnerId && child.id === node.winnerId;
      const winnerSuffix = isWinner ? dim(" (winner)") : "";

      if (isStepNode(child)) {
        lines.push(`${prefix} ${renderStepNode(child, options, colors, hooks)}${winnerSuffix}`);
      } else {
        const nestedLines = renderNodes([child], options, colors, depth + 1, hooks);
        for (const line of nestedLines) {
          lines.push(`${indent}${BOX.vertical}   ${line}`);
        }
      }
    }
  }

  // Timing footer
  if (options.showTimings && node.durationMs !== undefined) {
    lines.push(`${indent}${BOX.bottomLeft}${BOX.horizontal}${BOX.horizontal} ${dim(`[${formatDuration(node.durationMs)}]`)}`);
  }

  return lines;
}

/**
 * Render a decision node (conditional branch).
 */
function renderDecisionNode(
  node: DecisionNode,
  options: RenderOptions,
  colors: ReturnType<typeof Object.assign>,
  depth: number,
  hooks?: WorkflowHooks
): string[] {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);

  // Header with decision info
  const symbol = getColoredSymbol(node.state, colors);
  const name = node.name ?? "decision";
  const condition = node.condition
    ? dim(` (${node.condition})`)
    : "";
  const decisionValue = node.decisionValue !== undefined
    ? dim(` = ${String(node.decisionValue)}`)
    : "";
  const branchTaken = node.branchTaken !== undefined
    ? dim(` → ${String(node.branchTaken)}`)
    : "";

  lines.push(
    `${indent}${BOX.teeRight}${BOX.teeDown}${BOX.horizontal} ${symbol} ${bold(name)}${condition}${decisionValue}${branchTaken}`
  );

  // Render branches
  for (let i = 0; i < node.branches.length; i++) {
    const branch = node.branches[i];
    const isLast = i === node.branches.length - 1;
    const prefix = isLast
      ? `${indent}${BOX.vertical} ${BOX.bottomLeft}`
      : `${indent}${BOX.vertical} ${BOX.teeRight}`;

    // Branch label with taken/skipped indicator
    const branchSymbol = branch.taken ? "✓" : "⊘";
    const branchColor = branch.taken ? colors.success : colors.skipped;
    const branchLabel = colorize(
      `${branchSymbol} ${branch.label}`,
      branchColor
    );
    const branchCondition = branch.condition
      ? dim(` (${branch.condition})`)
      : "";

    lines.push(`${prefix} ${branchLabel}${branchCondition}`);

    // Render children of this branch
    if (branch.children.length > 0) {
      const childLines = renderNodes(branch.children, options, colors, depth + 1, hooks);
      for (const line of childLines) {
        lines.push(`${indent}${BOX.vertical}   ${line}`);
      }
    } else if (!branch.taken) {
      // Show that this branch was skipped
      lines.push(
        `${indent}${BOX.vertical}   ${dim("(skipped)")}`
      );
    }
  }

  // Timing footer
  if (options.showTimings && node.durationMs !== undefined) {
    lines.push(
      `${indent}${BOX.bottomLeft}${BOX.horizontal}${BOX.horizontal} ${dim(`[${formatDuration(node.durationMs)}]`)}`
    );
  }

  return lines;
}

export { defaultColorScheme };
