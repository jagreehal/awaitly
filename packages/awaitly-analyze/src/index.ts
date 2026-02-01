/**
 * Static Workflow Analysis
 *
 * Tools for analyzing workflow structure without executing code.
 * Uses ts-morph for full TypeScript type information.
 *
 * Enables:
 * - Understanding all possible execution paths
 * - Generating test coverage matrices
 * - Creating documentation diagrams
 * - Calculating complexity metrics
 * - Extracting type information (input types, result types, error types)
 *
 * @remarks
 * Description and markdown on workflows are only set for `createWorkflow` / `createSagaWorkflow`
 * (from options or deps). They are undefined for `run()` / `runSaga()`. Step and saga-step
 * description and markdown come from their options objects when present.
 *
 * @example
 * ```typescript
 * import {
 *   analyze,
 *   generatePaths,
 *   calculateComplexity,
 *   renderStaticMermaid,
 *   generateTestMatrix,
 * } from 'awaitly-analyze';
 *
 * // Analyze a workflow file
 * const ir = analyze('./src/workflows/checkout.ts').single();
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
// Static Analysis - Primary API
// =============================================================================

export { analyze, type AnalyzeResult } from "./analyze";

// =============================================================================
// Static Analysis - Legacy API
// =============================================================================

export {
  analyzeWorkflow,
  analyzeWorkflowFile,
  analyzeWorkflowSource,
  resetIdCounter,
} from "./static-analyzer";

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
  generatePathsWithMetadata,
  calculatePathStatistics,
  filterPaths,
} from "./path-generator";
export type {
  PathGeneratorOptions,
  PathGenerationResult,
  PathStatistics,
  PathStatisticsOptions,
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

// JSON renderers
export {
  renderStaticJSON,
  renderMultipleStaticJSON,
} from "./output/json";
export type { JSONRenderOptions } from "./output/json";

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
  StaticStreamNode,
  StaticConditionalNode,
  StaticSwitchNode,
  StaticSwitchCase,
  StaticLoopNode,
  StaticWorkflowRefNode,
  StaticUnknownNode,
  StaticSagaStepNode,
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
  AnalyzerOptions,
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
  isStaticStreamNode,
  isStaticConditionalNode,
  isStaticSwitchNode,
  isStaticLoopNode,
  isStaticWorkflowRefNode,
  isStaticUnknownNode,
  isStaticSagaStepNode,
  hasStaticChildren,
  getStaticChildren,
} from "./types";
