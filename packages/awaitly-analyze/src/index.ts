/**
 * Static Workflow Analysis
 *
 * This module provides static workflow analysis using tree-sitter.
 * Analyze workflow source code to extract structure, dependencies,
 * and generate visualization data without executing the workflow.
 *
 * Features:
 * - WASM-based parsing (no native dependencies)
 * - Browser and Node.js compatible
 * - Step detection, conditionals, loops, parallel/race
 * - Workflow composition tracking
 *
 * Usage:
 * ```typescript
 * import { analyzeWorkflow } from 'awaitly-analyze';
 *
 * const results = await analyzeWorkflow('./my-workflow.ts');
 * ```
 */

// Analyzer
export {
  analyzeWorkflow,
  analyzeWorkflowSource,
  resetIdCounter,
} from "./static-analyzer";

// Loader utilities
export {
  loadTreeSitter,
  clearTreeSitterCache,
} from "./tree-sitter-loader";

// Renderers
export {
  renderStaticMermaid,
  renderPathsMermaid,
  renderStaticJSON,
  renderMultipleStaticJSON,
  type MermaidOptions,
  type MermaidStyles,
  type JSONRenderOptions,
} from "./renderers";

// Re-export types for convenience
export type {
  StaticWorkflowIR,
  StaticWorkflowNode,
  StaticFlowNode,
  StaticStepNode,
  StaticSequenceNode,
  StaticParallelNode,
  StaticRaceNode,
  StaticConditionalNode,
  StaticLoopNode,
  AnalysisWarning,
  AnalysisStats,
  AnalyzerOptions,
} from "./types";
