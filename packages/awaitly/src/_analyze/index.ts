/**
 * Static Workflow Analysis
 *
 * Tools for analyzing workflow structure without executing code.
 * Enables:
 * - Understanding all possible execution paths
 * - Generating test coverage matrices
 * - Creating documentation diagrams
 * - Calculating complexity metrics
 *
 * @example
 * ```typescript
 * import {
 *   analyzeWorkflow,
 *   generatePaths,
 *   calculateComplexity,
 *   renderStaticMermaid,
 *   generateTestMatrix,
 * } from 'awaitly/analyze';
 *
 * // Analyze a workflow file
 * const ir = analyzeWorkflow('./src/workflows/checkout.ts');
 *
 * // Generate all possible paths
 * const paths = generatePaths(ir);
 * console.log(`Found ${paths.length} unique execution paths`);
 *
 * // Calculate complexity metrics
 * const metrics = calculateComplexity(ir);
 * console.log(`Cyclomatic complexity: ${metrics.cyclomaticComplexity}`);
 *
 * // Generate documentation diagram
 * const mermaid = renderStaticMermaid(ir);
 * console.log(mermaid);
 *
 * // Generate test coverage matrix
 * const testMatrix = generateTestMatrix(paths);
 * console.log(formatTestMatrixMarkdown(testMatrix));
 * ```
 */

// =============================================================================
// Static Analysis
// =============================================================================

export { analyzeWorkflow, resetIdCounter } from "./static-analyzer";
export type { AnalyzerOptions } from "./static-analyzer";

// =============================================================================
// Cross-Workflow Composition
// =============================================================================

export {
  analyzeWorkflowGraph,
  getTopologicalOrder,
  getDependencies,
  getDependents,
  calculateGraphComplexity,
  renderGraphMermaid,
} from "./composition-resolver";
export type {
  WorkflowGraph,
  WorkflowGraphNode,
  WorkflowCallEdge,
  UnresolvedReference,
  CompositionResolverOptions,
} from "./composition-resolver";

// =============================================================================
// Path Generation
// =============================================================================

export {
  generatePaths,
  calculatePathStatistics,
  filterPaths,
} from "./path-generator";
export type {
  PathGeneratorOptions,
  PathStatistics,
} from "./path-generator";

// =============================================================================
// Complexity Metrics
// =============================================================================

export {
  calculateComplexity,
  assessComplexity,
  formatComplexitySummary,
  DEFAULT_THRESHOLDS,
} from "./complexity";
export type {
  ComplexityAssessment,
  ComplexityWarning,
} from "./complexity";

// =============================================================================
// Output Generators
// =============================================================================

// Mermaid diagrams
export {
  renderStaticMermaid,
  renderPathsMermaid,
} from "./output/mermaid";
export type {
  MermaidOptions,
  MermaidStyles,
} from "./output/mermaid";

// Test coverage matrix
export {
  generateTestMatrix,
  formatTestMatrixMarkdown,
  formatTestMatrixAsCode,
  formatTestChecklist,
} from "./output/test-matrix";
export type { TestMatrixOptions } from "./output/test-matrix";

// =============================================================================
// Types
// =============================================================================

export type {
  // Static IR nodes
  StaticWorkflowIR,
  StaticWorkflowNode,
  StaticFlowNode,
  StaticStepNode,
  StaticSequenceNode,
  StaticParallelNode,
  StaticRaceNode,
  StaticConditionalNode,
  StaticLoopNode,
  StaticWorkflowRefNode,
  StaticUnknownNode,
  StaticBaseNode,
  // Configuration types
  StaticRetryConfig,
  StaticTimeoutConfig,
  // Source location
  SourceLocation,
  // Dependency info
  DependencyInfo,
  // Analysis metadata
  StaticAnalysisMetadata,
  AnalysisWarning,
  AnalysisStats,
  // Paths
  WorkflowPath,
  PathStepRef,
  PathCondition,
  // Complexity
  ComplexityMetrics,
  ComplexityThresholds,
  // Test matrix
  TestMatrix,
  TestPath,
  TestCondition,
  TestMatrixSummary,
} from "./types";

// Type guards
export {
  isStaticStepNode,
  isStaticSequenceNode,
  isStaticParallelNode,
  isStaticRaceNode,
  isStaticConditionalNode,
  isStaticLoopNode,
  isStaticWorkflowRefNode,
  isStaticUnknownNode,
  hasStaticChildren,
  getStaticChildren,
} from "./types";
