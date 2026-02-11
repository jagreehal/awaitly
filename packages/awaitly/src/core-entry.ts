/**
 * awaitly/core
 *
 * Result primitives and type utilities: the foundation for typed error handling.
 * Use this when you need Result types without the full workflow engine.
 *
 * @example
 * ```typescript
 * import { ok, err, map, andThen, type AsyncResult } from 'awaitly/core';
 *
 * const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
 *   id === '1' ? ok({ id, name: 'Alice' }) : err('NOT_FOUND');
 *
 * const result = await fetchUser('1');
 * const name = map(result, user => user.name);
 * ```
 */

// =============================================================================
// Core Result Types and Functions
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

  // Named error constants (for static analysis)
  AWAITLY_UNEXPECTED,
  AWAITLY_CANCELLED,
  AWAITLY_TIMEOUT,

  // Static analysis helpers
  tags,

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
  matchError,
  type MatchErrorHandlers,
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
// Pattern Matching
// =============================================================================
export {
  // Types
  type Tagged,
  type Matcher,
  type MatchTag,

  // Namespace
  Match,

  // Individual exports
  matchValue,
  tag as matchTag,
  tags as matchTags,
  when as matchWhen,
  exhaustive,
  orElse as matchOrElse,
  orElseValue,
  is as isTag,
  isOneOf,
} from "./match";
