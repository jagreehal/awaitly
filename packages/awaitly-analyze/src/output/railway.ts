/**
 * Railway Diagram Generator
 *
 * Generates clean, minimal Mermaid flowcharts in the "railway" style:
 * linear happy path with ok/err branching per step.
 *
 * Example output:
 *   flowchart LR
 *     V[Validate] -->|ok| F[Fetch Rate]
 *     F -->|ok| C[Convert]
 *     C -->|ok| Done((Success))
 *     V -->|err| VE[ValidationError]
 *     F -->|err| FE[RateUnavailableError]
 *     C -->|err| CE[InsufficientFundsError]
 */

import {
  extractFunctionName,
  getStaticChildren,
  type StaticWorkflowIR,
  type StaticFlowNode,
  type StaticStepNode,
  type StaticSagaStepNode,
} from "../types";

// =============================================================================
// Options
// =============================================================================

export interface RailwayOptions {
  /** Diagram direction. Default: "LR" */
  direction?: "LR" | "TD";
  /** Which text to use as the step node label. Default: "callee" */
  stepLabel?: "callee" | "stepId" | "description";
  /** Annotate retry info on step labels. Default: false */
  showRetry?: boolean;
  /** Annotate timeout info on step labels. Default: false */
  showTimeout?: boolean;
  /** Show step cache keys in labels. Default: false */
  showKeys?: boolean;
  /** Use the IR node IDs instead of short generated IDs. Needed for HTML interactivity. Default: false */
  useNodeIds?: boolean;
  /** Custom styles for node types */
  styles?: RailwayStyles;
}

export interface RailwayStyles {
  step?: string;
  error?: string;
  success?: string;
}

// =============================================================================
// Main Generator
// =============================================================================

/**
 * Render a workflow as a railway-style Mermaid diagram.
 *
 * Flattens the workflow to a linear step sequence, connects steps with
 * `-->|ok|` edges, and branches each step's declared errors with `-->|err|`.
 */
export function renderRailwayMermaid(
  ir: StaticWorkflowIR,
  options?: RailwayOptions,
): string {
  const direction = options?.direction ?? "LR";
  const stepLabelMode = options?.stepLabel ?? "callee";
  const showRetry = options?.showRetry ?? false;
  const showTimeout = options?.showTimeout ?? false;
  const showKeys = options?.showKeys ?? false;
  const useNodeIds = options?.useNodeIds ?? false;
  const styles = options?.styles;

  const steps = collectLinearSteps(ir.root.children);

  if (steps.length === 0) {
    return `flowchart ${direction}\n  Done((Success))`;
  }

  const usedIds = new Map<string, number>();
  let mermaidCounter = 0;
  const stepEntries = steps.map((node) => {
    const label = getStepLabel(node, stepLabelMode, showRetry, showTimeout, showKeys);
    let nodeId: string;
    if (useNodeIds) {
      // Match the ID scheme used by extractNodeMetadata / renderStaticMermaid
      mermaidCounter++;
      const prefix = node.type === "saga-step" ? "saga_step" : "step";
      nodeId = `${prefix}_${mermaidCounter}`;
    } else {
      nodeId = generateShortId(label, usedIds);
    }
    const errors = getStepErrors(node);
    return { node, label, shortId: nodeId, errors };
  });

  const lines: string[] = [];

  // Header
  lines.push(`flowchart ${direction}`);

  // Happy path edges
  for (let i = 0; i < stepEntries.length; i++) {
    const current = stepEntries[i];
    const next = stepEntries[i + 1];
    if (next) {
      lines.push(
        `  ${current.shortId}["${escapeLabel(current.label)}"] -->|ok| ${next.shortId}["${escapeLabel(next.label)}"]`,
      );
    } else {
      // Last step connects to Done
      lines.push(
        `  ${current.shortId}["${escapeLabel(current.label)}"] -->|ok| Done((Success))`,
      );
    }
  }

  // Error branches
  for (const entry of stepEntries) {
    if (entry.errors.length === 0) continue;
    const errLabel = entry.errors.join(" / ");
    const errId = `${entry.shortId}E`;
    lines.push(
      `  ${entry.shortId} -->|err| ${errId}["${escapeLabel(errLabel)}"]`,
    );
  }

  // Styles
  const stepStyle = styles?.step ?? "fill:#e1f5fe,stroke:#01579b";
  const errorStyle = styles?.error ?? "fill:#ffcdd2,stroke:#c62828";
  const successStyle = styles?.success ?? "fill:#c8e6c9,stroke:#2e7d32";

  lines.push("");
  lines.push(`  classDef stepStyle ${stepStyle}`);
  lines.push(`  classDef errorStyle ${errorStyle}`);
  lines.push(`  classDef successStyle ${successStyle}`);

  // Apply classes
  const stepIds = stepEntries.map((e) => e.shortId).join(",");
  lines.push(`  class ${stepIds} stepStyle`);

  const errorIds = stepEntries
    .filter((e) => e.errors.length > 0)
    .map((e) => `${e.shortId}E`);
  if (errorIds.length > 0) {
    lines.push(`  class ${errorIds.join(",")} errorStyle`);
  }
  lines.push(`  class Done successStyle`);

  return lines.join("\n");
}

// =============================================================================
// Helpers
// =============================================================================

type StepLike = StaticStepNode | StaticSagaStepNode;

/**
 * Recursively collect step and saga-step nodes in document order.
 */
function collectLinearSteps(nodes: StaticFlowNode[]): StepLike[] {
  const result: StepLike[] = [];

  for (const node of nodes) {
    if (node.type === "step" || node.type === "saga-step") {
      result.push(node as StepLike);
    }

    const children = getStaticChildren(node);
    if (children.length > 0) {
      result.push(...collectLinearSteps(children));
    }
  }

  return result;
}

/**
 * Determine the display label for a step.
 */
function getStepLabel(
  node: StepLike,
  mode: "callee" | "stepId" | "description",
  showRetry: boolean,
  showTimeout: boolean,
  showKeys: boolean,
): string {
  let label: string;

  switch (mode) {
    case "stepId":
      label =
        node.type === "step"
          ? node.stepId ?? node.name ?? node.id
          : node.name ?? node.id;
      break;
    case "description":
      label =
        node.description ??
        (node.callee ? extractFunctionName(node.callee) : null) ??
        node.name ??
        node.id;
      break;
    case "callee":
    default:
      label =
        (node.callee ? extractFunctionName(node.callee) : null) ??
        node.name ??
        node.id;
      break;
  }

  // Append cache key if requested
  if (showKeys && node.key) {
    label += ` [${node.key}]`;
  }

  // Annotate retry/timeout if requested
  if (node.type === "step") {
    const step = node as StaticStepNode;
    const annotations: string[] = [];
    if (showRetry && step.retry) {
      annotations.push(`retry:${step.retry.attempts}`);
    }
    if (showTimeout && step.timeout) {
      annotations.push(`timeout:${step.timeout.ms}ms`);
    }
    if (annotations.length > 0) {
      label += ` (${annotations.join(", ")})`;
    }
  }

  return label;
}

/**
 * Get declared errors for a step node.
 */
function getStepErrors(node: StepLike): string[] {
  if (node.type === "step") {
    return (node as StaticStepNode).errors ?? [];
  }
  return [];
}

/**
 * Generate a short Mermaid node ID from a label.
 * Takes the first letter of each word (e.g., "Fetch Rate" → "FR").
 * Handles collisions by appending incrementing numbers.
 */
function generateShortId(
  label: string,
  usedIds: Map<string, number>,
): string {
  // Split on spaces, hyphens, underscores, camelCase boundaries
  const words = label
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s\-_]+/)
    .filter(Boolean);

  let base: string;
  if (words.length >= 2) {
    // Take first letter of each word
    base = words.map((w) => w[0].toUpperCase()).join("");
  } else if (words.length === 1) {
    // Single word: take first letter uppercased
    base = words[0][0].toUpperCase();
  } else {
    base = "N";
  }

  const count = usedIds.get(base) ?? 0;
  usedIds.set(base, count + 1);

  if (count === 0) {
    return base;
  }
  return `${base}${count + 1}`;
}

/**
 * Escape a label for safe use in Mermaid node labels.
 */
function escapeLabel(label: string): string {
  return label
    .replace(/\\n/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/"/g, "'")
    .replace(/\[/g, "(")
    .replace(/]/g, ")");
}
