/**
 * awaitly/workflow
 *
 * Workflow orchestration with createWorkflow.
 * Use this for typed async workflows with automatic error inference.
 */

// Re-export types and constants that workflow users commonly need
export { UNEXPECTED_ERROR } from "../core";
export type {
  Result,
  AsyncResult,
  UnexpectedError,
  RunStep,
  WorkflowEvent,
  StepOptions,
} from "../core";

// Export WorkflowRunEvent (different from WorkflowEvent in core, which is for event emissions)
export type { WorkflowRunEvent } from "./workflow-event";

// Re-export streaming types for workflow users
export type { StreamStore } from "../streaming/types";

// Re-export workflow types from types.ts (callable type as Workflow for backward compat; class as value below)
export type {
  StepCache,
  ResumeStateEntry,
  ResumeState,
  AnyResultFn,
  ErrorsOfDeps,
  CausesOfDeps,
  ExecutionOptions,
  WorkflowOptions,
  WorkflowContext,
  WorkflowFn,
  WorkflowFnWithArgs,
  GetSnapshotOptions,
  SubscribeEvent,
  SubscribeOptions,
  Workflow,
  Workflow as WorkflowCallable,
  WorkflowCancelledError,
  PendingApproval,
  PendingHook,
  ApprovalRejected,
  ApprovalStepOptions,
  GatedStepOptions,
} from "./types";

export { isStepComplete, isWorkflowCancelled, isPendingApproval, isApprovalRejected, isPendingHook } from "./guards";
export {
  createResumeStateCollector,
  injectApproval,
  injectHook,
  clearStep,
  hasPendingApproval,
  getPendingApprovals,
  hasPendingHook,
  getPendingHooks,
  createApprovalStateCollector,
} from "./resume-state";
export { pendingApproval, createApprovalStep, gatedStep } from "./hitl";
export { pendingHook, createHook, HOOK_STEP_KEY_PREFIX } from "./hook";

// Re-export snapshot types and utilities for convenience
export type {
  JSONValue,
  WorkflowSnapshot,
  StepResult,
  SerializedCause,
  SnapshotWarning,
} from "../persistence";

export {
  looksLikeWorkflowSnapshot,
  validateSnapshot,
  assertValidSnapshot,
  mergeSnapshots,
  SnapshotFormatError,
  SnapshotMismatchError,
  SnapshotDecodeError,
} from "../persistence";

/**
 * @deprecated Use WorkflowClass instead. createWorkflow will be removed in v3.0.0.
 *
 * The new Workflow class API provides a cleaner, event-driven signature:
 *
 * @example
 * ```typescript
 * // Old (deprecated):
 * const workflow = createWorkflow('my-workflow', { fetchUser });
 * await workflow(async (step, deps, ctx) => { ... });
 *
 * // New (recommended):
 * class MyWorkflow extends WorkflowClass<typeof deps> {
 *   async run(event: WorkflowRunEvent<InputType>, step) {
 *     // Access input via event.payload
 *     // Access deps via this.deps
 *   }
 * }
 * const workflow = new MyWorkflow('my-workflow', deps);
 * await workflow.execute(payload);
 * ```
 */
export { createWorkflow } from "./execute";

/** Primary Workflow API - class-based with run(event, step) signature */
export { Workflow as WorkflowClass } from "./workflow-class";

// Workflow Diagram DSL (for visualization; types shared with analyzer/visualizer)
export type {
  WorkflowDiagramDSL,
  WorkflowDiagramState,
  WorkflowDiagramStateType,
  WorkflowDiagramTransition,
  WorkflowDiagramSourceLocation,
} from "./diagram-dsl";
