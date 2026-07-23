/**
 * awaitly
 *
 * Result types for typed error handling without exceptions — built for
 * plain async/await, automatic error inference, and code that agents can
 * write and humans can eyeball.
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
 * // Deps-first composition: no type params, no step IDs, no thunks
 * const result = await run({ getUser, getPosts }, async (s) => {
 *   const user = await s.getUser(id);
 *   const posts = await s.getPosts(user.id);
 *   return { user, posts };
 * });
 * ```
 *
 * ## Entry Points
 *
 * - `awaitly` — the front door: Result primitives, run() + step engine,
 *   per-dep policies (retry/timeout/fallback), TaggedError, errors,
 *   pattern matching, durations, reliability instances
 * - `awaitly/result` — the size guarantee: Result primitives only, whole
 *   entry stays tiny with zero bundler trust required
 * - `awaitly/run` — async step composition without the rest of the root
 * - `awaitly/reliability` — policies, circuit breakers, rate limiting,
 *   caching, and singleflight
 * - `awaitly/workflow` — workflow composition, resources, and batching
 * - focused production entries: `awaitly/durable`, `awaitly/persistence`,
 *   `awaitly/saga`, `awaitly/hitl`, `awaitly/streaming`, `awaitly/webhook`,
 *   and `awaitly/engine`
 * - `awaitly/testing` — test utilities
 */

// =============================================================================
// Named value exports (tree-shake friendly)
//
// Canonical core: there is no `Awaitly` namespace object and no pipe/flow
// re-exports. One way to write it — named imports of the canonical
// surface. A runtime namespace holding every export defeats tree-shaking
// (the whole module graph gets materialized as getters) and is a second
// dialect for every operation.
// =============================================================================

export {
  UnexpectedError,
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
  flatten,
  deserialize,
  DESERIALIZATION_ERROR,
  serialize,
  matchErrorPartial,
} from "./result";

export { withDeps } from "./di";

export { TaggedError } from "./tagged-error";

// =============================================================================
// Type exports (cannot live on runtime object)
// =============================================================================

export type {
  Ok,
  Err,
  Result,
  AsyncResult,
  PromiseRejectedError,
  PromiseRejectionCause,
  EmptyInputError,
  MaybeAsyncResult,
  ErrorOf,
  Errors,
  ErrorsOf,
  ExtractValue,
  ExtractError,
  ExtractCause,
  CauseOf,
  MatchErrorHandlers,
  SettledError,
  DeserializationError,
  SerializedResult,
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

export type { RetryOptions, BackoffStrategy, BoundSteps } from "./core";
// Per-dep policies re-export from the leaf module (NOT the ./core barrel):
// the root entry has a strict bundle budget and the core engine must not
// be pulled into it.
export {
  retry,
  timeout,
  fallback,
  type RetryPolicyOptions,
  type PolicyFn,
  type PolicyDelay,
} from "./core/policies";

// Slug spine — type-only names surfaced here; the runtime helpers
// (slugDocsUrl, isAwaitlySlug, AWAITLY_SLUGS, etc.) are re-exported from the
// root entry below (`export * from "./slugs"`).
export type { AwaitlySlug, AwaitlySlugCategory } from "./slugs";

// =============================================================================
// Canonical core (v2): the root entry is the front door.
//
// The exports map is four entries — `awaitly`, `awaitly/result`,
// `awaitly/workflow`, `awaitly/testing`. Former sub-path entries are
// absorbed here (explicit exports above always win over star re-exports,
// so curated names take precedence on any clash). Consumers pay only for
// what they import: the package ships unminified ESM with sideEffects:
// false, so bundlers tree-shake.
//
// Dropped (not absorbed): flow, functional, bind-deps, resolver,
// diagnostics (internal), otel / fetch / adapters (future ecosystem
// packages), and the Schedule combinators from awaitly/retry (their
// map/tap/andThen/once names clash with Result combinators; per-dep
// policies cover retry/timeout).
// =============================================================================

// run() and the step engine surface (formerly awaitly/run, awaitly/core)
export { run } from "./core";
export {
  type RunStep,
  type StepOptions,
  type RunOptions,
  type RunOptionsWithCatch,
  type RunOptionsWithoutCatch,
  type WorkflowEvent,
  type ScopeType,
  type TimeoutOptions,
  type StepTimeoutError,
  type StepTimeoutMarkerMeta,
  STEP_TIMEOUT_MARKER,
  isStepTimeoutError,
  getStepTimeoutMeta,
  type EarlyExit,
  type StepFailureMeta,
  EARLY_EXIT_SYMBOL,
  createEarlyExit,
  isEarlyExit,
} from "./core";

// Pre-built error types (formerly awaitly/errors)
export * from "./errors-entry";
// Durations (formerly awaitly/duration)
export * from "./duration-entry";
// Pattern matching (formerly awaitly/match — clashing names ship pre-renamed:
// matchTag, matchTags, matchOrElse)
export * from "./match-entry";
// Reliability instances (formerly awaitly/circuit-breaker, awaitly/ratelimit)
export * from "./circuit-breaker-entry";
export * from "./ratelimit-entry";
// Caching + deduplication (formerly awaitly/cache, awaitly/singleflight)
export * from "./cache-entry";
export * from "./singleflight-entry";
// Legacy StepOptions policy bundles (formerly awaitly/policies)
export * from "./policies-entry";
// Declarative conditionals (formerly awaitly/conditional) — when/unless are
// first-class analyzable constructs: the analyzer renders them as branches.
export * from "./conditional-entry";
// AI-DX slug spine runtime (formerly awaitly/slugs) — needed by tooling
// (analyzer, lint). Pure data + helpers; tree-shakes when unused.
export * from "./slugs";
