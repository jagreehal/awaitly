/**
 * awaitly/workflow
 *
 * Workflow orchestration engine: compose async operations with automatic
 * error inference, step caching, and resume state.
 *
 * @example
 * **Workflow class (primary API):**
 * ```typescript
 * import { WorkflowClass, type WorkflowRunEvent } from 'awaitly/workflow';
 * import { ok, err, type AsyncResult } from 'awaitly/core';
 *
 * const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
 *   id === '1' ? ok({ id, name: 'Alice' }) : err('NOT_FOUND');
 *
 * const deps = { fetchUser };
 *
 * class GetUserWorkflow extends WorkflowClass<typeof deps> {
 *   async run(event: WorkflowRunEvent<{ userId: string }>, step) {
 *     const user = await step('fetchUser', () =>
 *       this.deps.fetchUser(event.payload.userId)
 *     );
 *     return user;
 *   }
 * }
 *
 * const w = new GetUserWorkflow('fetch-user', deps);
 * const result = await w.execute({ userId: '1' });
 * ```
 *
 * @example
 * **Simple workflows with run() function:**
 * ```typescript
 * import { run } from 'awaitly/workflow';
 *
 * const result = await run(async (step) => {
 *   // Simple workflows without deps
 *   const data = await step('fetch', () => fetchData());
 *   return data;
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
  // Types (Workflow = callable type from createWorkflow; class is exported as value below)
  type AnyResultFn,
  type ErrorsOfDeps,
  type CausesOfDeps,
  type WorkflowOptions,
  type ExecutionOptions,
  type WorkflowFn,
  type WorkflowFnWithArgs,
  type WorkflowContext,
  type StepCache,
  type WorkflowCancelledError,

  // New Snapshot API types
  type GetSnapshotOptions,
  type SubscribeEvent,
  type SubscribeOptions,

  // Callable workflow type (return type of createWorkflow); Workflow = same type for backward compat
  type Workflow,
  type WorkflowCallable,

  // WorkflowRunEvent type for class-based workflows
  type WorkflowRunEvent,

  // Functions / Class
  /**
   * @deprecated Use WorkflowClass instead. createWorkflow will be removed in v3.0.0.
   * See WorkflowClass for the new event-driven API.
   */
  createWorkflow,
  WorkflowClass,
  isStepComplete,
  isWorkflowCancelled,

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
