/**
 * Shared analyzer primitives: options, source locations, and node IDs.
 *
 * Kept free of analyzer-internal dependencies so every static-analyzer
 * module can use them without import cycles.
 */

// Type-only imports - erased at compile time, no runtime dependency
import type { Node } from "ts-morph";

import { type SourceLocation } from "../types";

/**
 * Options for the static analyzer.
 */
export interface AnalyzerOptions {
  /** Path to tsconfig.json (optional, will use default if not provided) */
  tsConfigPath?: string;
  /** Whether to resolve and inline referenced workflows */
  resolveReferences?: boolean;
  /** Maximum depth for reference resolution (default: 5) */
  maxReferenceDepth?: number;
  /** Whether to include source locations in output */
  includeLocations?: boolean;
  /** Assume imports are present (for code snippets without imports) */
  assumeImported?: boolean;
  /** Filter which patterns to detect: 'run', 'createWorkflow', 'createSagaWorkflow', or 'all' */
  detect?: "run" | "createWorkflow" | "createSagaWorkflow" | "all";
}

export function getLocation(node: Node): SourceLocation {
  const sourceFile = node.getSourceFile();
  const start = node.getStart();
  const end = node.getEnd();
  const startPos = sourceFile.getLineAndColumnAtPos(start);
  const endPos = sourceFile.getLineAndColumnAtPos(end);

  return {
    filePath: sourceFile.getFilePath(),
    line: startPos.line,
    column: startPos.column - 1,
    endLine: endPos.line,
    endColumn: endPos.column - 1,
  };
}

let idCounter = 0;
export function generateId(): string {
  return `static-${++idCounter}`;
}

/**
 * Reset the ID counter (useful for testing).
 */
export function resetIdCounter(): void {
  idCounter = 0;
}
