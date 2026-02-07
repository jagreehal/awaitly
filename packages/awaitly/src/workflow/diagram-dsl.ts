/**
 * Workflow Diagram DSL types.
 *
 * Single source of truth for the state-machine-like representation of a workflow
 * used for visualization (e.g. xstate-style diagrams). Defined in awaitly so that
 * analyzer, visualizer, and any UI can import the same types.
 *
 * ## Snapshot alignment (current step highlighting)
 *
 * When a workflow is running, `WorkflowSnapshot.execution.currentStepId` holds the
 * step key of the currently executing step. For the diagram to highlight the correct
 * node, **DSL step state ids must match this value**. The analyzer emits step states
 * with `id` equal to the step key when present (otherwise stepId), so that
 * `snapshot.execution.currentStepId` can be used directly to find the corresponding
 * state in the DSL. Runtime and live execution state are the domain of
 * awaitly-visualizer / awaitly-visualizer; the DSL is static structure only.
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
  /** Stable id; for steps use step key so it matches snapshot.currentStepId */
  id: string;
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
