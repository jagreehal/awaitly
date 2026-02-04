/**
 * Strict Mode Diagnostics
 *
 * Validates workflows against strict mode rules and provides
 * actionable fix suggestions with exact source locations.
 */

import type {
  StaticWorkflowIR,
  StaticFlowNode,
  StaticStepNode,
  SourceLocation,
} from "./types";
import { getStaticChildren } from "./types";

// =============================================================================
// Types
// =============================================================================

/**
 * A diagnostic issue found during strict mode validation.
 */
export interface StrictDiagnostic {
  /** Unique rule ID */
  rule: StrictRule;
  /** Severity level */
  severity: "error" | "warning";
  /** Human-readable message */
  message: string;
  /** Suggested fix */
  fix?: string;
  /** Source location */
  location?: SourceLocation;
  /** Related node ID */
  nodeId?: string;
}

/**
 * Strict mode rule identifiers.
 */
export type StrictRule =
  | "missing-step-id"
  | "dynamic-step-id"
  | "missing-errors"
  | "dynamic-errors"
  | "spread-in-options"
  | "computed-property"
  | "template-literal-id"
  | "imported-config"
  | "unlabelled-conditional"
  | "parallel-missing-errors"
  | "loop-missing-collect";

/**
 * Result of strict mode validation.
 */
export interface StrictValidationResult {
  /** Whether the workflow passes strict mode */
  valid: boolean;
  /** All diagnostics (errors and warnings) */
  diagnostics: StrictDiagnostic[];
  /** Just the errors */
  errors: StrictDiagnostic[];
  /** Just the warnings */
  warnings: StrictDiagnostic[];
}

/**
 * Options for strict validation.
 */
export interface StrictValidationOptions {
  /** Check for missing step IDs */
  requireStepId?: boolean;
  /** Check for missing errors declarations */
  requireErrors?: boolean;
  /** Check for labelled conditionals */
  requireLabelledConditionals?: boolean;
  /** Treat warnings as errors */
  warningsAsErrors?: boolean;
}

const DEFAULT_OPTIONS: Required<StrictValidationOptions> = {
  requireStepId: true,
  requireErrors: true,
  requireLabelledConditionals: true,
  warningsAsErrors: false,
};

// =============================================================================
// Main Validation
// =============================================================================

/**
 * Validate a workflow against strict mode rules.
 */
export function validateStrict(
  ir: StaticWorkflowIR,
  options: StrictValidationOptions = {}
): StrictValidationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const diagnostics: StrictDiagnostic[] = [];

  // Collect all steps and validate each
  validateNodes(ir.root.children, opts, diagnostics);

  const errors = diagnostics.filter(
    (d) => d.severity === "error" || (opts.warningsAsErrors && d.severity === "warning")
  );
  const warnings = diagnostics.filter(
    (d) => d.severity === "warning" && !opts.warningsAsErrors
  );

  return {
    valid: errors.length === 0,
    diagnostics,
    errors,
    warnings,
  };
}

/**
 * Recursively validate nodes.
 */
function validateNodes(
  nodes: StaticFlowNode[],
  opts: Required<StrictValidationOptions>,
  diagnostics: StrictDiagnostic[]
): void {
  for (const node of nodes) {
    if (node.type === "step") {
      validateStep(node, opts, diagnostics);
    } else if (node.type === "conditional") {
      // Check for unlabelled conditionals with steps
      if (opts.requireLabelledConditionals) {
        const hasStepsInBranches =
          hasSteps(node.consequent) || (node.alternate && hasSteps(node.alternate));
        if (hasStepsInBranches && !node.name) {
          diagnostics.push({
            rule: "unlabelled-conditional",
            severity: "warning",
            message: "Conditional containing steps should use step.if() for stable IDs",
            fix: "Use step.if('id', 'conditionLabel', () => condition) instead of plain if/else",
            location: node.location,
            nodeId: node.id,
          });
        }
      }
    } else if (node.type === "parallel") {
      // Check for parallel branches without errors in strict mode
      if (opts.requireErrors) {
        for (const child of node.children) {
          if (child.type === "step" && !child.errors) {
            diagnostics.push({
              rule: "parallel-missing-errors",
              severity: "warning",
              message: `Parallel branch "${child.name ?? child.id}" does not declare errors`,
              fix: "Use { fn: () => ..., errors: ['ERROR'] } form for parallel branches",
              location: child.location,
              nodeId: child.id,
            });
          }
        }
      }
    } else if (node.type === "loop") {
      // Check for loop issues
      if (node.loopType === "step.forEach") {
        // step.forEach is already structured - check for collect requirement
        if (node.out && !node.collect) {
          diagnostics.push({
            rule: "loop-missing-collect",
            severity: "warning",
            message: `Loop "${node.name ?? node.loopId ?? node.id}" has out without collect option`,
            fix: "Add collect: 'array' or collect: 'last' when using out",
            location: node.location,
            nodeId: node.id,
          });
        }
      } else {
        // Native loops with steps
        if (hasSteps(node.body)) {
          diagnostics.push({
            rule: "unlabelled-conditional",
            severity: "warning",
            message: "Loop containing steps should use step.forEach() for structured iteration",
            fix: "Use step.forEach('id', items, { run: (item) => ... }) instead of native loop",
            location: node.location,
            nodeId: node.id,
          });
        }
      }
    }

    // Recurse into children
    const children = getStaticChildren(node);
    if (children.length > 0) {
      validateNodes(children, opts, diagnostics);
    }
  }
}

/**
 * Validate a single step node.
 */
function validateStep(
  node: StaticStepNode,
  opts: Required<StrictValidationOptions>,
  diagnostics: StrictDiagnostic[]
): void {
  // Check for missing step ID (new API): no stepId, or analyzer set "<missing>" for legacy step(fn, opts)
  if (opts.requireStepId && (!node.stepId || node.stepId === "<missing>")) {
    diagnostics.push({
      rule: "missing-step-id",
      severity: "warning",
      message: `Step "${node.name ?? node.id}" uses legacy signature without explicit ID`,
      fix: "Use step('id', fn, opts) instead of step(fn, opts)",
      location: node.location,
      nodeId: node.id,
    });
  }

  // Check for dynamic step ID
  if (node.stepId === "<dynamic>") {
    diagnostics.push({
      rule: "dynamic-step-id",
      severity: "error",
      message: `Step ID must be a string literal`,
      fix: "Use a string literal step ID instead of a variable or expression",
      location: node.location,
      nodeId: node.id,
    });
  }

  // Check for missing errors declaration
  if (opts.requireErrors && !node.errors) {
    diagnostics.push({
      rule: "missing-errors",
      severity: "warning",
      message: `Step "${node.name ?? node.stepId ?? node.id}" does not declare its errors`,
      fix: "Add errors: ['ERROR_TAG'] or errors: [] to step options",
      location: node.location,
      nodeId: node.id,
    });
  }
}

/**
 * Check if a list of nodes contains any steps.
 */
function hasSteps(nodes: StaticFlowNode[]): boolean {
  for (const node of nodes) {
    if (node.type === "step") return true;
    const children = getStaticChildren(node);
    if (children.length > 0 && hasSteps(children)) return true;
  }
  return false;
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * Format diagnostics as human-readable text.
 */
export function formatDiagnostics(result: StrictValidationResult): string {
  const lines: string[] = [];

  if (result.valid) {
    lines.push("✓ Workflow passes strict mode validation");
    if (result.warnings.length > 0) {
      lines.push(`  (${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"})`);
    }
  } else {
    lines.push(`✗ Strict mode validation failed: ${result.errors.length} error(s)`);
  }

  lines.push("");

  for (const diag of result.diagnostics) {
    const icon = diag.severity === "error" ? "✗" : "⚠";
    const loc = diag.location ? `:${diag.location.line}:${diag.location.column}` : "";
    lines.push(`${icon} [${diag.rule}]${loc}`);
    lines.push(`  ${diag.message}`);
    if (diag.fix) {
      lines.push(`  Fix: ${diag.fix}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format diagnostics as JSON for tooling integration.
 */
export function formatDiagnosticsJSON(result: StrictValidationResult): string {
  return JSON.stringify(
    {
      valid: result.valid,
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
      diagnostics: result.diagnostics.map((d) => ({
        rule: d.rule,
        severity: d.severity,
        message: d.message,
        fix: d.fix,
        location: d.location
          ? {
              line: d.location.line,
              column: d.location.column,
            }
          : undefined,
      })),
    },
    null,
    2
  );
}

/**
 * Get a summary line for the validation result.
 */
export function getSummary(result: StrictValidationResult): string {
  if (result.valid && result.warnings.length === 0) {
    return "✓ All strict mode checks passed";
  }
  if (result.valid) {
    return `✓ Passed with ${result.warnings.length} warning(s)`;
  }
  return `✗ ${result.errors.length} error(s), ${result.warnings.length} warning(s)`;
}
