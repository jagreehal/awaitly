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
// Type Extraction Types
// =============================================================================

/**
 * Information about a type extracted from the type checker.
 */
export interface TypeInfo {
  /** Human-readable type string (what the user wrote) */
  display: string;
  /** Canonical type string (normalized, fully qualified) */
  canonical: string;
  /** Kind of Result-like type detected */
  kind: "asyncResult" | "result" | "promiseResult" | "plain" | "unknown";
  /** Confidence level of the extraction */
  confidence: "exact" | "inferred" | "fallback";
  /** Where the type information came from */
  source: "checker" | "annotation" | "fallback";
}

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
  /** Human-readable name (for steps: from first arg stepId in awaitly; for other nodes from options or inferred) */
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
 * Aligns with awaitly: step identity is always the first argument (stepId), never from options.
 */
export interface StaticStepNode extends StaticBaseNode {
  type: "step";
  /** Step ID from first argument: step('id', fn, opts). In awaitly this is the required first param. */
  stepId: string;
  /** The function being called (e.g., "fetchUser", "deps.validateCart") */
  callee?: string;
  /** Short description for labels/tooltips (from options.description; static analysis) */
  description?: string;
  /** Full markdown documentation (static analysis) */
  markdown?: string;
  /** JSDoc description from comment above the step statement (static analysis) */
  jsdocDescription?: string;
  /** JSDoc @param tags (name + description) */
  jsdocParams?: Array<{ name: string; description?: string }>;
  /** JSDoc @returns description */
  jsdocReturns?: string;
  /** JSDoc @throws descriptions */
  jsdocThrows?: string[];
  /** JSDoc @example text */
  jsdocExample?: string;
  /** Retry configuration if specified */
  retry?: StaticRetryConfig;
  /** Timeout configuration if specified */
  timeout?: StaticTimeoutConfig;
  // === New API fields for static analysis ===
  /** Declared error tags from errors option */
  errors?: string[];
  /** Output key for data flow (writes to ctx[out]) */
  out?: string;
  /** Keys read via ctx.ref() inside this step */
  reads?: string[];
  /** For each reads[i], the dependency parameter index this ref is passed to (so readTypes uses the correct param type). */
  readParamIndices?: number[];
  /** Dependency source (from step.dep() or detected from callee) */
  depSource?: string;
  /** Inferred input type(s) from type checker (e.g. step argument types) */
  inputType?: string;
  /** Inferred output type from type checker (e.g. unwrapped Promise/Result success type) */
  outputType?: string;
  /** Source location of the step callee's definition (e.g. where deps.getBatch is defined) */
  depLocation?: SourceLocation;
  /** Sleep duration string for step.sleep() (e.g. "5s", "1h") */
  sleepDuration?: string;
  // === Typed extraction fields ===
  /** Typed output type information (extracted from AsyncResult<T, E, C>) */
  outputTypeInfo?: TypeInfo;
  /** Typed error type information */
  errorTypeInfo?: TypeInfo;
  /** Typed cause type information */
  causeTypeInfo?: TypeInfo;
  /** Typed operation return type (before unwrapping) */
  operationTypeInfo?: TypeInfo;
  /** Expected type per read key (from dependency param types; used for type-mismatch diagnostics) */
  readTypes?: Record<string, TypeInfo>;
}

/**
 * A labelled decision point in the workflow (step.if).
 * Used for stable conditional branch IDs in static analysis.
 */
export interface StaticDecisionNode extends StaticBaseNode {
  type: "decision";
  /** The decision ID (from step.if first argument) */
  decisionId: string;
  /** Human-readable condition label */
  conditionLabel: string;
  /** The condition as source code string */
  condition: string;
  /** The "then" branch (when condition is true) */
  consequent: StaticFlowNode[];
  /** The "else" branch (when condition is false) */
  alternate?: StaticFlowNode[];
  /** Inferred type of the condition expression (e.g. "boolean") */
  conditionType?: string;
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
  /** Inferred type of the condition expression (e.g. "boolean") */
  conditionType?: string;
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
  loopType: "for" | "while" | "forEach" | "map" | "for-of" | "for-in" | "step.forEach";
  /** Loop ID (for step.forEach) */
  loopId?: string;
  /** The iteration source as source string (e.g., "users", "0..10") */
  iterSource?: string;
  /** Steps inside the loop */
  body: StaticFlowNode[];
  /** Whether iteration count is known at static analysis time */
  boundKnown: boolean;
  /** If known, the iteration count */
  boundCount?: number;
  /** Max iterations limit (for step.forEach) */
  maxIterations?: number;
  /** Step ID pattern for loop iterations (e.g., "process-{i}") */
  stepIdPattern?: string;
  /** Declared errors for the loop body */
  errors?: string[];
  /** Output key for data flow (stores loop results) */
  out?: string;
  /** Collect mode: 'array' collects all results, 'last' stores only the last */
  collect?: "array" | "last";
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
  /** Source location of the referenced workflow's definition (when resolved) */
  definitionLocation?: SourceLocation;
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
 * Aligns with awaitly: saga.step(name, operation, options?) — name is the first argument, not in options.
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
  /** JSDoc description from comment above the saga step statement (static analysis) */
  jsdocDescription?: string;
  /** JSDoc @param tags (name + description) */
  jsdocParams?: Array<{ name: string; description?: string }>;
  /** JSDoc @returns description */
  jsdocReturns?: string;
  /** JSDoc @throws descriptions */
  jsdocThrows?: string[];
  /** JSDoc @example text */
  jsdocExample?: string;
  /** Whether this is a tryStep (error-mapped step) */
  isTryStep?: boolean;
  // === Typed extraction fields ===
  /** Typed output type information */
  outputTypeInfo?: TypeInfo;
  /** Typed error type information */
  errorTypeInfo?: TypeInfo;
  /** Typed compensation parameter type */
  compensationParamTypeInfo?: TypeInfo;
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
  | StaticDecisionNode
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
 *
 * @remarks
 * `description` and `markdown` are only set for `createWorkflow` / `createSagaWorkflow`
 * (from options or deps). They are undefined for `run()` / `runSaga()`.
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
  /** JSDoc description from comment above the workflow declaration (static analysis) */
  jsdocDescription?: string;
  /** JSDoc @param tags (name + description) */
  jsdocParams?: Array<{ name: string; description?: string }>;
  /** JSDoc @returns description */
  jsdocReturns?: string;
  /** JSDoc @throws descriptions */
  jsdocThrows?: string[];
  /** JSDoc @example text */
  jsdocExample?: string;
  /** Whether strict mode is enabled for this workflow */
  strict?: boolean;
  /** Declared errors for the workflow (strict mode contract) */
  declaredErrors?: string[];
  /** Inferred return type of the workflow callback (from type checker) */
  workflowReturnType?: string;
  /** Type summary for the entire workflow */
  typeSummary?: {
    /** Union of all possible error types */
    workflowErrorUnion?: TypeInfo;
    /** Union of all possible cause types */
    workflowCauseUnion?: TypeInfo;
    /** Map of step ID to output type */
    stepOutputTypes?: Map<string, TypeInfo>;
  };
}

/**
 * Information about a workflow dependency.
 *
 * @remarks
 * `typeSignature` is populated when the type checker is available (best-effort).
 * `errorTypes` is not yet inferred from types and is typically empty.
 */
export interface DependencyInfo {
  /** Name of the dependency (e.g., "fetchUser") */
  name: string;
  /** Type signature as string (when type checker available) */
  typeSignature?: string;
  /** Error types this dependency can return (not yet inferred from types) */
  errorTypes: string[];
  /** Typed signature information (extracted from type checker) */
  signature?: {
    params: Array<{ name: string; type: TypeInfo }>;
    returnType: TypeInfo;
    resultLike?: {
      okType: TypeInfo;
      errorType: TypeInfo;
      causeType?: TypeInfo;
    };
  };
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

export function isStaticDecisionNode(node: StaticFlowNode): node is StaticDecisionNode {
  return node.type === "decision";
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
  | StaticDecisionNode
  | StaticSwitchNode
  | StaticLoopNode {
  return (
    node.type === "sequence" ||
    node.type === "parallel" ||
    node.type === "race" ||
    node.type === "conditional" ||
    node.type === "decision" ||
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
    case "decision":
      return [...node.consequent, ...(node.alternate ?? [])];
    case "switch":
      return node.cases.flatMap((c) => c.body);
    case "loop":
      return node.body;
    default:
      return [];
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Extract function name from callee expression.
 * - "wDeps.makePayment" → "makePayment"
 * - "deps.fetchData" → "fetchData"
 * - "this.someMethod" → "someMethod"
 * - "makePayment" → "makePayment"
 */
export function extractFunctionName(callee: string): string {
  if (!callee) return "";
  const parts = callee.split(".");
  return parts[parts.length - 1];
}

/**
 * Type guard to validate IR structure at runtime.
 * Useful for validating IR from external sources (e.g., JSON parsing, API responses).
 */
export function isValidStaticWorkflowIR(value: unknown): value is StaticWorkflowIR {
  if (!value || typeof value !== "object") return false;
  const ir = value as Record<string, unknown>;

  if (!ir.root || typeof ir.root !== "object") return false;
  const root = ir.root as Record<string, unknown>;

  return (
    root.type === "workflow" &&
    typeof root.workflowName === "string" &&
    Array.isArray(root.children)
  );
}
