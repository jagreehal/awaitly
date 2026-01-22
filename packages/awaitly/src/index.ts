/**
 * awaitly
 *
 * Result types for typed error handling without exceptions.
 * Optimized for serverless with minimal bundle size.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { ok, err, run, type AsyncResult } from 'awaitly';
 *
 * // Define Result-returning functions
 * async function getUser(id: string): AsyncResult<User, 'NOT_FOUND'> {
 *   const user = await db.find(id);
 *   return user ? ok(user) : err('NOT_FOUND');
 * }
 *
 * // Compose with run() - clean do-notation style
 * const result = await run(async (step) => {
 *   const user = await step(getUser(id));
 *   const posts = await step(getPosts(user.id));
 *   return { user, posts };
 * });
 * ```
 *
 * ## Entry Points
 *
 * **Core (this package):**
 * - `awaitly` - Result types, run(), transformers, tagged errors
 *
 * **Workflow Engine:**
 * - `awaitly/workflow` - createWorkflow, Duration, state management
 * - `awaitly/hitl` - Human-in-the-loop approval flows
 *
 * **Reliability:**
 * - `awaitly/retry` - Composable retry/backoff strategies
 * - `awaitly/circuit-breaker` - Circuit breaker pattern
 * - `awaitly/ratelimit` - Rate limiting
 * - `awaitly/saga` - Saga compensation pattern
 *
 * **Utilities:**
 * - `awaitly/duration` - Type-safe time durations
 * - `awaitly/match` - Pattern matching
 * - `awaitly/persistence` - State persistence
 * - `awaitly/durable` - Durable execution with automatic checkpointing
 */

// =============================================================================
// Core - Result primitives
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

  // Step types (for run())
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
  PROMISE_REJECTED,

  // Constructors
  ok,
  err,

  // Type guards
  isOk,
  isErr,
  isUnexpectedError,
  isPromiseRejectedError,
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

  // Run (do-notation for composing Results)
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

