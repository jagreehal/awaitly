/**
 * Error Flow Analysis
 *
 * Analyzes error propagation in workflows by aggregating declared errors
 * from all steps, branches, and nested structures.
 */

import type {
  StaticWorkflowIR,
  StaticFlowNode,
  StaticStepNode,
} from "./types";
import { getStaticChildren } from "./types";

// =============================================================================
// Types
// =============================================================================

/**
 * Error information for a specific step.
 */
export interface StepErrorInfo {
  /** Step ID (stepId or generated id) */
  stepId: string;
  /** Step name for display */
  stepName?: string;
  /** Declared error tags */
  errors: string[];
  /** Source location */
  location?: {
    line: number;
    column: number;
  };
}

/**
 * Aggregated error analysis for a workflow.
 */
export interface ErrorFlowAnalysis {
  /** All unique error tags in the workflow */
  allErrors: string[];
  /** Steps with their declared errors */
  stepErrors: StepErrorInfo[];
  /** Map of error tag to steps that can produce it */
  errorToSteps: Map<string, string[]>;
  /** Steps that don't declare any errors */
  stepsWithoutErrors: string[];
  /** Whether all steps have declared errors (strict compliance) */
  allStepsDeclareErrors: boolean;
}

/**
 * Error flow edge showing which step can produce which error.
 */
export interface ErrorFlowEdge {
  /** Step that can produce the error */
  stepId: string;
  /** The error tag */
  error: string;
}

// =============================================================================
// Analysis Functions
// =============================================================================

/**
 * Analyze error flow in a workflow.
 */
export function analyzeErrorFlow(ir: StaticWorkflowIR): ErrorFlowAnalysis {
  const stepErrors: StepErrorInfo[] = [];
  const allErrorsSet = new Set<string>();
  const errorToSteps = new Map<string, string[]>();
  const stepsWithoutErrors: string[] = [];

  // Collect all steps with their errors
  collectStepErrors(ir.root.children, stepErrors);

  // Build aggregated data
  for (const step of stepErrors) {
    if (step.errors.length === 0) {
      stepsWithoutErrors.push(step.stepId);
    }

    for (const error of step.errors) {
      allErrorsSet.add(error);

      const steps = errorToSteps.get(error) ?? [];
      steps.push(step.stepId);
      errorToSteps.set(error, steps);
    }
  }

  return {
    allErrors: Array.from(allErrorsSet).sort(),
    stepErrors,
    errorToSteps,
    stepsWithoutErrors,
    allStepsDeclareErrors: stepsWithoutErrors.length === 0 && stepErrors.length > 0,
  };
}

/**
 * Recursively collect step error information.
 */
function collectStepErrors(
  nodes: StaticFlowNode[],
  result: StepErrorInfo[]
): void {
  for (const node of nodes) {
    if (node.type === "step") {
      const stepNode = node as StaticStepNode;
      result.push({
        stepId: stepNode.stepId ?? stepNode.id,
        stepName: stepNode.name,
        errors: stepNode.errors ?? [],
        location: stepNode.location
          ? { line: stepNode.location.line, column: stepNode.location.column }
          : undefined,
      });
    }

    // Recurse into children
    const children = getStaticChildren(node);
    if (children.length > 0) {
      collectStepErrors(children, result);
    }
  }
}

// =============================================================================
// Error Propagation
// =============================================================================

/**
 * Get all errors that can reach a specific point in the workflow.
 * This traces errors backward through the workflow graph.
 */
export function getErrorsAtPoint(
  analysis: ErrorFlowAnalysis,
  afterStepId: string
): string[] {
  // For now, simple implementation: all errors from steps up to and including the given step
  const errors = new Set<string>();

  let found = false;
  for (const step of analysis.stepErrors) {
    for (const error of step.errors) {
      errors.add(error);
    }
    if (step.stepId === afterStepId) {
      found = true;
      break;
    }
  }

  if (!found) {
    // If step not found, return all errors
    return analysis.allErrors;
  }

  return Array.from(errors).sort();
}

/**
 * Get which steps can produce a specific error.
 */
export function getErrorProducers(
  analysis: ErrorFlowAnalysis,
  errorTag: string
): StepErrorInfo[] {
  const stepIds = analysis.errorToSteps.get(errorTag) ?? [];
  return analysis.stepErrors.filter((s) => stepIds.includes(s.stepId));
}

// =============================================================================
// Error Validation
// =============================================================================

/**
 * Result of validating workflow errors against a declared contract.
 */
export interface ErrorValidation {
  /** Whether the declared errors match the computed errors */
  valid: boolean;
  /** Errors declared but not present in any step */
  unusedDeclared: string[];
  /** Errors present in steps but not declared */
  undeclaredErrors: string[];
  /** The computed union of all step errors */
  computedErrors: string[];
}

/**
 * Validate that declared workflow errors match computed errors.
 */
export function validateWorkflowErrors(
  analysis: ErrorFlowAnalysis,
  declaredErrors: string[]
): ErrorValidation {
  const declaredSet = new Set(declaredErrors);
  const computedSet = new Set(analysis.allErrors);

  const unusedDeclared = declaredErrors.filter((e) => !computedSet.has(e));
  const undeclaredErrors = analysis.allErrors.filter((e) => !declaredSet.has(e));

  return {
    valid: unusedDeclared.length === 0 && undeclaredErrors.length === 0,
    unusedDeclared,
    undeclaredErrors,
    computedErrors: analysis.allErrors,
  };
}

// =============================================================================
// Rendering
// =============================================================================

/**
 * Render error flow as a Mermaid diagram showing which steps produce which errors.
 */
export function renderErrorFlowMermaid(analysis: ErrorFlowAnalysis): string {
  const lines: string[] = [];

  lines.push("flowchart LR");
  lines.push("");
  lines.push("  %% Error Flow Graph");
  lines.push("");

  // Render steps as nodes
  lines.push("  subgraph Steps");
  for (const step of analysis.stepErrors) {
    const label = step.stepName ?? step.stepId;
    lines.push(`    ${sanitizeId(step.stepId)}["${label}"]`);
  }
  lines.push("  end");
  lines.push("");

  // Render errors as nodes
  if (analysis.allErrors.length > 0) {
    lines.push("  subgraph Errors");
    for (const error of analysis.allErrors) {
      lines.push(`    err_${sanitizeId(error)}(["${error}"])`);
    }
    lines.push("  end");
    lines.push("");

    // Render edges from steps to their errors
    for (const step of analysis.stepErrors) {
      for (const error of step.errors) {
        lines.push(
          `  ${sanitizeId(step.stepId)} -.->|throws| err_${sanitizeId(error)}`
        );
      }
    }
  }

  // Style errors
  lines.push("");
  lines.push("  classDef error fill:#ffcdd2,stroke:#c62828");
  for (const error of analysis.allErrors) {
    lines.push(`  class err_${sanitizeId(error)} error`);
  }

  // Highlight steps without declared errors
  if (analysis.stepsWithoutErrors.length > 0) {
    lines.push("");
    lines.push("  classDef noErrors fill:#fff3cd,stroke:#856404");
    for (const stepId of analysis.stepsWithoutErrors) {
      lines.push(`  class ${sanitizeId(stepId)} noErrors`);
    }
  }

  return lines.join("\n");
}

/**
 * Format error analysis as a markdown summary.
 */
export function formatErrorSummary(analysis: ErrorFlowAnalysis): string {
  const lines: string[] = [];

  lines.push("## Error Flow Summary");
  lines.push("");

  // Overview
  lines.push(`**Total Steps:** ${analysis.stepErrors.length}`);
  lines.push(`**Total Error Types:** ${analysis.allErrors.length}`);
  lines.push(
    `**Steps Without Declared Errors:** ${analysis.stepsWithoutErrors.length}`
  );
  lines.push("");

  // Error listing
  if (analysis.allErrors.length > 0) {
    lines.push("### Error Types");
    lines.push("");
    for (const error of analysis.allErrors) {
      const producers = analysis.errorToSteps.get(error) ?? [];
      lines.push(`- \`${error}\` - produced by: ${producers.join(", ")}`);
    }
    lines.push("");
  }

  // Steps without errors (warnings)
  if (analysis.stepsWithoutErrors.length > 0) {
    lines.push("### Steps Without Declared Errors");
    lines.push("");
    lines.push(
      "The following steps do not declare their errors, which may cause issues in strict mode:"
    );
    lines.push("");
    for (const stepId of analysis.stepsWithoutErrors) {
      lines.push(`- ${stepId}`);
    }
    lines.push("");
  }

  // Step details
  lines.push("### Step Error Details");
  lines.push("");
  lines.push("| Step | Errors |");
  lines.push("|------|--------|");
  for (const step of analysis.stepErrors) {
    const name = step.stepName ?? step.stepId;
    const errors =
      step.errors.length > 0 ? step.errors.map((e) => `\`${e}\``).join(", ") : "_none_";
    lines.push(`| ${name} | ${errors} |`);
  }

  return lines.join("\n");
}

/**
 * Sanitize a string for use as a Mermaid node ID.
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}
