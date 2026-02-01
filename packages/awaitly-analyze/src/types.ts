/**
 * Static Workflow Analysis - Type Definitions
 *
 * These types represent workflow structure extracted through static analysis
 * (AST walking) rather than runtime execution. Key differences from runtime IR:
 * - No execution state (pending/running/success/error)
 * - Conditions captured as strings, not evaluated
 * - Dynamic values marked as <dynamic>
 * - Support for loop markers and cross-workflow references
 */

// =============================================================================
// Static Node Types
// =============================================================================

/**
 * Base properties shared by all static analysis nodes.
 * Unlike runtime nodes, these don't have execution state or timing.
 */
export interface StaticBaseNode {
  /** Unique identifier for this node (generated during analysis) */
  id: string;
  /** Human-readable name (from step options or inferred from function name) */
  name?: string;
  /** Cache key if specified (may be "<dynamic>" for template literals) */
  key?: string;
  /** Source location in the original file */
  location?: SourceLocation;
}

/**
 * Source code location for tracing back to original code.
 */
export interface SourceLocation {
  /** Absolute file path */
  filePath: string;
  /** Line number (1-indexed) */
  line: number;
  /** Column number (0-indexed) */
  column: number;
  /** End line number */
  endLine?: number;
  /** End column number */
  endColumn?: number;
}

/**
 * A single step in the workflow.
 */
export interface StaticStepNode extends StaticBaseNode {
  type: "step";
  /** The function being called (e.g., "fetchUser", "deps.validateCart") */
  callee?: string;
  /** Short description for labels/tooltips (static analysis) */
  description?: string;
  /** Full markdown documentation (static analysis) */
  markdown?: string;
  /** Retry configuration if specified */
  retry?: StaticRetryConfig;
  /** Timeout configuration if specified */
  timeout?: StaticTimeoutConfig;
}

/**
 * Retry configuration extracted from step options.
 */
export interface StaticRetryConfig {
  attempts?: number | "<dynamic>";
  backoff?: "fixed" | "linear" | "exponential" | "<dynamic>";
  baseDelay?: number | "<dynamic>";
  /** Condition as source code string */
  retryOn?: string;
}

/**
 * Timeout configuration extracted from step options.
 */
export interface StaticTimeoutConfig {
  ms?: number | "<dynamic>";
}

/**
 * Sequential execution - steps run one after another.
 */
export interface StaticSequenceNode extends StaticBaseNode {
  type: "sequence";
  children: StaticFlowNode[];
}

/**
 * Parallel execution - all branches run simultaneously.
 */
export interface StaticParallelNode extends StaticBaseNode {
  type: "parallel";
  children: StaticFlowNode[];
  /**
   * Execution mode:
   * - 'all': Fails on first error (allAsync)
   * - 'allSettled': Collects all results (allSettledAsync)
   */
  mode: "all" | "allSettled";
  /** The function used (e.g., "allAsync", "allSettledAsync", "step.parallel") */
  callee?: string;
}

/**
 * Race execution - first to complete wins.
 */
export interface StaticRaceNode extends StaticBaseNode {
  type: "race";
  children: StaticFlowNode[];
  /** The function used (e.g., "anyAsync", "step.race") */
  callee?: string;
}

/**
 * Streaming operation in the workflow.
 * Represents step.getWritable(), step.getReadable(), or step.streamForEach() calls.
 */
export interface StaticStreamNode extends StaticBaseNode {
  type: "stream";
  /** Type of streaming operation */
  streamType: "write" | "read" | "forEach";
  /** Stream namespace if statically determinable */
  namespace?: string;
  /** Configuration options extracted from the call */
  options?: {
    /** High-water mark for backpressure (getWritable) */
    highWaterMark?: number | "<dynamic>";
    /** Start index for resuming (getReadable) */
    startIndex?: number | "<dynamic>";
    /** Concurrency for parallel processing (streamForEach) */
    concurrency?: number | "<dynamic>";
    /** Checkpoint interval (streamForEach) */
    checkpointInterval?: number | "<dynamic>";
  };
  /** The callee expression (e.g., "step.getWritable", "step.streamForEach") */
  callee?: string;
}

/**
 * Conditional branch in the workflow.
 */
export interface StaticConditionalNode extends StaticBaseNode {
  type: "conditional";
  /** The condition as source code string (e.g., "user.role === 'admin'") */
  condition: string;
  /** The helper used (if any): "when", "unless", "whenOr", "unlessOr", or null for if/else */
  helper?: "when" | "unless" | "whenOr" | "unlessOr" | null;
  /** The "if" branch (or when/unless branch) */
  consequent: StaticFlowNode[];
  /** The "else" branch (or default value for whenOr/unlessOr) */
  alternate?: StaticFlowNode[];
  /** For whenOr/unlessOr, the default value as source string */
  defaultValue?: string;
}

/**
 * Switch case branch in a switch statement.
 */
export interface StaticSwitchCase {
  /** Case value as source string (e.g., "'admin'", "Status.Active") */
  value?: string;
  /** Whether this is the default case */
  isDefault: boolean;
  /** Steps in this case branch */
  body: StaticFlowNode[];
}

/**
 * Switch statement in the workflow.
 */
export interface StaticSwitchNode extends StaticBaseNode {
  type: "switch";
  /** The switch expression as source code string */
  expression: string;
  /** All case branches including default */
  cases: StaticSwitchCase[];
}

/**
 * Loop structure in the workflow.
 * Loops are not expanded - just marked as containing potentially repeated steps.
 */
export interface StaticLoopNode extends StaticBaseNode {
  type: "loop";
  /** Loop type: for, while, forEach, map, etc. */
  loopType: "for" | "while" | "forEach" | "map" | "for-of" | "for-in";
  /** The iteration source as source string (e.g., "users", "0..10") */
  iterSource?: string;
  /** Steps inside the loop */
  body: StaticFlowNode[];
  /** Whether iteration count is known at static analysis time */
  boundKnown: boolean;
  /** If known, the iteration count */
  boundCount?: number;
}

/**
 * Reference to another workflow (composition).
 */
export interface StaticWorkflowRefNode extends StaticBaseNode {
  type: "workflow-ref";
  /** Name of the referenced workflow variable */
  workflowName: string;
  /** File path if resolved (relative to project root) */
  resolvedPath?: string;
  /** Whether the referenced workflow was successfully analyzed */
  resolved: boolean;
  /** The full IR of the referenced workflow (if resolved and inlined) */
  inlinedIR?: StaticWorkflowIR;
}

/**
 * Unknown or unanalyzable code block.
 * Used when static analysis can't determine the structure.
 */
export interface StaticUnknownNode extends StaticBaseNode {
  type: "unknown";
  /** Reason why this couldn't be analyzed */
  reason: string;
  /** The source code that couldn't be analyzed */
  sourceCode?: string;
}

/**
 * A saga step in a saga workflow.
 * Represents saga.step() or saga.tryStep() calls with optional compensation.
 */
export interface StaticSagaStepNode extends StaticBaseNode {
  type: "saga-step";
  /** The function being called (e.g., "deps.reserve", "deps.charge") */
  callee?: string;
  /** Whether this step has a compensation function */
  hasCompensation: boolean;
  /** The compensation function callee (e.g., "deps.release", "deps.refund") */
  compensationCallee?: string;
  /** Short description for labels/tooltips */
  description?: string;
  /** Full markdown documentation */
  markdown?: string;
  /** Whether this is a tryStep (error-mapped step) */
  isTryStep?: boolean;
}

/**
 * Union of all static flow node types.
 */
export type StaticFlowNode =
  | StaticStepNode
  | StaticSequenceNode
  | StaticParallelNode
  | StaticRaceNode
  | StaticStreamNode
  | StaticConditionalNode
  | StaticSwitchNode
  | StaticLoopNode
  | StaticWorkflowRefNode
  | StaticUnknownNode
  | StaticSagaStepNode;

// =============================================================================
// Static Workflow IR
// =============================================================================

/**
 * Root node representing the analyzed workflow.
 */
export interface StaticWorkflowNode extends StaticBaseNode {
  type: "workflow";
  /** Name of the workflow (from variable name or file name) */
  workflowName: string;
  /** Source pattern: 'createWorkflow', 'run', 'createSagaWorkflow', or 'runSaga' */
  source?: "createWorkflow" | "run" | "createSagaWorkflow" | "runSaga";
  /** Dependencies declared in createWorkflow */
  dependencies: DependencyInfo[];
  /** Inferred error types from dependencies */
  errorTypes: string[];
  /** The workflow body */
  children: StaticFlowNode[];
  /** Short description for labels/tooltips */
  description?: string;
  /** Full markdown documentation */
  markdown?: string;
}

/**
 * Information about a workflow dependency.
 */
export interface DependencyInfo {
  /** Name of the dependency (e.g., "fetchUser") */
  name: string;
  /** Type signature as string */
  typeSignature?: string;
  /** Error types this dependency can return */
  errorTypes: string[];
}

/**
 * Complete static workflow intermediate representation.
 */
export interface StaticWorkflowIR {
  /** Root workflow node */
  root: StaticWorkflowNode;
  /** Metadata about the analysis */
  metadata: StaticAnalysisMetadata;
  /** Referenced workflows (for composition) */
  references: Map<string, StaticWorkflowIR>;
}

/**
 * Metadata about the static analysis.
 */
export interface StaticAnalysisMetadata {
  /** When the analysis was performed */
  analyzedAt: number;
  /** File that was analyzed */
  filePath: string;
  /** TypeScript version used */
  tsVersion?: string;
  /** Any warnings generated during analysis */
  warnings: AnalysisWarning[];
  /** Analysis statistics */
  stats: AnalysisStats;
}

/**
 * Warning generated during analysis.
 */
export interface AnalysisWarning {
  /** Warning code */
  code: string;
  /** Human-readable message */
  message: string;
  /** Location in source */
  location?: SourceLocation;
}

/**
 * Statistics about the analysis.
 */
export interface AnalysisStats {
  /** Total steps found */
  totalSteps: number;
  /** Number of conditional branches */
  conditionalCount: number;
  /** Number of parallel blocks */
  parallelCount: number;
  /** Number of race blocks */
  raceCount: number;
  /** Number of loops */
  loopCount: number;
  /** Number of streaming operations */
  streamCount?: number;
  /** Number of workflow references */
  workflowRefCount: number;
  /** Number of unknown/unanalyzable blocks */
  unknownCount: number;
  /** Number of saga workflows found */
  sagaWorkflowCount?: number;
  /** Number of saga steps with compensation */
  compensatedStepCount?: number;
}

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
}

// =============================================================================
// Workflow Paths
// =============================================================================

/**
 * A single execution path through the workflow.
 * Generated by path enumeration.
 */
export interface WorkflowPath {
  /** Unique identifier for this path */
  id: string;
  /** Human-readable description of this path */
  description: string;
  /** Ordered list of steps in this path */
  steps: PathStepRef[];
  /** Conditions that must be true for this path */
  conditions: PathCondition[];
  /** Whether this path contains loops (repeated steps) */
  hasLoops: boolean;
  /** Whether this path contains unresolved workflow refs */
  hasUnresolvedRefs: boolean;
}

/**
 * Reference to a step in a path.
 */
export interface PathStepRef {
  /** Node ID from the IR */
  nodeId: string;
  /** Step key (if any) */
  key?: string;
  /** Step name */
  name?: string;
  /** Whether this step might be repeated (in a loop) */
  repeated: boolean;
}

/**
 * A condition that must be satisfied for a path.
 */
export interface PathCondition {
  /** The condition expression as source string */
  expression: string;
  /** Whether this condition must be true or false for this path */
  mustBe: boolean;
  /** Source location of the condition */
  location?: SourceLocation;
}

// =============================================================================
// Complexity Metrics
// =============================================================================

/**
 * Complexity metrics for a workflow.
 */
export interface ComplexityMetrics {
  /** McCabe's cyclomatic complexity */
  cyclomaticComplexity: number;
  /** Total number of unique paths (may be Infinity for unbounded loops) */
  pathCount: number | "unbounded";
  /** Maximum nesting depth */
  maxDepth: number;
  /** Maximum parallel breadth (concurrent operations) */
  maxParallelBreadth: number;
  /** Number of decision points */
  decisionPoints: number;
  /** Cognitive complexity (Sonar-style) */
  cognitiveComplexity: number;
}

/**
 * Complexity thresholds for warnings.
 */
export interface ComplexityThresholds {
  /** Cyclomatic complexity warning threshold (default: 10) */
  cyclomaticWarning: number;
  /** Cyclomatic complexity error threshold (default: 20) */
  cyclomaticError: number;
  /** Path count warning threshold (default: 50) */
  pathCountWarning: number;
  /** Max depth warning threshold (default: 5) */
  maxDepthWarning: number;
}

// =============================================================================
// Test Coverage Matrix
// =============================================================================

/**
 * Test coverage matrix for workflow paths.
 */
export interface TestMatrix {
  /** All paths that should be tested */
  paths: TestPath[];
  /** Conditions that affect path selection */
  conditions: TestCondition[];
  /** Summary statistics */
  summary: TestMatrixSummary;
}

/**
 * A path in the test matrix.
 */
export interface TestPath {
  /** Path ID */
  id: string;
  /** Suggested test name */
  suggestedTestName: string;
  /** Description of what this test covers */
  description: string;
  /** Conditions to set up for this test */
  setupConditions: string[];
  /** Expected steps to execute */
  expectedSteps: string[];
  /** Priority (higher = more important to test) */
  priority: "high" | "medium" | "low";
}

/**
 * A condition that affects test paths.
 */
export interface TestCondition {
  /** Condition expression */
  expression: string;
  /** Paths affected when true */
  affectedPathsWhenTrue: string[];
  /** Paths affected when false */
  affectedPathsWhenFalse: string[];
}

/**
 * Summary of test matrix.
 */
export interface TestMatrixSummary {
  /** Total paths to test */
  totalPaths: number;
  /** Number of high-priority paths */
  highPriorityPaths: number;
  /** Number of conditions to vary */
  totalConditions: number;
  /** Estimated minimum tests needed for full coverage */
  minTestsForCoverage: number;
}

// =============================================================================
// Type Guards
// =============================================================================

export function isStaticStepNode(node: StaticFlowNode): node is StaticStepNode {
  return node.type === "step";
}

export function isStaticSequenceNode(node: StaticFlowNode): node is StaticSequenceNode {
  return node.type === "sequence";
}

export function isStaticParallelNode(node: StaticFlowNode): node is StaticParallelNode {
  return node.type === "parallel";
}

export function isStaticRaceNode(node: StaticFlowNode): node is StaticRaceNode {
  return node.type === "race";
}

export function isStaticStreamNode(node: StaticFlowNode): node is StaticStreamNode {
  return node.type === "stream";
}

export function isStaticConditionalNode(node: StaticFlowNode): node is StaticConditionalNode {
  return node.type === "conditional";
}

export function isStaticSwitchNode(node: StaticFlowNode): node is StaticSwitchNode {
  return node.type === "switch";
}

export function isStaticLoopNode(node: StaticFlowNode): node is StaticLoopNode {
  return node.type === "loop";
}

export function isStaticWorkflowRefNode(node: StaticFlowNode): node is StaticWorkflowRefNode {
  return node.type === "workflow-ref";
}

export function isStaticUnknownNode(node: StaticFlowNode): node is StaticUnknownNode {
  return node.type === "unknown";
}

export function isStaticSagaStepNode(node: StaticFlowNode): node is StaticSagaStepNode {
  return node.type === "saga-step";
}

/**
 * Check if a node has children.
 */
export function hasStaticChildren(
  node: StaticFlowNode
): node is
  | StaticSequenceNode
  | StaticParallelNode
  | StaticRaceNode
  | StaticConditionalNode
  | StaticSwitchNode
  | StaticLoopNode {
  return (
    node.type === "sequence" ||
    node.type === "parallel" ||
    node.type === "race" ||
    node.type === "conditional" ||
    node.type === "switch" ||
    node.type === "loop"
  );
}

/**
 * Get all children of a node (handles different child property names).
 */
export function getStaticChildren(node: StaticFlowNode): StaticFlowNode[] {
  switch (node.type) {
    case "sequence":
    case "parallel":
    case "race":
      return node.children;
    case "conditional":
      return [...node.consequent, ...(node.alternate ?? [])];
    case "switch":
      return node.cases.flatMap((c) => c.body);
    case "loop":
      return node.body;
    default:
      return [];
  }
}
