/**
 * awaitly/workflow
 *
 * Workflow orchestration engine: compose async operations with automatic
 * error inference, step caching, and resume state.
 *
 * @example
 * ```typescript
 * import { createWorkflow, run } from 'awaitly/workflow';
 * import { ok, err, type AsyncResult } from 'awaitly/core';
 *
 * const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
 *   id === '1' ? ok({ id, name: 'Alice' }) : err('NOT_FOUND');
 *
 * const workflow = createWorkflow('fetch-user', { fetchUser });
 *
 * const result = await workflow.run(async ({ step }) => {
 *   const user = await step('fetchUser', () => fetchUser('1'));
 *   return user;
 * });
 * ```
 */

// =============================================================================
// Core run() function
// =============================================================================
export {
  // Types
  type RunStep,
  type StepOptions,
  type WorkflowEvent,
  type ScopeType,
  type RunOptions,
  type RunOptionsWithCatch,
  type RunOptionsWithoutCatch,

  // Retry and timeout types
  type BackoffStrategy,
  type RetryOptions,
  type TimeoutOptions,
  type StepTimeoutError,
  type StepTimeoutMarkerMeta,
  STEP_TIMEOUT_MARKER,

  // Type guards
  isStepTimeoutError,
  getStepTimeoutMeta,

  // Function
  run,
} from "./core";

// =============================================================================
// Workflow Engine
// =============================================================================
export {
  // Types
  type AnyResultFn,
  type ErrorsOfDeps,
  type CausesOfDeps,
  type WorkflowOptions,
  type ExecutionOptions,
  type Workflow,
  type WorkflowFn,
  type RunConfig,
  type WorkflowContext,
  type StepCache,
  type WorkflowCancelledError,
  type RunWithStateResult,

  // Functions
  createWorkflow,
  isStepComplete,
  isWorkflowCancelled,
  isResumeState,

  // Hook primitive (suspend until HTTP callback; app calls injectHook to resume)
  type PendingHook,
  type ResumeState,
  type ResumeStateEntry,
  pendingHook,
  createHook,
  HOOK_STEP_KEY_PREFIX,
  isPendingHook,
  injectHook,
  hasPendingHook,
  getPendingHooks,
  createResumeStateCollector,
  injectApproval,
  clearStep,
  hasPendingApproval,
  getPendingApprovals,
  createApprovalStateCollector,
  pendingApproval,
  createApprovalStep,
  gatedStep,
  isPendingApproval,
  isApprovalRejected,
  type SerializedResumeState,
  serializeResumeState,
  deserializeResumeState,
  isSerializedResumeState,
  type StoreSaveInput,
  type StoreLoadResult,
  type PersistedWorkflowState,
  toResumeState,
} from "./workflow";

// Re-export UNEXPECTED_ERROR constant for convenience
export { UNEXPECTED_ERROR } from "./core";

// =============================================================================
// Snapshot API (re-exported from persistence for convenience)
// =============================================================================
export {
  // Types
  type JSONValue,
  type WorkflowSnapshot,
  type StepResult,
  type SerializedCause,
  type SnapshotWarning,

  // Validation
  looksLikeWorkflowSnapshot,
  isWorkflowSnapshot,
  validateSnapshot,
  assertValidSnapshot,
  mergeSnapshots,

  // Error classes
  SnapshotFormatError,
  SnapshotMismatchError,
  SnapshotDecodeError,
} from "./persistence";

// =============================================================================
// Workflow Diagram DSL (for visualization)
// =============================================================================
export type {
  WorkflowDiagramDSL,
  WorkflowDiagramState,
  WorkflowDiagramStateType,
  WorkflowDiagramTransition,
  WorkflowDiagramSourceLocation,
} from "./workflow";

// =============================================================================
// Duration - Re-exported for convenience (timeouts/delays)
// =============================================================================

export {
  type Duration as DurationType,
  Duration,
  millis,
  seconds,
  minutes,
  hours,
  days,
  toMillis,
  toSeconds,
  toMinutes,
  toHours,
  toDays,
  isDuration,
} from "./duration";
