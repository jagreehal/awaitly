/**
 * awaitly
 *
 * Typed async workflows with early-exit, using async/await and Result types.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createWorkflow, ok, err, type AsyncResult } from 'awaitly';
 *
 * const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
 *   id === '1' ? ok({ id, name: 'Alice' }) : err('NOT_FOUND');
 *
 * const workflow = createWorkflow({ fetchUser });
 *
 * const result = await workflow(async (step) => {
 *   const user = await step(fetchUser('1'));
 *   return user;
 * });
 * // result.error: 'NOT_FOUND' | UnexpectedError
 * ```
 *
 * ## Entry Points
 *
 * For optimal bundle size, import from specific entry points:
 *
 * **Core:**
 * - `awaitly` - Main entry: workflow engine + result primitives
 * - `awaitly/core` - Result types, transformers, tagged errors, pattern matching
 * - `awaitly/workflow` - Workflow engine only
 *
 * **Features:**
 * - `awaitly/visualize` - Workflow visualization (Mermaid, ASCII)
 * - `awaitly/batch` - Batch processing utilities
 * - `awaitly/resource` - RAII-style resource management
 * - `awaitly/retry` - Composable retry/backoff strategies
 *
 * **Reliability:**
 * - `awaitly/reliability` - All reliability patterns (umbrella)
 * - `awaitly/circuit-breaker` - Circuit breaker pattern
 * - `awaitly/ratelimit` - Rate limiting
 * - `awaitly/saga` - Saga compensation pattern
 * - `awaitly/policies` - Retry/timeout policies
 *
 * **Persistence:**
 * - `awaitly/persistence` - State persistence + versioning
 *
 * **Integrations:**
 * - `awaitly/hitl` - Human-in-the-loop orchestration
 * - `awaitly/webhook` - HTTP webhook handlers
 * - `awaitly/otel` - OpenTelemetry integration
 *
 * **Tools:**
 * - `awaitly/devtools` - Debugging tools
 * - `awaitly/testing` - Test harness
 *
 * **Utilities:**
 * - `awaitly/duration` - Type-safe time durations
 * - `awaitly/match` - Pattern matching
 * - `awaitly/conditional` - when/unless helpers
 * - `awaitly/tagged-error` - Tagged error classes
 */

// =============================================================================
// Core - Result primitives and run()
// =============================================================================

export {
  // Types
  type Ok,
  type Err,
  type Result,
  type AsyncResult,
  type UnexpectedError,
  type UnexpectedCause,
  type UnexpectedStepFailureCause,
  type PromiseRejectedError,
  type PromiseRejectionCause,
  type EmptyInputError,
  type MaybeAsyncResult,

  // Type utilities
  type ErrorOf,
  type Errors,
  type ExtractValue,
  type ExtractError,
  type ExtractCause,
  type CauseOf,

  // Step types
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

  // Constructors
  ok,
  err,

  // Type guards
  isOk,
  isErr,
  isUnexpectedError,
  isStepTimeoutError,
  getStepTimeoutMeta,

  // Unwrap
  UnwrapError,
  unwrap,
  unwrapOr,
  unwrapOrElse,

  // Wrap
  from,
  fromPromise,
  tryAsync,
  fromNullable,

  // Transform
  map,
  mapError,
  match,
  andThen,
  tap,
  tapError,
  mapTry,
  mapErrorTry,
  bimap,
  orElse,
  orElseAsync,
  recover,
  recoverAsync,

  // Batch
  type SettledError,
  all,
  allAsync,
  allSettled,
  allSettledAsync,
  any,
  anyAsync,
  partition,
  zip,
  zipAsync,

  // Run
  run,

  // Hydration / Serialization
  hydrate,
  isSerializedResult,
} from "./core";

// =============================================================================
// Tagged Errors
// =============================================================================

export {
  // Factory function
  TaggedError,

  // Types
  type TaggedErrorBase,
  type TaggedErrorOptions,
  type TaggedErrorCreateOptions,
  type TaggedErrorConstructor,

  // Type utilities
  type TagOf,
  type ErrorByTag,
  type PropsOf,
} from "./tagged-error";

// =============================================================================
// Workflow - createWorkflow
// =============================================================================

export {
  // Types
  type AnyResultFn,
  type ErrorsOfDeps,
  type CausesOfDeps,
  type WorkflowOptions,
  type WorkflowOptionsStrict,
  type Workflow,
  type WorkflowStrict,
  type WorkflowContext,
  type StepCache,
  type ResumeState,
  type ResumeStateEntry,

  // HITL types (commonly used)
  type PendingApproval,
  type ApprovalRejected,
  type ApprovalStepOptions,
  type GatedStepOptions,

  // Functions
  createWorkflow,
  isStepComplete,
  createStepCollector,

  // HITL functions (commonly used)
  isPendingApproval,
  isApprovalRejected,
  pendingApproval,
  createApprovalStep,
  gatedStep,
  injectApproval,
  clearStep,
  hasPendingApproval,
  getPendingApprovals,
  createHITLCollector,
} from "./workflow";

// =============================================================================
// Duration - Type-safe time units (commonly used with timeouts)
// =============================================================================

export {
  // Types
  type Duration as DurationType,

  // Namespace
  Duration,

  // Individual exports (for tree-shaking)
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

// =============================================================================
// Persistence - Convenience re-exports (full API in awaitly/persistence)
// =============================================================================

export { stringifyState, parseState } from "./persistence";
