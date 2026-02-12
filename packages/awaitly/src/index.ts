/**
 * awaitly
 *
 * Result types for typed error handling without exceptions.
 * Optimized for serverless with minimal bundle size.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { Awaitly, type AsyncResult } from 'awaitly';
 * import { run } from 'awaitly/run';
 *
 * // Define Result-returning functions
 * async function getUser(id: string): AsyncResult<User, 'NOT_FOUND'> {
 *   const user = await db.find(id);
 *   return user ? Awaitly.ok(user) : Awaitly.err('NOT_FOUND');
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
 * - `awaitly` - Awaitly namespace (Result types, transformers, tagged errors, pipe/flow)
 * - `awaitly/result` - Result types only (minimal bundle, no namespace)
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

import * as result from "./result";
import { TaggedError } from "./tagged-error";
import {
  pipe,
  flow,
  compose,
  identity,
  R,
  recoverWith,
  getOrElse,
  getOrElseLazy,
  mapAsync,
  flatMapAsync,
  tapAsync,
  tapErrorAsync,
  race,
  traverse,
  traverseAsync,
  traverseParallel,
} from "./functional";

// =============================================================================
// Awaitly namespace (Effect-style single export)
// =============================================================================

const Awaitly = {
  // Result (all value exports)
  ...result,
  // Tagged errors
  TaggedError,
  // Functional (non-clashing: pipe, flow, R, async helpers, etc.)
  pipe,
  flow,
  compose,
  identity,
  R,
  recoverWith,
  getOrElse,
  getOrElseLazy,
  mapAsync,
  flatMapAsync,
  tapAsync,
  tapErrorAsync,
  race,
  traverse,
  traverseAsync,
  traverseParallel,
} as const;

export { Awaitly };

// =============================================================================
// Named value exports (tree-shake friendly)
// =============================================================================

export {
  UNEXPECTED_ERROR,
  PROMISE_REJECTED,
  AWAITLY_UNEXPECTED,
  AWAITLY_CANCELLED,
  AWAITLY_TIMEOUT,
  tags,
  ok,
  err,
  isOk,
  isErr,
  isUnexpectedError,
  isPromiseRejectedError,
  matchError,
  UnwrapError,
  unwrap,
  unwrapOr,
  unwrapOrElse,
  runOrThrow,
  runOrThrowAsync,
  runOrNull,
  runOrUndefined,
  from,
  fromPromise,
  tryAsync,
  fromNullable,
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
  hydrate,
  isSerializedResult,
  all,
  allAsync,
  allSettled,
  allSettledAsync,
  partition,
  any,
  anyAsync,
  zip,
  zipAsync,
} from "./result";

export { TaggedError } from "./tagged-error";

export {
  pipe,
  flow,
  compose,
  identity,
  R,
  recoverWith,
  getOrElse,
  getOrElseLazy,
  mapAsync,
  flatMapAsync,
  tapAsync,
  tapErrorAsync,
  race,
  traverse,
  traverseAsync,
  traverseParallel,
} from "./functional";

// =============================================================================
// Type exports (cannot live on runtime object)
// =============================================================================

export type {
  Ok,
  Err,
  Result,
  AsyncResult,
  UnexpectedError,
  UnexpectedCause,
  UnexpectedStepFailureCause,
  PromiseRejectedError,
  PromiseRejectionCause,
  EmptyInputError,
  MaybeAsyncResult,
  ErrorOf,
  Errors,
  ExtractValue,
  ExtractError,
  ExtractCause,
  CauseOf,
  MatchErrorHandlers,
  SettledError,
} from "./result";

export type {
  TaggedErrorBase,
  TaggedErrorOptions,
  TaggedErrorCreateOptions,
  TaggedErrorConstructor,
  TagOf,
  ErrorByTag,
  PropsOf,
} from "./tagged-error";
