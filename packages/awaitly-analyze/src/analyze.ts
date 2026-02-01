/**
 * Fluent Builder API for Static Workflow Analysis
 *
 * Provides an ergonomic API for analyzing workflow files with explicit intent.
 *
 * @example
 * ```typescript
 * import { analyze } from 'awaitly-analyze';
 *
 * // Single workflow file
 * const ir = analyze('./checkout.ts').single();
 *
 * // Multi-workflow file
 * const workflows = analyze('./workflows.ts').all();
 *
 * // Get specific workflow by name
 * const checkout = analyze('./workflows.ts').named('checkoutWorkflow');
 *
 * // From source string
 * const ir = analyze.source(code).single();
 * ```
 */

import { analyzeWorkflowFile, analyzeWorkflowSource } from "./static-analyzer";
import type { StaticWorkflowIR, AnalyzerOptions } from "./types";

/**
 * Result object from analyze() with fluent methods to retrieve workflows.
 */
export interface AnalyzeResult {
  /**
   * Get single workflow. Throws if file has 0 or >1 workflows.
   * Use this when you expect exactly one workflow in the file.
   */
  single(): StaticWorkflowIR;

  /**
   * Get single workflow or null if not exactly one.
   * Useful when you want to handle missing/multiple workflows gracefully.
   */
  singleOrNull(): StaticWorkflowIR | null;

  /**
   * Get all workflows as array.
   * Always returns an array, empty if no workflows found.
   */
  all(): StaticWorkflowIR[];

  /**
   * Get workflow by name. Throws if not found.
   * @param name - The workflow variable name (e.g., "checkoutWorkflow")
   */
  named(name: string): StaticWorkflowIR;

  /**
   * Get first workflow. Throws if empty.
   * Use when you want the first workflow regardless of how many exist.
   */
  first(): StaticWorkflowIR;

  /**
   * Get first workflow or null if empty.
   * Useful when you want to handle empty files gracefully.
   */
  firstOrNull(): StaticWorkflowIR | null;
}

function createResult(results: StaticWorkflowIR[]): AnalyzeResult {
  return {
    single() {
      if (results.length !== 1) {
        throw new Error(`Expected exactly 1 workflow, found ${results.length}`);
      }
      return results[0];
    },

    singleOrNull() {
      return results.length === 1 ? results[0] : null;
    },

    all() {
      return results;
    },

    named(name: string) {
      const found = results.find((r) => r.root.workflowName === name);
      if (!found) {
        const available = results.map((r) => r.root.workflowName).join(", ");
        throw new Error(
          `Workflow "${name}" not found. Available: ${available || "(none)"}`
        );
      }
      return found;
    },

    first() {
      if (results.length === 0) {
        throw new Error("No workflows found");
      }
      return results[0];
    },

    firstOrNull() {
      return results[0] ?? null;
    },
  };
}

/**
 * Analyze a workflow file and return a fluent result object.
 *
 * @param filePath - Path to the TypeScript file containing the workflow(s)
 * @param options - Analysis options
 * @returns Fluent result object with methods to retrieve workflows
 *
 * @example
 * ```typescript
 * // Single workflow file
 * const ir = analyze('./checkout.ts').single();
 *
 * // Multi-workflow file
 * const workflows = analyze('./workflows.ts').all();
 *
 * // Get specific workflow by name
 * const checkout = analyze('./workflows.ts').named('checkoutWorkflow');
 * ```
 */
export function analyze(
  filePath: string,
  options?: AnalyzerOptions
): AnalyzeResult {
  const results = analyzeWorkflowFile(filePath, options);
  return createResult(results);
}

/**
 * Analyze workflow source code directly (for testing or dynamic analysis).
 *
 * @param code - TypeScript source code containing the workflow(s)
 * @param options - Analysis options
 * @returns Fluent result object with methods to retrieve workflows
 *
 * @example
 * ```typescript
 * const source = `
 *   const checkout = createWorkflow(deps);
 *   async function run() {
 *     return await checkout(async (step) => { ... });
 *   }
 * `;
 *
 * const ir = analyze.source(source).single();
 * ```
 */
analyze.source = function (
  code: string,
  options?: AnalyzerOptions
): AnalyzeResult {
  const results = analyzeWorkflowSource(code, undefined, options);
  return createResult(results);
};
