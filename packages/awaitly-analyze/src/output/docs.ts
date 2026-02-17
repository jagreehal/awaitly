/**
 * Markdown Documentation Generator
 *
 * Generates documentation from workflow analysis.
 */

import type {
  StaticWorkflowIR,
  StaticFlowNode,
  StaticStepNode,
  StaticLoopNode,
} from "../types";
import { getStaticChildren } from "../types";
import { buildDataFlowGraph } from "../data-flow";
import { analyzeErrorFlow } from "../error-flow";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for markdown generation.
 */
export interface DocsOptions {
  /** Include data flow section */
  includeDataFlow?: boolean;
  /** Include error flow section */
  includeErrorFlow?: boolean;
  /** Include step details table */
  includeStepDetails?: boolean;
  /** Include Mermaid diagram */
  includeMermaid?: boolean;
  /** Title override */
  title?: string;
}

const DEFAULT_OPTIONS: Required<DocsOptions> = {
  includeDataFlow: true,
  includeErrorFlow: true,
  includeStepDetails: true,
  includeMermaid: true,
  title: "",
};

// =============================================================================
// Main Generator
// =============================================================================

/**
 * Generate markdown documentation from workflow IR.
 */
export function generateDocs(
  ir: StaticWorkflowIR,
  options: DocsOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = [];

  const title = opts.title || ir.root.workflowName;

  // Title
  lines.push(`# ${title}`);
  lines.push("");

  // Description (if available)
  if (ir.root.description) {
    lines.push(ir.root.description);
    lines.push("");
  }
  if (ir.root.jsdocDescription) {
    lines.push(ir.root.jsdocDescription);
    lines.push("");
  }

  // Overview section
  lines.push("## Overview");
  lines.push("");
  const steps = collectSteps(ir.root.children);
  const loops = collectLoops(ir.root.children);
  lines.push(`- **Steps:** ${steps.length}`);
  lines.push(`- **Loops:** ${loops.length}`);
  if (ir.root.dependencies.length > 0) {
    lines.push(`- **Dependencies:** ${ir.root.dependencies.map((d) => d.name).join(", ")}`);
  }
  lines.push("");

  // Step details
  if (opts.includeStepDetails && steps.length > 0) {
    lines.push("## Steps");
    lines.push("");
    lines.push("| Step | Description | Errors | Data |");
    lines.push("|------|-------------|--------|------|");

    for (const step of steps) {
      const name = step.name ?? step.stepId ?? step.id;
      const desc = step.description ?? step.jsdocDescription ?? "-";
      const errors = step.errors?.map((e) => `\`${e}\``).join(", ") || "-";
      const data = [];
      if (step.reads?.length) data.push(`reads: ${step.reads.join(", ")}`);
      if (step.out) data.push(`out: ${step.out}`);
      const dataStr = data.length > 0 ? data.join("; ") : "-";

      lines.push(`| ${name} | ${truncate(desc, 40)} | ${errors} | ${dataStr} |`);
    }
    lines.push("");
  }

  // Data flow
  if (opts.includeDataFlow) {
    const dataFlow = buildDataFlowGraph(ir);
    if (dataFlow.edges.length > 0) {
      lines.push("## Data Flow");
      lines.push("");
      lines.push("Data dependencies between steps:");
      lines.push("");
      for (const edge of dataFlow.edges) {
        lines.push(`- \`${edge.from}\` → \`${edge.to}\` (via \`${edge.key}\`)`);
      }
      lines.push("");

      if (dataFlow.undefinedReads.length > 0) {
        lines.push("### Warnings");
        lines.push("");
        for (const read of dataFlow.undefinedReads) {
          lines.push(`- ⚠️ Step \`${read.readerId}\` reads \`${read.key}\` which is never written`);
        }
        lines.push("");
      }
    }
  }

  // Error flow
  if (opts.includeErrorFlow) {
    const errorFlow = analyzeErrorFlow(ir);
    if (errorFlow.allErrors.length > 0) {
      lines.push("## Error Types");
      lines.push("");
      lines.push("Possible errors from this workflow:");
      lines.push("");
      for (const error of errorFlow.allErrors) {
        const producers = errorFlow.errorToSteps.get(error) ?? [];
        lines.push(`- \`${error}\` - from: ${producers.join(", ")}`);
      }
      lines.push("");

      if (errorFlow.stepsWithoutErrors.length > 0) {
        lines.push("### Steps Without Declared Errors");
        lines.push("");
        lines.push("These steps don't declare their errors (consider adding `errors: []` or `errors: ['TAG']`):");
        lines.push("");
        for (const stepId of errorFlow.stepsWithoutErrors) {
          lines.push(`- \`${stepId}\``);
        }
        lines.push("");
      }
    }
  }

  // Mermaid diagram
  if (opts.includeMermaid) {
    lines.push("## Flow Diagram");
    lines.push("");
    lines.push("```mermaid");
    lines.push(generateSimpleMermaid(ir));
    lines.push("```");
    lines.push("");
  }

  // Dependencies
  if (ir.root.dependencies.length > 0) {
    lines.push("## Dependencies");
    lines.push("");
    lines.push("| Name | Type |");
    lines.push("|------|------|");
    for (const dep of ir.root.dependencies) {
      const type = dep.typeSignature ?? "-";
      lines.push(`| ${dep.name} | \`${truncate(type, 60)}\` |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Collect all step nodes from the IR.
 */
function collectSteps(nodes: StaticFlowNode[]): StaticStepNode[] {
  const steps: StaticStepNode[] = [];

  function walk(node: StaticFlowNode): void {
    if (node.type === "step") {
      steps.push(node);
    }
    for (const child of getStaticChildren(node)) {
      walk(child);
    }
  }

  for (const node of nodes) {
    walk(node);
  }

  return steps;
}

/**
 * Collect all loop nodes from the IR.
 */
function collectLoops(nodes: StaticFlowNode[]): StaticLoopNode[] {
  const loops: StaticLoopNode[] = [];

  function walk(node: StaticFlowNode): void {
    if (node.type === "loop") {
      loops.push(node);
    }
    for (const child of getStaticChildren(node)) {
      walk(child);
    }
  }

  for (const node of nodes) {
    walk(node);
  }

  return loops;
}

/**
 * Truncate a string to max length.
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/**
 * Generate a simple Mermaid flowchart.
 */
function generateSimpleMermaid(ir: StaticWorkflowIR): string {
  const lines: string[] = [];
  lines.push("flowchart TD");

  const steps = collectSteps(ir.root.children);

  if (steps.length === 0) {
    lines.push("  start((Start)) --> end_node((End))");
    return lines.join("\n");
  }

  lines.push("  start((Start))");

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const id = `step_${i}`;
    const name = step.name ?? step.stepId ?? `Step ${i + 1}`;
    lines.push(`  ${id}["${escapeQuotes(name)}"]`);
  }

  lines.push("  end_node((End))");
  lines.push("");

  // Edges
  lines.push(`  start --> step_0`);
  for (let i = 0; i < steps.length - 1; i++) {
    lines.push(`  step_${i} --> step_${i + 1}`);
  }
  lines.push(`  step_${steps.length - 1} --> end_node`);

  return lines.join("\n");
}

/**
 * Escape quotes for Mermaid labels.
 */
function escapeQuotes(str: string): string {
  return str.replace(/"/g, "'");
}
