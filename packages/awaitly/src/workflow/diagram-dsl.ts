/**
 * Workflow Diagram DSL types.
 *
 * Single source of truth for the state-machine-like representation of a workflow
 * used for visualization (e.g. xstate-style diagrams). Defined in awaitly so that
 * analyzer, visualizer, and any UI can import the same types.
 *
 * ## Identity contract (graph validation + highlighting)
 *
 * DSL state ids normally use the **semantic ids authored in the code**. When a
 * collision requires a unique diagram id, `semanticId` preserves the authored
 * identity used by runtime graph validation, so a DSL from awaitly-analyze can
 * still be passed directly as `graph`. For snapshot
 * highlighting, `WorkflowSnapshot.execution.currentStepId` holds the step key
 * (key ?? authored id), so match it against
 * `state.key ?? state.semanticId ?? state.id` — literal keys are carried on
 * `state.key`; dynamic per-run keys can't exist in a static graph
 * (match via event `name` instead). Runtime and live execution state are the
 * domain of awaitly-visualizer; the DSL is static structure only.
 */

// =============================================================================
// State node types
// =============================================================================

/**
 * Kind of node in the workflow diagram (for layout and styling).
 */
export type WorkflowDiagramStateType =
  | "initial"
  | "step"
  | "decision"
  | "join"
  | "terminal";

/**
 * Optional source location for "Go to definition" and editor integration.
 */
export interface WorkflowDiagramSourceLocation {
  /** Absolute or relative file path */
  filePath: string;
  /** 1-based line number */
  line: number;
  /** 0-based column number */
  column: number;
  /** End line (optional) */
  endLine?: number;
  /** End column (optional) */
  endColumn?: number;
}

/**
 * A state (node) in the workflow diagram.
 */
export interface WorkflowDiagramState {
  /**
   * Unique diagram-node id, normally the semantic id authored in the code.
   * A collision with another node is resolved with a `#2`, `#3`, ... suffix.
   */
  id: string;
  /** Authored id when `id` needed a collision suffix; graph validation uses this. */
  semanticId?: string;
  /**
   * Literal cache key when the step declares one (step options `key`).
   * Snapshot-driven highlighting should match
   * `snapshot.execution.currentStepId === (state.key ?? state.semanticId ?? state.id)`.
   * Dynamic keys (computed per run) are not representable statically.
   */
  key?: string;
  /** Human-readable label for the node */
  label: string;
  /** Node kind for layout and styling */
  type: WorkflowDiagramStateType;
  /** Optional type string for step output (from ts-morph); used for payload/tooltips */
  outputType?: string;
  /** Optional type string(s) for step input (from ts-morph) */
  inputType?: string;
  /** Optional source location */
  location?: WorkflowDiagramSourceLocation;
}

// =============================================================================
// Transitions
// =============================================================================

/**
 * A transition (edge) in the workflow diagram.
 * Event is the label shown on the edge and used for "next event" / click-to-transition.
 */
export interface WorkflowDiagramTransition {
  /** Id of the source state */
  fromStateId: string;
  /** Id of the target state */
  toStateId: string;
  /** Event label (e.g. step key, "true", "false", "done", "next", "branch:0") */
  event: string;
  /** Optional condition label for decision branches */
  conditionLabel?: string;
}

// =============================================================================
// Root DSL
// =============================================================================

/**
 * Workflow Diagram DSL: states and transitions for visualization.
 * Emitted by awaitly-analyze; consumed by UI/visualizer (no ts-morph in consumer).
 */
export interface WorkflowDiagramDSL {
  /** Workflow name (from analysis) */
  workflowName: string;
  /** All states (nodes) in the diagram */
  states: WorkflowDiagramState[];
  /** All transitions (edges) */
  transitions: WorkflowDiagramTransition[];
  /** Id of the initial state (e.g. "start") */
  initialStateId: string;
  /** Ids of terminal states (e.g. ["end"]) */
  terminalStateIds: string[];
  /** Optional workflow return type string (from ts-morph) */
  workflowReturnType?: string;
}
