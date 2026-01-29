/**
 * Workflow Visualization - Intermediate Representation Types
 *
 * The IR (Intermediate Representation) is a DSL that represents workflow
 * execution structure. Events are converted to IR, which can then be
 * rendered to various output formats (ASCII, Mermaid, JSON, etc.).
 */

// =============================================================================
// Step States
// =============================================================================

/**
 * Execution state of a step with semantic meaning for visualization.
 *
 * Color mapping:
 * - pending  → white/clear (not started)
 * - running  → yellow (currently executing)
 * - success  → green (completed successfully)
 * - error    → red (failed with error)
 * - aborted  → gray (cancelled, e.g., in race)
 * - cached   → blue (served from cache)
 * - skipped  → dim gray (not executed due to conditional logic)
 */
export type StepState =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "aborted"
  | "cached"
  | "skipped";

// =============================================================================
// Node Types
// =============================================================================

/**
 * Base properties shared by all IR nodes.
 */
export interface BaseNode {
  /** Unique identifier for this node */
  id: string;
  /** Human-readable name (from step options or inferred) */
  name?: string;
  /** Cache key if this is a keyed step */
  key?: string;
  /** Current execution state */
  state: StepState;
  /** Timestamp when execution started */
  startTs?: number;
  /** Timestamp when execution ended */
  endTs?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Error value if state is 'error' */
  error?: unknown;
  /** Input value that triggered this step (for decision understanding) */
  input?: unknown;
  /** Output value from this step (for decision understanding) */
  output?: unknown;
  /** Number of retry attempts made (0 = no retries, 1 = one retry, etc.) */
  retryCount?: number;
  /** Whether this step experienced a timeout (may have retried after) */
  timedOut?: boolean;
  /** Timeout duration in ms (if timed out) */
  timeoutMs?: number;
}

/**
 * A single step execution node.
 */
export interface StepNode extends BaseNode {
  type: "step";
}

/**
 * Sequential execution - steps run one after another.
 * This is the implicit structure when steps are awaited in sequence.
 */
export interface SequenceNode extends BaseNode {
  type: "sequence";
  children: FlowNode[];
}

/**
 * Parallel execution - all branches run simultaneously.
 * Created by allAsync() or allSettledAsync().
 */
export interface ParallelNode extends BaseNode {
  type: "parallel";
  children: FlowNode[];
  /**
   * Execution mode:
   * - 'all': Fails on first error (allAsync)
   * - 'allSettled': Collects all results (allSettledAsync)
   */
  mode: "all" | "allSettled";
}

/**
 * Race execution - first to complete wins.
 * Created by anyAsync().
 */
export interface RaceNode extends BaseNode {
  type: "race";
  children: FlowNode[];
  /** ID of the winning branch (first to succeed) */
  winnerId?: string;
}

/**
 * Stream operation node.
 * Tracks streaming events (write, read, close, error, backpressure).
 */
export interface StreamNode extends BaseNode {
  type: "stream";
  /** Stream namespace identifier */
  namespace: string;
  /** Total number of write operations */
  writeCount: number;
  /** Total number of read operations */
  readCount: number;
  /** Final position when stream closed */
  finalPosition: number;
  /** Current stream state */
  streamState: "active" | "closed" | "error";
  /** Whether backpressure was encountered during streaming */
  backpressureOccurred: boolean;
}

/**
 * Decision point - conditional branch (if/switch).
 * Shows which branch was taken and why.
 */
export interface DecisionNode extends BaseNode {
  type: "decision";
  /** Condition that was evaluated (e.g., "user.role === 'admin'") */
  condition?: string;
  /** Value that was evaluated (the input to the decision) */
  decisionValue?: unknown;
  /** Which branch was taken (true/false, or the matched case) */
  branchTaken?: string | boolean;
  /** All possible branches (including skipped ones) */
  branches: DecisionBranch[];
}

/**
 * A branch in a decision node.
 */
export interface DecisionBranch {
  /** Label for this branch (e.g., "if", "else", "case 'admin'") */
  label: string;
  /** Condition that would trigger this branch */
  condition?: string;
  /** Whether this branch was taken */
  taken: boolean;
  /** Steps in this branch */
  children: FlowNode[];
}

/**
 * Union of all flow node types.
 */
export type FlowNode = StepNode | SequenceNode | ParallelNode | RaceNode | DecisionNode | StreamNode;

/**
 * Root node representing the entire workflow.
 */
export interface WorkflowNode extends BaseNode {
  type: "workflow";
  /** Correlation ID from the workflow execution */
  workflowId: string;
  /** Child nodes (steps, parallel blocks, etc.) */
  children: FlowNode[];
}

// =============================================================================
// Workflow IR
// =============================================================================

/**
 * Complete workflow intermediate representation.
 * This is the main data structure produced by the IR builder.
 */
export interface WorkflowIR {
  /** Root workflow node */
  root: WorkflowNode;
  /** Metadata about the IR */
  metadata: {
    /** When the IR was first created */
    createdAt: number;
    /** When the IR was last updated */
    lastUpdatedAt: number;
  };
  /** Hook executions (if any hooks are configured) */
  hooks?: WorkflowHooks;
}

// =============================================================================
// Scope Events (for parallel/race detection)
// =============================================================================

// Re-export ScopeType from awaitly for consistency
export type { ScopeType } from "awaitly/workflow";
import type { ScopeType, WorkflowEvent, WorkflowOptions } from "awaitly/workflow";
import type { UnexpectedError } from "awaitly/core";

/**
 * Event emitted when entering a parallel/race scope.
 * This matches the scope_start event in WorkflowEvent.
 */
export interface ScopeStartEvent {
  type: "scope_start";
  workflowId: string;
  scopeId: string;
  scopeType: ScopeType;
  name?: string;
  ts: number;
}

/**
 * Event emitted when exiting a parallel/race scope.
 */
export interface ScopeEndEvent {
  type: "scope_end";
  workflowId: string;
  scopeId: string;
  ts: number;
  durationMs: number;
  /** For race scopes, the ID of the winning branch */
  winnerId?: string;
}

/**
 * Event emitted when a decision point is encountered.
 * Use this to track conditional logic (if/switch).
 */
export interface DecisionStartEvent {
  type: "decision_start";
  workflowId: string;
  decisionId: string;
  /** Condition being evaluated (e.g., "user.role === 'admin'") */
  condition?: string;
  /** Value being evaluated */
  decisionValue?: unknown;
  /** Name/label for this decision point */
  name?: string;
  ts: number;
}

/**
 * Event emitted when a decision branch is taken.
 */
export interface DecisionBranchEvent {
  type: "decision_branch";
  workflowId: string;
  decisionId: string;
  /** Label for this branch (e.g., "if", "else", "case 'admin'") */
  branchLabel: string;
  /** Condition for this branch */
  condition?: string;
  /** Whether this branch was taken */
  taken: boolean;
  ts: number;
}

/**
 * Event emitted when a decision point completes.
 */
export interface DecisionEndEvent {
  type: "decision_end";
  workflowId: string;
  decisionId: string;
  /** Which branch was taken */
  branchTaken?: string | boolean;
  ts: number;
  durationMs: number;
}

/**
 * Event emitted when a step is skipped due to conditional logic.
 */
export interface StepSkippedEvent {
  type: "step_skipped";
  workflowId: string;
  stepKey?: string;
  name?: string;
  /** Reason why this step was skipped (e.g., "condition was false") */
  reason?: string;
  /** The decision that caused this skip */
  decisionId?: string;
  ts: number;
}

/**
 * Union of scope-related events.
 */
export type ScopeEvent = ScopeStartEvent | ScopeEndEvent;

/**
 * Union of decision-related events.
 */
export type DecisionEvent = DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent;

// =============================================================================
// Renderer Types
// =============================================================================

/**
 * Color scheme for rendering step states.
 */
export interface ColorScheme {
  pending: string;
  running: string;
  success: string;
  error: string;
  aborted: string;
  cached: string;
  skipped: string;
}

/**
 * Options passed to renderers.
 */
export interface RenderOptions {
  /** Show timing information (duration) */
  showTimings: boolean;
  /** Show step cache keys */
  showKeys: boolean;
  /** Terminal width for ASCII renderer */
  terminalWidth?: number;
  /** Color scheme */
  colors: ColorScheme;
}

/**
 * Extended options for Mermaid renderer.
 * Controls how edges are displayed for retries, errors, and timeouts.
 */
export interface MermaidRenderOptions extends RenderOptions {
  /** Show retry as self-loop edge (default: true) */
  showRetryEdges?: boolean;
  /** Show error flow to error node (default: true) */
  showErrorEdges?: boolean;
  /** Show timeout as alternative path (default: true) */
  showTimeoutEdges?: boolean;
}

/**
 * Renderer interface - transforms IR to output format.
 */
export interface Renderer {
  /** Unique identifier for this renderer */
  readonly name: string;
  /** Render IR to string output */
  render(ir: WorkflowIR, options: RenderOptions): string;
  /** Whether this renderer supports live (incremental) updates */
  supportsLive?: boolean;
  /** Render incremental update (optional) */
  renderUpdate?(
    ir: WorkflowIR,
    changedNodes: FlowNode[],
    options: RenderOptions
  ): string;
}

// =============================================================================
// Visualizer Types
// =============================================================================

/**
 * Output format for rendering.
 */
export type OutputFormat = "ascii" | "mermaid" | "json" | "logger" | "flowchart";

/**
 * Options for creating a visualizer.
 */
export interface VisualizerOptions {
  /** Name for the workflow in visualizations */
  workflowName?: string;
  /** Enable parallel detection heuristics (default: true) */
  detectParallel?: boolean;
  /** Show timing information (default: true) */
  showTimings?: boolean;
  /** Show step keys (default: false) */
  showKeys?: boolean;
  /** Custom color scheme */
  colors?: Partial<ColorScheme>;
  /**
   * Export configuration for URL generation methods.
   * Note: Treated as immutable after creation - do not mutate.
   */
  export?: {
    /** Default export provider (opt-in). If not set, export methods require explicit provider. */
    default?: ExportOptions;
  };
}

/**
 * Options for createVisualizingWorkflow convenience factory.
 * Combines WorkflowOptions with VisualizerOptions.
 *
 * @example
 * ```typescript
 * const { workflow, visualizer } = createVisualizingWorkflow(deps, {
 *   workflowName: 'checkout',
 *   showTimings: true,
 *   forwardTo: (event) => console.log(event.type),
 * });
 * ```
 */
export interface VisualizingWorkflowOptions<E, C = void>
  extends Omit<WorkflowOptions<E, C>, "onEvent">,
    VisualizerOptions {
  /** Forward events to additional handler (runs after visualization) */
  forwardTo?: (event: WorkflowEvent<E | UnexpectedError, C>, ctx: C) => void;
}

/**
 * Options for live visualization.
 */
export interface LiveVisualizerOptions extends VisualizerOptions {
  /** Output stream (default: process.stdout) */
  stream?: NodeJS.WriteStream;
  /** Update interval in ms (default: 100) */
  updateInterval?: number;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a node is a StepNode.
 */
export function isStepNode(node: FlowNode): node is StepNode {
  return node.type === "step";
}

/**
 * Check if a node is a SequenceNode.
 */
export function isSequenceNode(node: FlowNode): node is SequenceNode {
  return node.type === "sequence";
}

/**
 * Check if a node is a ParallelNode.
 */
export function isParallelNode(node: FlowNode): node is ParallelNode {
  return node.type === "parallel";
}

/**
 * Check if a node is a RaceNode.
 */
export function isRaceNode(node: FlowNode): node is RaceNode {
  return node.type === "race";
}

/**
 * Check if a node is a DecisionNode.
 */
export function isDecisionNode(node: FlowNode): node is DecisionNode {
  return node.type === "decision";
}

/**
 * Check if a node is a StreamNode.
 */
export function isStreamNode(node: FlowNode): node is StreamNode {
  return node.type === "stream";
}

/**
 * Check if a node has children.
 */
export function hasChildren(
  node: FlowNode
): node is SequenceNode | ParallelNode | RaceNode | DecisionNode {
  return "children" in node || (node.type === "decision" && "branches" in node);
}

// =============================================================================
// Time Travel Types
// =============================================================================

/**
 * Snapshot of an active step's state at a point in time.
 */
export interface ActiveStepSnapshot {
  id: string;
  name?: string;
  key?: string;
  startTs: number;
  retryCount: number;
  timedOut: boolean;
  timeoutMs?: number;
}

/**
 * A snapshot of the complete IR state at a specific point in time.
 * Used for time-travel debugging - each event creates a snapshot.
 */
export interface IRSnapshot {
  /** Unique identifier for this snapshot */
  id: string;
  /** Index in the event sequence (0-based) */
  eventIndex: number;
  /** The event that triggered this snapshot */
  event: unknown; // WorkflowEvent - avoid circular import
  /** Complete IR state at this moment */
  ir: WorkflowIR;
  /** Timestamp when snapshot was taken */
  timestamp: number;
  /** Active step states at this moment (for debugging) */
  activeSteps: Map<string, ActiveStepSnapshot>;
}

/**
 * State of the time-travel controller.
 */
export interface TimeTravelState {
  /** All recorded snapshots */
  snapshots: IRSnapshot[];
  /** Current snapshot index (for playback position) */
  currentIndex: number;
  /** Whether playback is active */
  isPlaying: boolean;
  /** Playback speed multiplier (1.0 = realtime, 2.0 = 2x speed) */
  playbackSpeed: number;
  /** Whether recording is active */
  isRecording: boolean;
}

// =============================================================================
// Performance Analysis Types
// =============================================================================

/**
 * Performance metrics for a single node across multiple runs.
 */
export interface NodePerformance {
  /** Node identifier (name or step ID) */
  nodeId: string;
  /** Average duration across all samples */
  avgDurationMs: number;
  /** Minimum duration observed */
  minDurationMs: number;
  /** Maximum duration observed */
  maxDurationMs: number;
  /** Standard deviation of durations */
  stdDevMs: number;
  /** Number of timing samples collected */
  samples: number;
  /** Retry frequency (0-1, where 1 = always retries) */
  retryRate: number;
  /** Timeout frequency (0-1) */
  timeoutRate: number;
  /** Error rate (0-1) */
  errorRate: number;
  /** Percentile data for distribution analysis */
  percentiles: {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
}

/**
 * Heatmap data for visualizing performance across nodes.
 */
export interface HeatmapData {
  /** Map of node ID to heat level (0-1, where 1 is hottest/slowest) */
  heat: Map<string, number>;
  /** The metric used for heat calculation */
  metric: "duration" | "retryRate" | "errorRate";
  /** Statistics used to compute heat values */
  stats: {
    /** Minimum value in the dataset */
    min: number;
    /** Maximum value in the dataset */
    max: number;
    /** Mean value */
    mean: number;
    /** Threshold above which a node is considered "hot" */
    threshold: number;
  };
}

/**
 * Heat level for visual styling.
 */
export type HeatLevel = "cold" | "cool" | "neutral" | "warm" | "hot" | "critical";

// =============================================================================
// HTML Renderer Types
// =============================================================================

/**
 * Theme for the HTML visualizer.
 */
export type HTMLTheme = "light" | "dark" | "auto";

/**
 * Layout direction for the workflow diagram.
 */
export type LayoutDirection = "TB" | "LR" | "BT" | "RL";

/**
 * Options for the HTML renderer.
 */
export interface HTMLRenderOptions extends RenderOptions {
  /** Enable interactive features (click to inspect, zoom/pan) */
  interactive: boolean;
  /** Include time-travel controls */
  timeTravel: boolean;
  /** Include performance heatmap overlay */
  heatmap: boolean;
  /** Animation duration for transitions (ms) */
  animationDuration: number;
  /** Color theme */
  theme: HTMLTheme;
  /** Diagram layout direction */
  layout: LayoutDirection;
  /** Heatmap data (if heatmap is enabled) */
  heatmapData?: HeatmapData;
  /** WebSocket URL for live updates (if streaming) */
  wsUrl?: string;
}

/**
 * Message sent from the web visualizer to the dev server.
 */
export interface WebVisualizerMessage {
  type:
    | "time_travel_seek"
    | "time_travel_play"
    | "time_travel_pause"
    | "time_travel_step_forward"
    | "time_travel_step_backward"
    | "request_snapshots"
    | "toggle_heatmap"
    | "set_heatmap_metric";
  payload?: unknown;
}

/**
 * Message sent from the dev server to the web visualizer.
 */
export interface ServerMessage {
  type:
    | "ir_update"
    | "snapshot"
    | "snapshots_list"
    | "performance_data"
    | "workflow_complete"
    | "time_travel_state";
  payload: unknown;
}

// =============================================================================
// Enhanced ASCII Renderer Types
// =============================================================================

/**
 * Extended render options for the enhanced ASCII renderer.
 */
export interface EnhancedRenderOptions extends RenderOptions {
  /** Show performance heatmap coloring */
  showHeatmap?: boolean;
  /** Heatmap data for coloring nodes */
  heatmapData?: HeatmapData;
  /** Show timing sparklines (requires historical data) */
  showSparklines?: boolean;
  /** Historical timing data for sparklines: nodeId → array of durations */
  timingHistory?: Map<string, number[]>;
}

/**
 * Options for the flowchart ASCII renderer.
 * Renders workflow as a proper flowchart with boxes and arrows.
 */
export interface FlowchartRenderOptions extends EnhancedRenderOptions {
  /** Show start and end nodes (default: true) */
  showStartEnd?: boolean;
  /** Reduce vertical spacing between nodes (default: false) */
  compact?: boolean;
  /** Box border style (default: 'single') */
  boxStyle?: "single" | "double" | "rounded";
}

// =============================================================================
// Hook Execution Types
// =============================================================================

/**
 * State of a hook execution.
 */
export type HookState = "pending" | "running" | "success" | "error";

/**
 * Execution record for a workflow hook.
 */
export interface HookExecution {
  /** Hook type identifier */
  type: "shouldRun" | "onBeforeStart" | "onAfterStep";
  /** Execution state */
  state: HookState;
  /** Timestamp when hook started */
  ts: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Error if hook failed */
  error?: unknown;
  /** Additional context (e.g., stepKey for onAfterStep) */
  context?: {
    /** Step key for onAfterStep hooks */
    stepKey?: string;
    /** Result of shouldRun hook */
    result?: boolean;
    /** Whether workflow was skipped due to shouldRun returning false */
    skipped?: boolean;
  };
}

/**
 * Hook execution summary for the workflow.
 */
export interface WorkflowHooks {
  /** shouldRun hook execution (if configured) */
  shouldRun?: HookExecution;
  /** onBeforeStart hook execution (if configured) */
  onBeforeStart?: HookExecution;
  /** onAfterStep hook executions (keyed by stepKey) */
  onAfterStep: Map<string, HookExecution>;
}

// =============================================================================
// Export Types
// =============================================================================

/**
 * Export format for diagram URLs.
 */
export type ExportFormat = "svg" | "png" | "pdf";

/**
 * Diagram source - future-proof union for multiple diagram types.
 * Uses "kind" internally, maps to "diagramType" for Kroki API.
 */
export type DiagramSource =
  | { kind: "mermaid"; source: string }
  | { kind: "graphviz"; source: string }
  | { kind: "plantuml"; source: string };

/**
 * Kroki-specific export options.
 * Note: No background/scale - Kroki doesn't support them for mermaid diagrams.
 */
export interface KrokiExportOptions {
  /** Provider identifier */
  provider: "kroki";
  /** Base URL for self-hosted Kroki (default: https://kroki.io) */
  baseUrl?: string;
}

/**
 * Mermaid.ink-specific export options.
 * Supports additional styling options like background, scale, and theme.
 */
export interface MermaidInkExportOptions {
  /** Provider identifier */
  provider: "mermaid-ink";
  /** Mermaid theme */
  mermaidTheme?: "default" | "dark" | "forest" | "neutral";
  /** Background color: "transparent" or hex color (e.g., "1b1b1f") */
  background?: "transparent" | string;
  /** Image scale (1-3) */
  scale?: number;
  /** Fit PDF to diagram size */
  fit?: boolean;
  /** Image width in pixels */
  width?: number;
  /** Image height in pixels */
  height?: number;
  /** Paper size for PDF */
  paper?: "a4" | "letter";
}

/**
 * Discriminated union of export options.
 * Provider is the discriminant - no implicit defaults.
 */
export type ExportOptions = KrokiExportOptions | MermaidInkExportOptions;
