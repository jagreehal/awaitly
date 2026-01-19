/**
 * awaitly
 *
 * Result types for typed error handling without exceptions.
 * Optimized for serverless with minimal bundle size.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { ok, err, map, andThen, from, type AsyncResult } from 'awaitly';
 *
 * // Typed error handling with Result types
 * async function getUser(id: string): AsyncResult<User, 'NOT_FOUND' | 'DB_ERROR'> {
 *   const user = await db.find(id);
 *   return user ? ok(user) : err('NOT_FOUND');
 * }
 *
 * // Wrap throwing code
 * const parsed = from(() => JSON.parse(str), () => 'PARSE_ERROR');
 * ```
 *
 * ## Entry Points
 *
 * **Core (this package):**
 * - `awaitly` - Result types, transformers, tagged errors (~3 KB gzipped)
 *
 * **Workflow Engine:**
 * - `awaitly/workflow` - Orchestration with retry, timeout, caching
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

  // Constructors
  ok,
  err,

  // Type guards
  isOk,
  isErr,
  isUnexpectedError,

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
