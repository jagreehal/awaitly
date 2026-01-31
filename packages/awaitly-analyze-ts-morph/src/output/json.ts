/**
 * JSON Renderer for Static Workflow Analysis
 *
 * Serializes StaticWorkflowIR to JSON format.
 */

import type { StaticWorkflowIR } from "../types";

// =============================================================================
// Options
// =============================================================================

export interface JSONRenderOptions {
  /** Pretty print with indentation (default: true) */
  pretty?: boolean;
  /** Include analysis metadata (default: true) */
  includeMetadata?: boolean;
}

// =============================================================================
// Main Renderer
// =============================================================================

/**
 * Render a single workflow IR to JSON.
 */
export function renderStaticJSON(
  ir: StaticWorkflowIR,
  options: JSONRenderOptions = {}
): string {
  const { pretty = true, includeMetadata = true } = options;

  const serializable = {
    root: ir.root,
    metadata: includeMetadata ? ir.metadata : undefined,
    // Convert Map to object for JSON serialization
    references:
      ir.references.size > 0
        ? Object.fromEntries(
            Array.from(ir.references.entries()).map(([key, value]) => [
              key,
              {
                root: value.root,
                metadata: includeMetadata ? value.metadata : undefined,
              },
            ])
          )
        : undefined,
  };

  return pretty
    ? JSON.stringify(serializable, null, 2)
    : JSON.stringify(serializable);
}

/**
 * Render multiple workflow IRs to JSON.
 */
export function renderMultipleStaticJSON(
  workflows: StaticWorkflowIR[],
  filePath: string,
  options: JSONRenderOptions = {}
): string {
  const { pretty = true, includeMetadata = true } = options;

  const serializable = {
    file: filePath,
    analyzedAt: Date.now(),
    workflowCount: workflows.length,
    workflows: workflows.map((ir) => ({
      root: ir.root,
      metadata: includeMetadata ? ir.metadata : undefined,
      references:
        ir.references.size > 0
          ? Object.fromEntries(
              Array.from(ir.references.entries()).map(([key, value]) => [
                key,
                {
                  root: value.root,
                  metadata: includeMetadata ? value.metadata : undefined,
                },
              ])
            )
          : undefined,
    })),
  };

  return pretty
    ? JSON.stringify(serializable, null, 2)
    : JSON.stringify(serializable);
}
