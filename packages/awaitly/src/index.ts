/**
 * awaitly
 *
 * Result types for typed error handling without exceptions.
 * Optimized for serverless with minimal bundle size.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { ok, err, type AsyncResult } from 'awaitly';
 * import { run } from 'awaitly/run';
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
 * - `awaitly` - Result types, transformers, tagged errors (minimal ~2KB)
 * - `awaitly/run` - run() function with step orchestration
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
// Core - Result primitives (from result.ts for minimal bundle size)
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

  // Error discriminants
  UNEXPECTED_ERROR,
  PROMISE_REJECTED,

  // Constructors
  ok,
  err,

  // Type guards
  isOk,
  isErr,
  isUnexpectedError,
  isPromiseRejectedError,

  // Error matching
  type MatchErrorHandlers,
  matchError,

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

  // Hydration / Serialization
  hydrate,
  isSerializedResult,
} from "./result";

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


