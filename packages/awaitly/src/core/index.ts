/**
 * awaitly/core
 *
 * Core Result primitives and run() function.
 * Use this module for minimal bundle size when you don't need the full workflow capabilities
 * (like retries, timeout, or state persistence) provided by `createWorkflow`.
 *
 * This module provides:
 * 1. `Result` types for error handling without try/catch
 * 2. `run()` function for executing steps with standardized error management
 * 3. Utilities for transforming and combining Results
 */

// Inline duration type and parser to avoid importing the full duration module
// This keeps the core bundle minimal (~1KB saved)

/** Duration object with tagged type for type safety */
type DurationObject = { readonly _tag: "Duration"; readonly millis: number };

/** Duration input: either a string ("5s", "100ms") or a Duration object */
type DurationInput = string | DurationObject;

/** Parse a duration string like "100ms", "5s", "2m", "1h", "1d" */
function parseDurationString(input: string): DurationObject | undefined {
  const match = input.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i);
  if (!match) return undefined;
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return { _tag: "Duration", millis: value * (multipliers[unit] ?? 1) };
}

// =============================================================================
// Core Result Types
// =============================================================================

/**
 * Represents a successful result.
 * Use `ok(value)` to create instances.
 *
 * @template T - The type of the success value
 *
 * @example
 * ```typescript
 * const success = ok(42);
 * // Type shown: Ok<number>
 * ```
 */
export type Ok<T> = { ok: true; value: T };

/**
 * Represents a failed result.
 * Use `err(error)` to create instances.
 *
 * @template E - The type of the error value
 * @template C - The type of the cause (defaults to unknown)
 * @template T - Phantom type for the success value (preserved after narrowing)
 *
 * @example
 * ```typescript
 * const failure = err({ type: "NOT_FOUND", message: "User not found" });
 * // Type shown: Err<{ type: string; message: string }>
 * ```
 */
export type Err<E, C = unknown> = { ok: false; error: E; cause?: C };

/**
 * Represents a successful computation or a failed one.
 * Use this type to represent the outcome of an operation that might fail,
 * instead of throwing exceptions.
 *
 * @template T - The type of the success value
 * @template E - The type of the error value (defaults to unknown)
 * @template C - The type of the cause (defaults to unknown)
 */
export type Result<T, E = unknown, C = unknown> = Ok<T> | Err<E, C>;

/**
 * A Promise that resolves to a Result.
 * Use this for asynchronous operations that might fail.
 */
export type AsyncResult<T, E = unknown, C = unknown> = Promise<Result<T, E, C>>;

export type UnexpectedStepFailureCause =
  | {
      type: "STEP_FAILURE";
      origin: "result";
      error: unknown;
      cause?: unknown;
    }
  | {
      type: "STEP_FAILURE";
      origin: "throw";
      error: unknown;
      thrown: unknown;
    };

export type UnexpectedCause =
  | { type: "UNCAUGHT_EXCEPTION"; thrown: unknown }
  | UnexpectedStepFailureCause;

/** Discriminant for UnexpectedError type - use in switch statements */
export const UNEXPECTED_ERROR = "UNEXPECTED_ERROR" as const;

/** Discriminant for PromiseRejectedError type - use in switch statements */
export const PROMISE_REJECTED = "PROMISE_REJECTED" as const;

// =============================================================================
// Named Error Constants (for static analysis)
// =============================================================================

/**
 * Named error constant for unexpected/unhandled errors.
 * Used by the analyzer when a step doesn't declare errors.
 */
export const AWAITLY_UNEXPECTED = "AWAITLY_UNEXPECTED" as const;

/**
 * Named error constant for cancelled operations.
 */
export const AWAITLY_CANCELLED = "AWAITLY_CANCELLED" as const;

/**
 * Named error constant for timed-out operations.
 */
export const AWAITLY_TIMEOUT = "AWAITLY_TIMEOUT" as const;

// =============================================================================
// Static Analysis Helpers
// =============================================================================

/**
 * Helper to create a tuple of string literal tags with preserved literal types.
 * Use this when you need to store error tags in a variable while keeping
 * TypeScript's literal type inference (avoiding widening to string[]).
 *
 * @param t - The string literal tags
 * @returns The same array with preserved literal types
 *
 * @example
 * ```typescript
 * // Without tags() - type widens to string[]
 * const errs = ['CART_NOT_FOUND', 'CART_EMPTY'];  // string[]
 *
 * // With tags() - literal types preserved
 * const errs = tags('CART_NOT_FOUND', 'CART_EMPTY');  // ['CART_NOT_FOUND', 'CART_EMPTY']
 *
 * await step('getCart', () => getCart(id), {
 *   errors: errs,  // Analyzer can extract literal types
 *   out: 'cart',
 * });
 * ```
 */
export const tags = <const T extends readonly string[]>(...t: T): T => t;

export type UnexpectedError = {
  type: typeof UNEXPECTED_ERROR;
  cause: UnexpectedCause;
};

/**
 * Default mapper for unexpected causes (uncaught exceptions, cancellation, etc.).
 * Returns the legacy UnexpectedError object shape so the default error union is E | UnexpectedError.
 * Used when createWorkflow() is called without catchUnexpected.
 *
 * @param cause - The thrown value or WorkflowCancelledError
 * @returns UnexpectedError with cause: { type: "UNCAUGHT_EXCEPTION", thrown: cause }
 */
export function defaultCatchUnexpected(cause: unknown): UnexpectedError {
  return {
    type: "UNEXPECTED_ERROR",
    cause: { type: "UNCAUGHT_EXCEPTION", thrown: cause },
  };
}

export type PromiseRejectedError = { type: typeof PROMISE_REJECTED; cause: unknown };
/** Cause type for promise rejections in async batch helpers */
export type PromiseRejectionCause = { type: "PROMISE_REJECTION"; reason: unknown };
export type EmptyInputError = { type: "EMPTY_INPUT"; message: string };
export type MaybeAsyncResult<T, E, C = unknown> = Result<T, E, C> | Promise<Result<T, E, C>>;

// =============================================================================
// Result Constructors
// =============================================================================

/**
 * Creates a successful Result.
 * Use this when an operation completes successfully.
 *
 * @remarks When to use: Wrap a successful value in a Result for consistent return types.
 *
 * @param value - The success value to wrap
 * @returns An Ok object with `{ ok: true, value }`
 *
 * @example
 * ```typescript
 * const success = ok(42);
 * // Type: Ok<number>
 *
 * function divide(a: number, b: number): Result<number, string> {
 *   if (b === 0) return err("Division by zero");
 *   return ok(a / b);
 * }
 * ```
 */
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

/**
 * Creates a failed Result.
 * Use this when an operation fails.
 *
 * @remarks When to use: Return a typed failure without throwing so callers can handle it explicitly.
 *
 * @param error - The error value describing what went wrong (e.g., error code, object)
 * @returns An Err object with `{ ok: false, error }`
 *
 * @example
 * ```typescript
 * // Simple error
 * const r1 = err("NOT_FOUND");
 * // Type: Err<"NOT_FOUND">
 *
 * // Error with context (include in error object)
 * const r2 = err({ type: "PROCESSING_FAILED", cause: originalError });
 * // Type: Err<{ type: string; cause: Error }>
 * ```
 */
export const err = <E, C = unknown>(
  error: E,
  options?: { cause?: C }
): Err<E, C> =>
  ({
    ok: false,
    error,
    ...(options?.cause !== undefined ? { cause: options.cause } : {}),
  }) as Err<E, C>;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Checks if a Result is successful.
 * Use this to narrow the type of a Result to the success case.
 *
 * @remarks When to use: Prefer functional-style checks or array filtering over `result.ok`.
 *
 * @param r - The Result to check
 * @returns `true` if successful, allowing access to `r.value`
 *
 * @example
 * ```typescript
 * const r = someOperation();
 * if (isOk(r)) {
 *   // Use r.value (Type is T)
 *   processValue(r.value);
 * } else {
 *   // Handle r.error (Type is E)
 *   handleError(r.error);
 * }
 * ```
 */
export const isOk = <T, E, C>(r: Result<T, E, C>): r is Ok<T> => r.ok;

/**
 * Checks if a Result is a failure.
 * Use this to narrow the type of a Result to the error case.
 *
 * @remarks When to use: Prefer functional-style checks or array filtering over `result.ok`.
 *
 * @param r - The Result to check
 * @returns `true` if failed, allowing access to `r.error` and `r.cause`
 *
 * @example
 * ```typescript
 * if (isErr(r)) {
 *   // Handle error case early
 *   return;
 * }
 * // Proceed with success case
 * ```
 */
export const isErr = <T, E, C>(r: Result<T, E, C>): r is Err<E, C> => !r.ok;

/**
 * Checks if an error is an UnexpectedError.
 * Used internally by the framework but exported for advanced custom handling.
 * Indicates an error that wasn't typed/expected in the `run` signature.
 *
 * @remarks When to use: Distinguish unexpected failures from your typed error union.
 */
export const isUnexpectedError = (e: unknown): e is UnexpectedError =>
  typeof e === "object" &&
  e !== null &&
  (e as UnexpectedError).type === "UNEXPECTED_ERROR";

/**
 * Checks if an error is a PromiseRejectedError.
 * Occurs when a Promise rejects in batch operations (allAsync, anyAsync, zipAsync).
 *
 * @example
 * ```typescript
 * onError: (error): FetchError => {
 *   if (isPromiseRejectedError(error)) return 'FETCH_FAILED';
 *   return error; // TypeScript narrows to FetchError
 * }
 * ```
 */
export const isPromiseRejectedError = (e: unknown): e is PromiseRejectedError =>
  typeof e === "object" &&
  e !== null &&
  (e as PromiseRejectedError).type === PROMISE_REJECTED;

// =============================================================================
// Error Matching
// =============================================================================

/**
 * Type for exhaustive error handlers mapping string literal errors and UnexpectedError.
 * Each key in E gets a handler, plus UNEXPECTED_ERROR is required.
 * Note: "UNEXPECTED_ERROR" is excluded from E to avoid intersection conflicts when users
 * have that literal in their error union - the UNEXPECTED_ERROR handler always receives
 * the UnexpectedError object type, not the string literal.
 */
export type MatchErrorHandlers<E extends string, R> = {
  [K in Exclude<E, "UNEXPECTED_ERROR">]: (error: K) => R;
} & {
  UNEXPECTED_ERROR: (error: UnexpectedError) => R;
};

/**
 * Exhaustive pattern matching for error types.
 * Handles both string literal errors and UnexpectedError, ensuring all cases are covered.
 *
 * @param error - The error to match (string literal or UnexpectedError)
 * @param handlers - Object with a handler for each error case plus UNEXPECTED_ERROR
 * @returns The result of the matched handler
 *
 * @example
 * ```typescript
 * type FetchError = "NOT_FOUND" | "FETCH_ERROR";
 * const result: Result<User, FetchError | UnexpectedError> = await fetchUser();
 *
 * if (!result.ok) {
 *   return matchError(result.error, {
 *     NOT_FOUND: () => 404,
 *     FETCH_ERROR: () => 500,
 *     UNEXPECTED_ERROR: (e) => { throw e.cause; }  // Required by types
 *   });
 * }
 * ```
 */
export function matchError<E extends string, R>(
  error: E | UnexpectedError,
  handlers: MatchErrorHandlers<E, R>
): R {
  // Handle UnexpectedError objects
  if (isUnexpectedError(error)) {
    return handlers.UNEXPECTED_ERROR(error);
  }
  // Handle the string literal "UNEXPECTED_ERROR" - wrap it in an UnexpectedError object
  // to maintain the typed contract that UNEXPECTED_ERROR handler receives an object
  if (error === "UNEXPECTED_ERROR") {
    const syntheticError: UnexpectedError = {
      type: UNEXPECTED_ERROR,
      cause: { type: "UNCAUGHT_EXCEPTION", thrown: error },
    };
    return handlers.UNEXPECTED_ERROR(syntheticError);
  }
  // Cast to the excluded type since we've handled UNEXPECTED_ERROR above
  type StringErrors = Exclude<E, "UNEXPECTED_ERROR">;
  return handlers[error as StringErrors](error as StringErrors);
}

// =============================================================================
// Type Utilities
// =============================================================================

type AnyFunction = (...args: never[]) => unknown;

/**
 * Helper to extract the error type from Result or AsyncResult return values.
 * Works even when a function is declared to return a union of both forms.
 */
type ErrorOfReturn<R> = Extract<Awaited<R>, { ok: false }> extends { error: infer E }
  ? E
  : never;

/**
 * Extract error type from a single function's return type
 */
export type ErrorOf<T extends AnyFunction> = ErrorOfReturn<ReturnType<T>>;

/**
 * Extract union of error types from multiple functions
 */
export type Errors<T extends AnyFunction[]> = {
  [K in keyof T]: ErrorOf<T[K]>;
}[number];

/**
 * Extract value type from Result
 */
export type ExtractValue<T> = T extends { ok: true; value: infer U }
  ? U
  : never;

/**
 * Extract error type from Result
 */
export type ExtractError<T> = T extends { ok: false; error: infer E }
  ? E
  : never;

/**
 * Extract cause type from Result
 */
export type ExtractCause<T> = T extends { ok: false; cause?: infer C }
  ? C
  : never;

/**
 * Helper to extract the cause type from Result or AsyncResult return values.
 * Works even when a function is declared to return a union of both forms.
 */
type CauseOfReturn<R> = Extract<Awaited<R>, { ok: false }> extends { cause?: infer C }
  ? C
  : never;

/**
 * Extract cause type from a function's return type
 */
export type CauseOf<T extends AnyFunction> = CauseOfReturn<ReturnType<T>>;

// =============================================================================
// Step Options
// =============================================================================

/**
 * Options for configuring a step within a workflow.
 * Use these to enable tracing, caching, state persistence, and static analysis.
 */
export type StepOptions<
  Errs extends readonly string[] = readonly string[],
  Out extends string | undefined = undefined,
> = {
  /**
   * Stable identity key for the step.
   * REQUIRED for:
   * 1. Caching: Used as the cache key.
   * 2. Resuming: Used to identify which steps have already completed.
   *
   * Must be unique within the workflow.
   */
  key?: string;

  /**
   * Short description for labels/tooltips.
   * Used by static analysis visualization tools.
   */
  description?: string;

  /**
   * Full markdown documentation for the step.
   * Used by static analysis visualization tools.
   */
  markdown?: string;

  /**
   * Retry configuration for transient failures.
   * When specified, the step will retry on errors according to this config.
   */
  retry?: RetryOptions;

  /**
   * Timeout configuration for the operation.
   * When specified, each attempt will be aborted after the timeout duration.
   */
  timeout?: TimeoutOptions;

  /**
   * Time-to-live for this step's cache entry in milliseconds.
   * Overrides any global cache TTL. Requires `key` for caching.
   */
  ttl?: number;

  // ==========================================================================
  // Static Analysis Options
  // ==========================================================================

  /**
   * Declared tagged errors this step may return.
   * Used by the static analyzer to build error flow graphs.
   *
   * Use `tags()` helper when storing in a variable:
   * @example
   * ```typescript
   * const cartErrors = tags('CART_NOT_FOUND', 'CART_EMPTY');
   * await step('getCart', () => getCart(id), { errors: cartErrors });
   *
   * // Or inline (no helper needed)
   * await step('getCart', () => getCart(id), {
   *   errors: ['CART_NOT_FOUND', 'CART_EMPTY'],
   * });
   * ```
   */
  errors?: Errs;

  /**
   * Write the step's return value to this context key.
   * Replaces manual `ctx.set()` calls for the happy path.
   *
   * @example
   * ```typescript
   * await step('getCart', () => getCart(id), { out: 'cart' });
   * // Now ctx.cart contains the result
   * ```
   */
  out?: Out;

  /**
   * Override auto-detected reads from context.
   * Use when the analyzer can't trace complex data dependencies.
   *
   * @example
   * ```typescript
   * await step('charge', () => chargeCard(getCartTotal()), {
   *   reads: ['cart'],  // Explicitly declare dependency
   * });
   * ```
   */
  reads?: readonly string[];

  /**
   * Hint for dependency source tracking.
   * Use when the callback is complex and the analyzer can't detect
   * which dependency function is being called.
   *
   * @example
   * ```typescript
   * await step('getCart', () => {
   *   const id = transform(ctx.input.cartId);
   *   return deps.getCart(id);
   * }, {
   *   dep: 'getCart',  // Hint for analyzer
   * });
   * ```
   */
  dep?: string;
};

// =============================================================================
// Retry and Timeout Types
// =============================================================================

/**
 * Backoff strategy for retry operations.
 */
export type BackoffStrategy = "fixed" | "linear" | "exponential";

/**
 * Configuration for step retry behavior.
 */
export type RetryOptions = {
  /**
   * Total number of attempts (1 = no retry, 3 = initial + 2 retries).
   * Must be >= 1.
   */
  attempts: number;

  /**
   * Backoff strategy between retries.
   * - 'fixed': Same delay each time (initialDelay)
   * - 'linear': Delay increases linearly (initialDelay * attempt)
   * - 'exponential': Delay doubles each time (initialDelay * 2^(attempt-1))
   * @default 'exponential'
   */
  backoff?: BackoffStrategy;

  /**
   * Initial delay in milliseconds before first retry.
   * @default 100
   */
  initialDelay?: number;

  /**
   * Maximum delay cap in milliseconds.
   * Prevents exponential backoff from growing too large.
   * @default 30000 (30 seconds)
   */
  maxDelay?: number;

  /**
   * Whether to add random jitter (0-25% of delay).
   * Helps prevent thundering herd when multiple workflows retry simultaneously.
   * @default true
   */
  jitter?: boolean;

  /**
   * Predicate to determine if a retry should occur.
   * Receives the error and current attempt number (1-indexed).
   * Return true to retry, false to fail immediately.
   * @default Always retry on any error
   */
  retryOn?: (error: unknown, attempt: number) => boolean;

  /**
   * Callback invoked before each retry attempt.
   * Useful for logging, metrics, or side effects.
   */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
};

/**
 * Timeout behavior when the timeout is reached.
 *
 * - 'error' (default): Return an error result with StepTimeoutError
 * - 'option': Return Ok(undefined) instead of an error (useful for optional operations)
 * - 'disconnect': Let the operation complete in background, return timeout error immediately
 * - function: Custom handler to generate the timeout error
 */
export type TimeoutBehavior =
  | "error"
  | "option"
  | "disconnect"
  | ((stepInfo: { name?: string; key?: string; ms: number }) => unknown);

/**
 * Configuration for step timeout behavior.
 */
export type TimeoutOptions = {
  /**
   * Timeout duration in milliseconds per attempt.
   * When combined with retry, each attempt gets its own timeout.
   */
  ms: number;

  /**
   * Custom error to use when timeout occurs.
   * @default StepTimeoutError with step details
   */
  error?: unknown;

  /**
   * Whether to pass an AbortSignal to the operation.
   * When true, the operation function receives (signal: AbortSignal) as argument.
   * Useful for fetch() and other APIs that support cancellation.
   * @default false
   */
  signal?: boolean;

  /**
   * Behavior when timeout is reached.
   *
   * - 'error' (default): Return StepTimeoutError (or custom error if provided)
   * - 'option': Return Ok(undefined) instead of error (operation treated as optional)
   * - 'disconnect': Let operation complete in background, return error immediately
   * - function: Custom handler `(stepInfo) => customError`
   *
   * @default 'error'
   *
   * @example
   * ```typescript
   * // Default: Return timeout error
   * step.withTimeout(() => slowOp(), { ms: 5000 });
   *
   * // Optional: Return undefined if times out
   * step.withTimeout(() => optionalOp(), { ms: 5000, onTimeout: 'option' });
   *
   * // Disconnect: Don't wait for slow operation
   * step.withTimeout(() => fireAndForget(), { ms: 5000, onTimeout: 'disconnect' });
   *
   * // Custom error
   * step.withTimeout(() => apiCall(), {
   *   ms: 5000,
   *   onTimeout: ({ name, ms }) => ({ type: 'API_TIMEOUT', name, ms })
   * });
   * ```
   */
  onTimeout?: TimeoutBehavior;
};

/**
 * Standard timeout error type.
 */
export type StepTimeoutError = {
  type: "STEP_TIMEOUT";
  stepName?: string;
  stepKey?: string;
  timeoutMs: number;
  attempt?: number;
};

/**
 * Symbol used to mark any error (including custom errors) as a timeout error.
 * This allows detection of timeout errors even when users provide custom error payloads.
 */
export const STEP_TIMEOUT_MARKER: unique symbol = Symbol.for("step_timeout_marker");

/**
 * Metadata attached to timeout-marked errors.
 */
export type StepTimeoutMarkerMeta = {
  timeoutMs: number;
  stepName?: string;
  stepKey?: string;
  attempt?: number;
};

/**
 * Type guard to check if an error is a StepTimeoutError.
 * This checks both the standard type field AND the timeout marker symbol,
 * so custom errors provided via timeout.error are also detected.
 */
export function isStepTimeoutError(e: unknown): e is StepTimeoutError {
  if (typeof e !== "object" || e === null) {
    return false;
  }
  // Check for standard type field
  if ((e as StepTimeoutError).type === "STEP_TIMEOUT") {
    return true;
  }
  // Check for timeout marker (custom errors)
  return STEP_TIMEOUT_MARKER in e;
}

/**
 * Get timeout metadata from a timeout error (works with both standard and custom errors).
 * Returns undefined if the error is not a timeout error.
 */
export function getStepTimeoutMeta(e: unknown): StepTimeoutMarkerMeta | undefined {
  if (typeof e !== "object" || e === null) {
    return undefined;
  }
  // Check for standard type field first
  if ((e as StepTimeoutError).type === "STEP_TIMEOUT") {
    const err = e as StepTimeoutError;
    return {
      timeoutMs: err.timeoutMs,
      stepName: err.stepName,
      stepKey: err.stepKey,
      attempt: err.attempt,
    };
  }
  // Check for timeout marker (custom errors)
  if (STEP_TIMEOUT_MARKER in e) {
    return (e as Record<symbol, StepTimeoutMarkerMeta>)[STEP_TIMEOUT_MARKER];
  }
  return undefined;
}

// =============================================================================
// RunStep Interface
// =============================================================================

/**
 * The `step` object passed to the function in `run(async (step) => { ... })`.
 * acts as the bridge between your business logic and the workflow engine.
 *
 * It provides methods to:
 * 1. Execute operations that return `Result` types.
 * 2. safely wrap operations that might throw exceptions (using `step.try`).
 * 3. Assign names and keys to operations for tracing and caching.
 *
 * @template E - The union of all known error types expected in this workflow.
 */
export interface RunStep<E = unknown> {
  /**
   * Execute a Result-returning operation with explicit step ID.
   *
   * The ID is used for:
   * - Static analysis visualization
   * - Error flow tracking
   * - Step identification in diagrams
   * - Caching and resume (ID is used as the cache key)
   *
   * @param id - Unique step identifier (string literal for static analysis)
   * @param operation - A function that returns a Result or AsyncResult
   * @param options - Step options
   * @returns The success value (unwrapped)
   * @throws {EarlyExit} If the result is an error (stops execution safely)
   *
   * @example
   * ```typescript
   * const cart = await step('getCart', () => getCart(ctx.input.cartId), {
   *   errors: ['CART_NOT_FOUND', 'CART_EMPTY'],
   *   out: 'cart',
   * });
   * ```
   */
  <T, StepE extends E, StepC = unknown>(
    id: string,
    operation: () => Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>,
    options?: StepOptions
  ): Promise<T>;

  /**
   * Execute a standard throwing operation safely.
   * Catches exceptions and maps them to a typed error, or wraps them if no mapper is provided.
   *
   * Use this when integrating with libraries that throw exceptions.
   *
   * @param id - Unique identifier for this step (required for analysis and caching)
   * @param operation - A function that returns a value or Promise (may throw)
   * @param options - Configuration including error mapping
   * @returns The success value
   * @throws {EarlyExit} If the operation throws (stops execution safely)
   *
   * @example
   * ```typescript
   * const data = await step.try(
   *   "db-query",
   *   () => db.query(),
   *   { onError: (e) => ({ type: "DB_ERROR", cause: e }) }
   * );
   * ```
   */
  try: <T, const Err extends E>(
    id: string,
    operation: () => T | Promise<T>,
    options:
      | { error: Err; key?: string; ttl?: number }
      | { onError: (cause: unknown) => Err; key?: string; ttl?: number }
  ) => Promise<T>;

  /**
   * Execute a Result-returning function and map its error to a typed error.
   *
   * Use this when calling functions that return Result<T, E> and you want to
   * map their typed errors to your workflow's error type. Unlike step.try(),
   * the error passed to onError is typed (not unknown).
   *
   * @param id - Unique identifier for this step (required for analysis and caching)
   * @param operation - A function that returns a Result or AsyncResult
   * @param options - Configuration including error mapping
   * @returns The success value (unwrapped)
   * @throws {EarlyExit} If the result is an error (stops execution safely)
   *
   * @example
   * ```typescript
   * const response = await step.fromResult(
   *   "call-provider",
   *   () => callProvider(input),
   *   {
   *     onError: (providerError) => ({
   *       type: "PROVIDER_FAILED",
   *       provider: providerError.provider,
   *       cause: providerError
   *     })
   *   }
   * );
   * ```
   */
  fromResult: <T, ResultE, const Err extends E>(
    id: string,
    operation: () => Result<T, ResultE, unknown> | AsyncResult<T, ResultE, unknown>,
    options:
      | { error: Err; key?: string; ttl?: number }
      | { onError: (resultError: ResultE) => Err; key?: string; ttl?: number }
  ) => Promise<T>;

  /**
   * Execute parallel operations with scope events for visualization.
   *
   * This wraps the operations with scope_start and scope_end events, enabling
   * visualization of parallel execution branches.
   *
   * @overload Object form - step.parallel(name, { key: () => ... })
   * @overload Array form - step.parallel(name, () => allAsync([...]))
   *
   * @example Object form
   * ```typescript
   * const { user, posts } = await step.parallel('Fetch user data', {
   *   user: () => fetchUser(id),
   *   posts: () => fetchPosts(id),
   * });
   * ```
   *
   * @example Canonical form (strict mode)
   * ```typescript
   * const { user, posts } = await step.parallel('Fetch user data', {
   *   user: { fn: () => fetchUser(id), errors: ['NOT_FOUND'] },
   *   posts: { fn: () => fetchPosts(id), errors: ['FETCH_ERROR'] },
   * });
   * ```
   *
   * @example Array form
   * ```typescript
   * const [user, posts] = await step.parallel('Fetch all data', () =>
   *   allAsync([fetchUser(id), fetchPosts(id)])
   * );
   * ```
   */
  parallel: {
    // Object form: step.parallel(name, { key: () => ... })
    <
      TOperations extends Record<
        string,
        () => MaybeAsyncResult<unknown, E, unknown>
      >
    >(
      name: string,
      operations: TOperations
    ): Promise<{
      [K in keyof TOperations]: TOperations[K] extends () => MaybeAsyncResult<
        infer V,
        E,
        unknown
      >
        ? V
        : never;
    }>;

    // Object form canonical: step.parallel(name, { key: { fn, errors } })
    <
      TOperations extends Record<
        string,
        ParallelOperationDescriptor<unknown, readonly string[]>
      >
    >(
      name: string,
      operations: TOperations
    ): Promise<{
      [K in keyof TOperations]: TOperations[K] extends ParallelOperationDescriptor<
        infer V,
        readonly string[]
      >
        ? V
        : never;
    }>;

    // Array form: step.parallel(name, () => allAsync([...]))
    <T, StepE extends E, StepC = unknown>(
      name: string,
      operation: () => Result<T[], StepE, StepC> | AsyncResult<T[], StepE, StepC>
    ): Promise<T[]>;
  };

  /**
   * Execute a race operation (anyAsync) with scope events for visualization.
   *
   * This wraps the operation with scope_start and scope_end events, enabling
   * visualization of racing execution branches.
   *
   * @param name - Name for this race block (used in visualization)
   * @param operation - A function that returns a Result from anyAsync
   * @returns The success value (first to succeed)
   *
   * @example
   * ```typescript
   * const data = await step.race('Fastest API', () =>
   *   anyAsync([fetchFromPrimary(id), fetchFromFallback(id)])
   * );
   * ```
   */
  race: <T, StepE extends E, StepC = unknown>(
    name: string,
    operation: () => Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>
  ) => Promise<T>;

  /**
   * Execute an allSettled operation with scope events for visualization.
   *
   * This wraps the operation with scope_start and scope_end events, enabling
   * visualization of allSettled execution branches. Unlike step.parallel,
   * allSettled collects all results even if some fail.
   *
   * @param name - Name for this allSettled block (used in visualization)
   * @param operation - A function that returns a Result from allSettledAsync
   * @returns The success value (unwrapped array)
   *
   * @example
   * ```typescript
   * const [user, posts] = await step.allSettled('Fetch all data', () =>
   *   allSettledAsync([fetchUser(id), fetchPosts(id)])
   * );
   * ```
   */
  allSettled: <T, StepE extends E, StepC = unknown>(
    name: string,
    operation: () => Result<T[], StepE, StepC> | AsyncResult<T[], StepE, StepC>
  ) => Promise<T[]>;

  /**
   * Execute an operation with retry and optional timeout.
   *
   * Use this for operations that may fail transiently (network issues, rate limits)
   * and benefit from automatic retry with backoff.
   *
   * @param id - Unique identifier for this step (required for analysis and caching)
   * @param operation - A function that returns a Result or AsyncResult
   * @param options - Retry configuration and optional timeout
   * @returns The success value (unwrapped)
   * @throws {EarlyExit} If all retries are exhausted (stops execution safely)
   *
   * @example
   * ```typescript
   * const data = await step.retry(
   *   "fetch-external",
   *   () => fetchFromExternalApi(id),
   *   {
   *     attempts: 3,
   *     backoff: 'exponential',
   *     initialDelay: 200,
   *     retryOn: (error) => error === 'RATE_LIMITED' || error === 'TRANSIENT',
   *     onRetry: (error, attempt, delay) => {
   *       console.log(`Retry ${attempt} after ${delay}ms`);
   *     },
   *   }
   * );
   * ```
   */
  retry: <T, StepE extends E, StepC = unknown>(
    id: string,
    operation: () => Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>,
    options: RetryOptions & { key?: string; timeout?: TimeoutOptions }
  ) => Promise<T>;

  /**
   * Execute an operation with a timeout.
   *
   * Use this for operations that may hang indefinitely (external APIs, connections)
   * and need to be aborted after a certain duration.
   *
   * When `signal: true` is set, an AbortSignal is passed to your operation,
   * which you can use with APIs like fetch() for proper cancellation.
   *
   * @param id - Unique identifier for this step (required for analysis and caching)
   * @param operation - A function that returns a Result (may receive AbortSignal)
   * @param options - Timeout configuration
   * @returns The success value (unwrapped)
   * @throws {EarlyExit} If the operation times out (stops execution safely)
   *
   * @example
   * ```typescript
   * // Without AbortSignal
   * const data = await step.withTimeout(
   *   "fetch-data",
   *   () => fetchData(id),
   *   { ms: 5000 }
   * );
   *
   * // With AbortSignal for fetch()
   * const data = await step.withTimeout(
   *   "fetch-url",
   *   (signal) => fetch(url, { signal }).then(r => ok(r.json())),
   *   { ms: 5000, signal: true }
   * );
   * ```
   */
  withTimeout: <T, StepE extends E, StepC = unknown>(
    id: string,
    operation:
      | (() => Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>)
      | ((signal: AbortSignal) => Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>),
    options: TimeoutOptions & { key?: string }
  ) => Promise<T>;

  /**
   * Pause execution for a specified duration.
   *
   * Use this for intentional delays between operations (rate limiting,
   * polling intervals, debouncing). Respects workflow cancellation.
   *
   * @param id - Unique identifier for this step (required for analysis and caching)
   * @param duration - Duration as string ("5s", "100ms") or Duration object
   * @param options - Optional key for per-iteration identity, ttl, description
   * @returns Promise that resolves after the duration
   * @throws {AbortError} If the workflow is cancelled during sleep
   *
   * @example
   * ```typescript
   * // String duration
   * await step.sleep("rate-limit-delay", "5s");
   *
   * // Duration object
   * await step.sleep("my-sleep", seconds(5));
   * ```
   */
  sleep(
    id: string,
    duration: DurationInput,
    options?: { key?: string; ttl?: number; description?: string }
  ): Promise<void>;

  // ===========================================================================
  // Streaming Methods
  // ===========================================================================

  /**
   * Get a writable stream for this workflow.
   *
   * Use this to write values that can be consumed by readers
   * (e.g., HTTP response streaming, AI token streaming).
   *
   * @param options - Stream options (namespace, highWaterMark)
   * @returns StreamWriter for writing values
   *
   * @example
   * ```typescript
   * const writer = step.getWritable<string>({ namespace: 'ai-response' });
   *
   * await step(() => generateAI({
   *   prompt: 'Hello',
   *   onToken: async (token) => { await writer.write(token); }
   * }), { key: 'generate' });
   *
   * await writer.close();
   * ```
   */
  getWritable: <T>(options?: StreamWritableOptions) => StreamWriterInterface<T>;

  /**
   * Get a readable stream for this workflow.
   *
   * Use this to consume values from a stream, with support for
   * resuming from a specific position.
   *
   * @param options - Read options (namespace, startIndex)
   * @returns StreamReader for reading values
   *
   * @example
   * ```typescript
   * const reader = step.getReadable<string>({ namespace: 'ai-response' });
   *
   * let result = await reader.read();
   * while (result.ok) {
   *   response.write(result.value);
   *   result = await reader.read();
   * }
   * ```
   */
  getReadable: <T>(options?: StreamReadableOptions) => StreamReaderInterface<T>;

  /**
   * Process stream items with checkpointing.
   *
   * Combines streaming with batch processing - each item is processed
   * and checkpointed, enabling resume from the last successful item.
   *
   * @param source - StreamReader or AsyncIterable to process
   * @param processor - Function to process each item
   * @param options - Processing options
   * @returns Results from all processed items
   *
   * @example
   * ```typescript
   * const reader = step.getReadable<Message>({ namespace: 'messages' });
   *
   * const result = await step.streamForEach(
   *   reader,
   *   async (message, index) => {
   *     const processed = await processMessage(message);
   *     return ok(processed);
   *   },
   *   { name: 'process-messages', checkpointInterval: 10 }
   * );
   *
   * console.log(`Processed ${result.value.processedCount} messages`);
   * ```
   */
  streamForEach: <T, R, StepE extends E>(
    source: StreamReaderInterface<T> | AsyncIterable<T>,
    processor: (item: T, index: number) => AsyncResult<R, StepE>,
    options?: StreamForEachStepOptions
  ) => Promise<StreamForEachResultType<R>>;

  // ===========================================================================
  // Static Analysis Methods
  // ===========================================================================

  /**
   * Mark a conditional for static analysis with a stable ID and condition label.
   * Runtime: returns the boolean result of condition().
   * Analysis: emits a DecisionNode with stable id and conditionLabel, and attaches
   * the then/else subgraphs from the if/else branches.
   *
   * @param id - Stable identifier for this decision point (string literal for static analysis)
   * @param conditionLabel - Human-readable label describing the condition
   * @param condition - Function that returns the boolean condition
   * @returns The result of the condition function
   *
   * @example
   * ```typescript
   * if (step.if('payment', 'cart.total > 0', () => ctx.ref('cart').total > 0)) {
   *   await step('chargeCard', () => deps.chargeCard(ctx.ref('cart').total), {
   *     errors: ['CARD_DECLINED'],
   *   });
   * } else {
   *   await step('skipPayment', async () => ({ skipped: true }), {
   *     errors: [],
   *   });
   * }
   * ```
   */
  if: <T extends boolean>(
    id: string,
    conditionLabel: string,
    condition: () => T
  ) => T;

  /**
   * Alias for `step.if()`. Mark a conditional for static analysis with a stable ID.
   * Use this to label conditionals in strict mode when they contain step calls.
   *
   * @param id - Stable identifier for this decision point
   * @param conditionLabel - Human-readable label describing the condition
   * @param condition - Function that returns the boolean condition
   * @returns The result of the condition function
   *
   * @example
   * ```typescript
   * if (step.label('email-type', 'user.isPremium', () => user.isPremium)) {
   *   await step('premium', () => sendPriorityEmail(user), { errors: ['EMAIL_FAILED'] });
   * } else {
   *   await step('free', () => sendRegularEmail(user), { errors: ['EMAIL_FAILED'] });
   * }
   * ```
   */
  label: <T extends boolean>(
    id: string,
    conditionLabel: string,
    condition: () => T
  ) => T;

  /**
   * Execute a branch with explicit metadata for static analysis.
   * Use when you want richer analyzer metadata (conditionLabel, per-arm errors).
   * For most cases, use natural if/else with step.label() instead.
   *
   * @param id - Stable identifier for this branch point
   * @param options - Branch configuration with condition, then/else arms, and errors
   * @returns The result from the executed arm
   *
   * @example
   * ```typescript
   * const charge = await step.branch('payment', {
   *   conditionLabel: 'cart.total > 0',
   *   condition: () => ctx.ref('cart').total > 0,
   *   out: 'charge',
   *   then: () => chargeCard(ctx.ref('cart').total),
   *   thenErrors: ['CARD_DECLINED'],
   *   else: () => ok({ skipped: true }),
   *   elseErrors: [],
   * });
   * ```
   */
  branch: <
    T,
    const ThenErrs extends readonly string[] = readonly [],
    const ElseErrs extends readonly string[] = readonly [],
    const Out extends string | undefined = undefined,
  >(
    id: string,
    options: BranchOptions<T, ThenErrs, ElseErrs, Out>
  ) => Promise<T>;

  /**
   * Create an arm definition for use with step.branch().
   * Runtime: returns the arm definition unchanged.
   * Analyzer: extracts arm metadata for visualization.
   *
   * @param fn - The arm function
   * @param errors - Declared errors for this arm
   * @returns The arm definition
   *
   * @example
   * ```typescript
   * const thenArm = step.arm(() => chargeCard(total), ['CARD_DECLINED']);
   * const elseArm = step.arm(() => ok({ skipped: true }), []);
   * ```
   */
  arm: <T, const Errs extends readonly string[] = readonly []>(
    fn: () => T | Promise<T>,
    errors?: Errs
  ) => ArmDefinition<T, Errs>;

  /**
   * Execute a forEach loop with static analysis support.
   * Supports both simple (run) and complex (item) forms.
   *
   * @param id - Stable identifier for this loop
   * @param items - Iterable to loop over
   * @param options - Loop configuration
   * @returns Array of results from each iteration
   *
   * @example Simple form:
   * ```typescript
   * await step.forEach('process-items', items, {
   *   maxIterations: 100,
   *   stepIdPattern: 'process-{i}',
   *   errors: ['PROCESS_ERROR'],
   *   run: (item) => processItem(item),
   * });
   * ```
   *
   * @example Complex form with multiple steps:
   * ```typescript
   * await step.forEach('process-items', items, {
   *   maxIterations: 100,
   *   item: step.item((item, i, innerStep) => {
   *     await innerStep('validate', () => validate(item), { errors: ['INVALID'] });
   *     await innerStep('process', () => process(item), { errors: ['FAILED'] });
   *   }),
   * });
   * ```
   */
  forEach: {
    // Simple form with run callback
    <T, R, const Errs extends readonly string[] = readonly []>(
      id: string,
      items: Iterable<T> | AsyncIterable<T>,
      options: ForEachRunOptions<T, R, Errs>
    ): Promise<R[]>;

    // Complex form with item callback
    <T, R>(
      id: string,
      items: Iterable<T> | AsyncIterable<T>,
      options: ForEachItemOptions<T, R>
    ): Promise<R[]>;
  };

  /**
   * Create an item handler for use with step.forEach().
   * Runtime: returns the handler unchanged.
   * Analyzer: extracts the inner step structure.
   *
   * @param handler - Function to process each item
   * @returns The item handler
   *
   * @example
   * ```typescript
   * step.item((item, index, innerStep) => {
   *   await innerStep('validate', () => validate(item));
   *   await innerStep('process', () => process(item));
   * });
   * ```
   */
  item: <T, R>(
    handler: (item: T, index: number, step: RunStep<E>) => R | Promise<R>
  ) => ForEachItemHandler<T, R>;

  /**
   * Wrap a dependency function for static analysis tracking.
   * Returns the function unchanged but marks it for the analyzer.
   *
   * @param name - Name of the dependency (for analyzer tracking)
   * @param fn - The dependency function to wrap
   * @returns The same function, unchanged
   *
   * @example
   * ```typescript
   * await step('getCart', step.dep('getCart', () => deps.getCart(ctx.input.cartId)), {
   *   errors: ['CART_NOT_FOUND'],
   *   out: 'cart',
   * });
   * ```
   */
  dep: <T extends (...args: unknown[]) => unknown>(name: string, fn: T) => T;

}

// =============================================================================
// Parallel Types
// =============================================================================

/**
 * Operation descriptor for canonical parallel form.
 * Use this for analyzable parallel operations with explicit error declarations.
 */
export type ParallelOperationDescriptor<
  T,
  Errs extends readonly string[] = readonly [],
> = {
  /** The operation function */
  fn: () => MaybeAsyncResult<T, unknown, unknown>;
  /** Declared errors for this operation (for static analysis) */
  errors?: Errs;
};

// =============================================================================
// Branch and ForEach Types
// =============================================================================

/**
 * Options for step.branch().
 */
export type BranchOptions<
  T,
  ThenErrs extends readonly string[] = readonly [],
  ElseErrs extends readonly string[] = readonly [],
  Out extends string | undefined = undefined,
> = {
  /** Human-readable label describing the condition */
  conditionLabel: string;
  /** Function that evaluates the condition */
  condition: () => boolean;
  /** Output key for data flow (writes result to ctx[out]) */
  out?: Out;
  /** Function to execute when condition is true */
  then: () => T | Promise<T>;
  /** Declared errors for the then arm */
  thenErrors?: ThenErrs;
  /** Function to execute when condition is false */
  else?: () => T | Promise<T>;
  /** Declared errors for the else arm */
  elseErrors?: ElseErrs;
};

/**
 * Arm definition for step.branch().
 */
export type ArmDefinition<T, Errs extends readonly string[] = readonly []> = {
  fn: () => T | Promise<T>;
  errors?: Errs;
};

/**
 * Options for step.forEach() with simple run form.
 */
export type ForEachRunOptions<T, R, Errs extends readonly string[] = readonly []> = {
  /** Maximum iterations (for bounded analysis) */
  maxIterations?: number;
  /** Step ID pattern for iterations (e.g., 'process-{i}') */
  stepIdPattern?: string;
  /** Declared errors for the loop body */
  errors?: Errs;
  /** Output key for results (requires collect option in strict mode) */
  out?: string;
  /** How to collect results when out is specified */
  collect?: "array" | "last";
  /** Simple callback for each item */
  run: (item: T, index: number) => R | Promise<R>;
};

/**
 * Options for step.forEach() with complex item form.
 */
export type ForEachItemOptions<T, R> = {
  /** Maximum iterations (for bounded analysis) */
  maxIterations?: number;
  /** Step ID pattern for iterations (e.g., 'process-{i}') */
  stepIdPattern?: string;
  /** Output key for results (requires collect option in strict mode) */
  out?: string;
  /** How to collect results when out is specified */
  collect?: "array" | "last";
  /** Complex item handler with inner step access */
  item: ForEachItemHandler<T, R>;
};

/**
 * Item handler for step.forEach() with inner step access.
 */
export type ForEachItemHandler<T, R> = {
  __forEachItemHandler: true;
  handler: (item: T, index: number, step: RunStep<unknown>) => R | Promise<R>;
};

// =============================================================================
// Streaming Types (minimal interfaces for RunStep)
// =============================================================================

/**
 * Options for getWritable.
 */
export interface StreamWritableOptions {
  /** Named streams (default: 'default') */
  namespace?: string;
  /** Backpressure threshold (default: 16) */
  highWaterMark?: number;
}

/**
 * Options for getReadable.
 */
export interface StreamReadableOptions {
  /** Named streams (default: 'default') */
  namespace?: string;
  /** Resume from position (0-indexed) */
  startIndex?: number;
  /** Poll interval in ms when waiting for new items (default: 10) */
  pollInterval?: number;
  /** Stop polling after this many ms with no new items (default: 30000) */
  pollTimeout?: number;
}

/**
 * Options for streamForEach.
 */
export interface StreamForEachStepOptions {
  /** Checkpoint after every N items (default: 1) */
  checkpointInterval?: number;
  /** Maximum concurrent processors (default: 1 = sequential) */
  concurrency?: number;
}

/**
 * Result from streamForEach operation.
 */
export interface StreamForEachResultType<R> {
  /** Results from each processed item */
  results: R[];
  /** Total items processed */
  processedCount: number;
  /** Position of last processed item */
  lastPosition: number;
}

/**
 * Writable stream interface used in RunStep.
 * @see StreamWriter in awaitly/streaming for full interface
 */
export interface StreamWriterInterface<T> {
  write(value: T): AsyncResult<void, StreamWriteErrorType>;
  close(): AsyncResult<void, StreamCloseErrorType>;
  abort(reason: unknown): void;
  readonly writable: boolean;
  readonly position: number;
  readonly namespace: string;
}

/**
 * Readable stream interface used in RunStep.
 * @see StreamReader in awaitly/streaming for full interface
 */
export interface StreamReaderInterface<T> {
  read(): AsyncResult<T, StreamReadErrorType | StreamEndedMarkerType>;
  close(): void;
  readonly readable: boolean;
  readonly position: number;
  readonly namespace: string;
}

/**
 * Stream write error type.
 */
export interface StreamWriteErrorType {
  type: "STREAM_WRITE_ERROR";
  reason: "closed" | "aborted" | "store_error";
  message: string;
  cause?: unknown;
}

/**
 * Stream read error type.
 */
export interface StreamReadErrorType {
  type: "STREAM_READ_ERROR";
  reason: "closed" | "store_error";
  message: string;
  cause?: unknown;
}

/**
 * Stream close error type.
 */
export interface StreamCloseErrorType {
  type: "STREAM_CLOSE_ERROR";
  reason: "already_closed" | "store_error";
  message: string;
  cause?: unknown;
}

/**
 * Stream ended marker type.
 */
export interface StreamEndedMarkerType {
  type: "STREAM_ENDED";
  finalPosition: number;
}

// =============================================================================
// Event Types (for run() optional event support)
// =============================================================================

/**
 * Unified event stream for workflow execution.
 *
 * Note: step_complete.result uses Result<unknown, unknown, unknown> because events
 * aggregate results from heterogeneous steps. At runtime, the actual Result object
 * preserves its original types, but the event type cannot statically represent them.
 * Use runtime checks or the meta field to interpret cause values.
 */
/**
 * Scope types for parallel and race operations.
 */
export type ScopeType = "parallel" | "race" | "allSettled";

export type WorkflowEvent<E, C = unknown> =
  | { type: "workflow_start"; workflowId: string; ts: number; context?: C }
  | { type: "workflow_success"; workflowId: string; ts: number; durationMs: number; context?: C }
  | { type: "workflow_error"; workflowId: string; ts: number; durationMs: number; error: E; context?: C }
  | { type: "step_start"; workflowId: string; stepId: string; stepKey?: string; name?: string; description?: string; ts: number; context?: C }
  | { type: "step_success"; workflowId: string; stepId: string; stepKey?: string; name?: string; description?: string; ts: number; durationMs: number; context?: C }
  | { type: "step_error"; workflowId: string; stepId: string; stepKey?: string; name?: string; description?: string; ts: number; durationMs: number; error: E; context?: C }
  | { type: "step_aborted"; workflowId: string; stepId: string; stepKey?: string; name?: string; description?: string; ts: number; durationMs: number; context?: C }
  | { type: "step_complete"; workflowId: string; stepKey: string; name?: string; description?: string; ts: number; durationMs: number; result: Result<unknown, unknown, unknown>; meta?: StepFailureMeta; context?: C }
  | { type: "step_cache_hit"; workflowId: string; stepKey: string; name?: string; ts: number; context?: C }
  | { type: "step_cache_miss"; workflowId: string; stepKey: string; name?: string; ts: number; context?: C }
  | { type: "step_skipped"; workflowId: string; stepKey?: string; name?: string; reason?: string; decisionId?: string; ts: number; context?: C }
  | { type: "scope_start"; workflowId: string; scopeId: string; scopeType: ScopeType; name?: string; ts: number; context?: C }
  | { type: "scope_end"; workflowId: string; scopeId: string; ts: number; durationMs: number; winnerId?: string; context?: C }
  // Retry events
  | {
      type: "step_retry";
      workflowId: string;
      stepId: string;
      stepKey?: string;
      name?: string;
      ts: number;
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      error: E;
      context?: C;
    }
  | {
      type: "step_retries_exhausted";
      workflowId: string;
      stepId: string;
      stepKey?: string;
      name?: string;
      ts: number;
      durationMs: number;
      attempts: number;
      lastError: E;
      context?: C;
    }
  // Timeout event
  | {
      type: "step_timeout";
      workflowId: string;
      stepId: string;
      stepKey?: string;
      name?: string;
      ts: number;
      timeoutMs: number;
      attempt?: number;
      context?: C;
    }
  // Hook events
  | {
      type: "hook_should_run";
      workflowId: string;
      ts: number;
      durationMs: number;
      result: boolean;
      skipped: boolean;
      context?: C;
    }
  | {
      type: "hook_should_run_error";
      workflowId: string;
      ts: number;
      durationMs: number;
      error: E;
      context?: C;
    }
  | {
      type: "hook_before_start";
      workflowId: string;
      ts: number;
      durationMs: number;
      result: boolean;
      skipped: boolean;
      context?: C;
    }
  | {
      type: "hook_before_start_error";
      workflowId: string;
      ts: number;
      durationMs: number;
      error: E;
      context?: C;
    }
  | {
      type: "hook_after_step";
      workflowId: string;
      stepKey: string;
      ts: number;
      durationMs: number;
      context?: C;
    }
  | {
      type: "hook_after_step_error";
      workflowId: string;
      stepKey: string;
      ts: number;
      durationMs: number;
      error: E;
      context?: C;
    }
  // Stream events
  | {
      type: "stream_created";
      workflowId: string;
      namespace: string;
      ts: number;
      context?: C;
    }
  | {
      type: "stream_write";
      workflowId: string;
      namespace: string;
      position: number;
      ts: number;
      context?: C;
    }
  | {
      type: "stream_read";
      workflowId: string;
      namespace: string;
      position: number;
      ts: number;
      context?: C;
    }
  | {
      type: "stream_close";
      workflowId: string;
      namespace: string;
      finalPosition: number;
      ts: number;
      context?: C;
    }
  | {
      type: "stream_error";
      workflowId: string;
      namespace: string;
      error: unknown;
      position: number;
      ts: number;
      context?: C;
    }
  | {
      type: "stream_backpressure";
      workflowId: string;
      namespace: string;
      bufferedCount: number;
      state: "paused" | "flowing";
      ts: number;
      context?: C;
    }
  // Workflow cancellation event
  | {
      type: "workflow_cancelled";
      workflowId: string;
      ts: number;
      durationMs: number;
      /** Reason from AbortSignal.reason (if provided) */
      reason?: string;
      /** Last successfully completed keyed step before cancellation (for resume purposes) */
      lastStepKey?: string;
      context?: C;
    };

// =============================================================================
// Run Options
// =============================================================================

export type RunOptionsWithCatch<E, C = void> = {
  /**
   * Handler for expected errors.
   * Called when a step fails with a known error type.
   */
  onError?: (error: E, stepName?: string, ctx?: C) => void;
  /**
   * Listener for workflow events (start, success, error, step events).
   * Use this for logging, telemetry, or debugging.
   *
   * Context is automatically included in `event.context` when provided via the `context` option.
   * The separate `ctx` parameter is provided for convenience.
   */
  onEvent?: (event: WorkflowEvent<E | UnexpectedError, C>, ctx: C) => void;
  /**
   * Catch-all mapper for unexpected exceptions.
   * Converts unknown exceptions (and cancellation) into your typed error union E.
   */
  catchUnexpected: (cause: unknown) => E;
  /**
   * Unique ID for this workflow execution.
   * Defaults to a random UUID.
   * Useful for correlating logs across distributed systems.
   */
  workflowId?: string;
  /**
   * Arbitrary context object passed to onEvent and onError.
   * Useful for passing request IDs, user IDs, or loggers.
   */
  context?: C;
  /**
   * @internal External signal for workflow-level cancellation.
   * Used by createWorkflow() to pass the workflow signal to steps.
   */
  _workflowSignal?: AbortSignal;
};

export type RunOptionsWithoutCatch<E, C = void> = {
  /**
   * Handler for expected errors AND unexpected errors.
   * Unexpected errors will be wrapped in `UnexpectedError`.
   */
  onError?: (error: E | UnexpectedError, stepName?: string, ctx?: C) => void;
  /**
   * Listener for workflow events (start, success, error, step events).
   *
   * Note: Context is available both on `event.context` and as the separate `ctx` parameter.
   * The `ctx` parameter is provided for convenience and backward compatibility.
   */
  onEvent?: (event: WorkflowEvent<E | UnexpectedError, C>, ctx: C) => void;
  catchUnexpected?: undefined;
  workflowId?: string;
  context?: C;
  /**
   * @internal External signal for workflow-level cancellation.
   * Used by createWorkflow() to pass the workflow signal to steps.
   */
  _workflowSignal?: AbortSignal;
};

export type RunOptions<E, C = void> = RunOptionsWithCatch<E, C> | RunOptionsWithoutCatch<E, C>;

// =============================================================================
// Early Exit Mechanism (exported for caching layer)
// =============================================================================

/**
 * Symbol used to identify early exit throws.
 * Exported for the caching layer in workflow.ts.
 * @internal
 */
export const EARLY_EXIT_SYMBOL: unique symbol = Symbol("early-exit");

/**
 * Metadata about how a step failed.
 * @internal
 */
export type StepFailureMeta =
  | { origin: "result"; resultCause?: unknown }
  | { origin: "throw"; thrown: unknown };

/**
 * Early exit object thrown to short-circuit workflow execution.
 * @internal
 */
export type EarlyExit<E> = {
  [EARLY_EXIT_SYMBOL]: true;
  error: E;
  meta: StepFailureMeta;
};

/**
 * Create an early exit throw object.
 * Used by the caching layer to synthesize early exits for cached errors.
 * @internal
 */
export function createEarlyExit<E>(error: E, meta: StepFailureMeta): EarlyExit<E> {
  return {
    [EARLY_EXIT_SYMBOL]: true,
    error,
    meta,
  };
}

/**
 * Type guard for early exit objects.
 * @internal
 */
export function isEarlyExit<E>(e: unknown): e is EarlyExit<E> {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as Record<PropertyKey, unknown>)[EARLY_EXIT_SYMBOL] === true
  );
}

/**
 * Symbol to mark exceptions thrown by catchUnexpected mappers.
 * These should propagate without being re-processed.
 * @internal
 */
const MAPPER_EXCEPTION_SYMBOL: unique symbol = Symbol("mapper-exception");

type MapperException = {
  [MAPPER_EXCEPTION_SYMBOL]: true;
  thrown: unknown;
};

function createMapperException(thrown: unknown): MapperException {
  return { [MAPPER_EXCEPTION_SYMBOL]: true, thrown };
}

function isMapperException(e: unknown): e is MapperException {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as Record<PropertyKey, unknown>)[MAPPER_EXCEPTION_SYMBOL] === true
  );
}

// =============================================================================
// Retry and Timeout Utilities
// =============================================================================

/**
 * Calculate the delay for a retry attempt based on the backoff strategy.
 * @internal
 */
function calculateRetryDelay(
  attempt: number,
  options: {
    backoff: BackoffStrategy;
    initialDelay: number;
    maxDelay: number;
    jitter: boolean;
  }
): number {
  const { backoff, initialDelay, maxDelay, jitter } = options;

  let delay: number;

  switch (backoff) {
    case "fixed":
      delay = initialDelay;
      break;
    case "linear":
      delay = initialDelay * attempt;
      break;
    case "exponential":
      delay = initialDelay * Math.pow(2, attempt - 1);
      break;
  }

  // Apply max cap
  delay = Math.min(delay, maxDelay);

  // Apply jitter (0-25% of delay)
  if (jitter) {
    const jitterAmount = delay * 0.25 * Math.random();
    delay = delay + jitterAmount;
  }

  return Math.floor(delay);
}

/**
 * Sleep for a specified number of milliseconds.
 * @internal
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Symbol used internally to identify timeout rejection.
 */
const TIMEOUT_SYMBOL: unique symbol = Symbol("timeout");
const TIMEOUT_OPTION_SYMBOL: unique symbol = Symbol("timeout-option");

/**
 * Check if an error is a timeout option marker (should return undefined instead of error).
 * @internal
 */
function isTimeoutOptionMarker(
  value: unknown
): value is { [TIMEOUT_OPTION_SYMBOL]: true; ms: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[TIMEOUT_OPTION_SYMBOL] === true
  );
}

/**
 * Execute an operation with a timeout using Promise.race.
 * @internal
 */
async function executeWithTimeout<T>(
  operation: (() => Promise<T>) | ((signal: AbortSignal) => Promise<T>),
  options: TimeoutOptions,
  stepInfo: { name?: string; key?: string; attempt?: number },
  /** External signal (e.g., workflow cancellation) to combine with timeout signal */
  externalSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const behavior = options.onTimeout ?? "error";

  // Create the timeout error based on behavior
  const createTimeoutError = (): unknown => {
    // For function behavior, call the handler to generate the error
    if (typeof behavior === "function") {
      return behavior({
        name: stepInfo.name,
        key: stepInfo.key,
        ms: options.ms,
      });
    }

    // For other behaviors, use custom error or default StepTimeoutError
    return (
      (options.error as StepTimeoutError) ?? {
        type: "STEP_TIMEOUT",
        stepName: stepInfo.name,
        stepKey: stepInfo.key,
        timeoutMs: options.ms,
        attempt: stepInfo.attempt,
      }
    );
  };

  // Track the timeout ID for cleanup
  let timeoutId: ReturnType<typeof setTimeout>;

  // If external signal is already aborted, abort immediately
  if (externalSignal?.aborted) {
    controller.abort(externalSignal.reason);
  }

  // Forward external signal abort to internal controller
  let externalAbortHandler: (() => void) | undefined;
  if (externalSignal && !externalSignal.aborted) {
    externalAbortHandler = () => controller.abort(externalSignal.reason);
    externalSignal.addEventListener("abort", externalAbortHandler, { once: true });
  }

  // Create a timeout promise that rejects after the specified duration
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      // For 'disconnect', don't abort - let operation continue in background
      if (behavior !== "disconnect") {
        controller.abort();
      }

      // For 'option', throw special marker to return undefined
      if (behavior === "option") {
        reject({ [TIMEOUT_OPTION_SYMBOL]: true, ms: options.ms });
        return;
      }

      // For all other behaviors, throw the timeout error
      reject({ [TIMEOUT_SYMBOL]: true, error: createTimeoutError() });
    }, options.ms);
  });

  // Execute the operation
  let operationPromise: Promise<T>;
  if (options.signal) {
    // Operation expects an AbortSignal
    // Pass the internal controller's signal which is linked to both timeout and external signal
    operationPromise = Promise.resolve(
      (operation as (signal: AbortSignal) => Promise<T>)(controller.signal)
    );
  } else {
    // Standard operation
    operationPromise = Promise.resolve((operation as () => Promise<T>)());
  }

  try {
    // Race between operation and timeout
    const result = await Promise.race([operationPromise, timeoutPromise]);
    return result;
  } catch (error) {
    // Check if this was an 'option' timeout - return undefined as success
    if (
      typeof error === "object" &&
      error !== null &&
      (error as Record<symbol, unknown>)[TIMEOUT_OPTION_SYMBOL] === true
    ) {
      // Throw special marker that step handler will convert to ok(undefined)
      throw { [TIMEOUT_OPTION_SYMBOL]: true, ms: options.ms };
    }

    // Check if this was our timeout
    if (
      typeof error === "object" &&
      error !== null &&
      (error as Record<symbol, unknown>)[TIMEOUT_SYMBOL] === true
    ) {
      // For 'disconnect' behavior, the operation continues in the background
      // Attach a catch handler to prevent unhandled rejection if it fails later
      if (behavior === "disconnect") {
        operationPromise.catch(() => {
          // Intentionally swallowed - operation was disconnected
        });
      }

      const errorToThrow = (error as { error: unknown }).error;

      // Mark the error with STEP_TIMEOUT_MARKER if it's a custom error (not already a StepTimeoutError)
      // This allows isStepTimeoutError() and getStepTimeoutMeta() to work with custom errors
      // Note: Always update metadata to reflect the current attempt (same error may be reused across retries)
      if (
        typeof errorToThrow === "object" &&
        errorToThrow !== null &&
        (errorToThrow as StepTimeoutError).type !== "STEP_TIMEOUT"
      ) {
        const meta: StepTimeoutMarkerMeta = {
          timeoutMs: options.ms,
          stepName: stepInfo.name,
          stepKey: stepInfo.key,
          attempt: stepInfo.attempt,
        };

        if (STEP_TIMEOUT_MARKER in errorToThrow) {
          // Update existing marker with current attempt's metadata
          (errorToThrow as Record<symbol, StepTimeoutMarkerMeta>)[STEP_TIMEOUT_MARKER] = meta;
        } else {
          // Define new marker (writable so it can be updated on retry)
          Object.defineProperty(errorToThrow, STEP_TIMEOUT_MARKER, {
            value: meta,
            enumerable: false,
            writable: true,
            configurable: false,
          });
        }
      }

      throw errorToThrow;
    }
    // Re-throw other errors
    throw error;
  } finally {
    // Always clear the timeout to prevent leaks
    clearTimeout(timeoutId!);
    // Clean up external signal listener
    if (externalAbortHandler && externalSignal) {
      externalSignal.removeEventListener("abort", externalAbortHandler);
    }
  }
}

/**
 * Default retry configuration values.
 * @internal
 */
const DEFAULT_RETRY_CONFIG = {
  backoff: "exponential" as BackoffStrategy,
  initialDelay: 100,
  maxDelay: 30000,
  jitter: true,
  retryOn: () => true,
  onRetry: () => {},
} as const;

// =============================================================================
// run() Function
// =============================================================================

/**
 * Execute a workflow with step-based error handling.
 *
 * ## When to Use run()
 *
 * Use `run()` when:
 * - Dependencies are dynamic (passed at runtime, not known at compile time)
 * - You don't need step caching or resume state
 * - Error types are known upfront and can be specified manually
 * - Building lightweight, one-off workflows
 *
 * For automatic error type inference from static dependencies, use `createWorkflow()`.
 *
 * ## Closed error union
 *
 * `run()` always returns a closed error type. Options determine the union:
 * - **`catchUnexpected`**: Maps uncaught exceptions to your type E → `Result<T, E>`
 * - **`onError`** (no catchUnexpected): Typed errors plus unexpected → `Result<T, E | UnexpectedError>`
 * - **No options**: All errors as UnexpectedError → `Result<T, UnexpectedError>`
 *
 * @see createWorkflow - For static dependencies with auto error inference
 */

/**
 * run() with catchUnexpected: closed union Result<T, E>.
 */
export function run<T, E, C = void>(
  fn: (step: RunStep<E>) => Promise<T> | T,
  options: RunOptionsWithCatch<E, C>
): AsyncResult<T, E, unknown>;

/**
 * run() with onError (no catchUnexpected): Result<T, E | UnexpectedError>.
 */
export function run<T, E, C = void>(
  fn: (step: RunStep<E | UnexpectedError>) => Promise<T> | T,
  options: {
    onError: (error: E | UnexpectedError, stepName?: string, ctx?: C) => void;
    onEvent?: (event: WorkflowEvent<E | UnexpectedError, C>, ctx: C) => void;
    workflowId?: string;
    context?: C;
    /** @internal External signal for workflow-level cancellation. */
    _workflowSignal?: AbortSignal;
  }
): AsyncResult<T, E | UnexpectedError, unknown>;

/**
 * run() with no options: Result<T, UnexpectedError>.
 * All errors (typed or thrown) are returned as UnexpectedError.
 */
export function run<T, C = void>(
  fn: (step: RunStep) => Promise<T> | T,
  options?: {
    onEvent?: (event: WorkflowEvent<UnexpectedError, C>, ctx: C) => void;
    workflowId?: string;
    context?: C;
    /** @internal External signal for workflow-level cancellation. */
    _workflowSignal?: AbortSignal;
  }
): AsyncResult<T, UnexpectedError, unknown>;

// Implementation
export async function run<T, E, C = void>(
  fn: (step: RunStep<E | UnexpectedError>) => Promise<T> | T,
  options?: RunOptions<E, C>
): AsyncResult<T, E | UnexpectedError> {
  const {
    onError,
    onEvent,
    catchUnexpected,
    workflowId: providedWorkflowId,
    context,
    _workflowSignal,
  } = options && typeof options === "object"
    ? (options as RunOptions<E, C>)
    : ({} as RunOptions<E, C>);

  const workflowId = providedWorkflowId ?? crypto.randomUUID();
  const wrapMode = !onError && !catchUnexpected;

  // Track active scopes as a stack for proper nesting
  // When a step succeeds, only the innermost race scope gets the winner
  const activeScopeStack: Array<{ scopeId: string; type: ScopeType; winnerId?: string }> = [];

  // Counter for generating unique step IDs
  let stepIdCounter = 0;

  // Generate a unique step ID
  // Uses stepKey when provided (for cache stability), otherwise generates a unique ID.
  // Note: name is NOT used for stepId because multiple concurrent steps may share a name,
  // which would cause them to collide in activeSteps tracking and race winner detection.
  const generateStepId = (stepKey?: string): string => {
    return stepKey ?? `step_${++stepIdCounter}`;
  };

  const emitEvent = (event: WorkflowEvent<E | UnexpectedError, C>) => {
    // Add context to event only if:
    // 1. Event doesn't already have context (preserves replayed events or per-step overrides)
    // 2. Workflow actually has a context (don't add context: undefined property)
    const eventWithContext = 
      event.context !== undefined || context === undefined
        ? event
        : ({ ...event, context: context as C } as WorkflowEvent<E | UnexpectedError, C>);
    
    // Track first successful step in the innermost race scope for winnerId
    if (eventWithContext.type === "step_success") {
      // Use the stepId from the event (already generated at step start)
      const stepId = eventWithContext.stepId;

      // Find innermost race scope (search from end of stack)
      for (let i = activeScopeStack.length - 1; i >= 0; i--) {
        const scope = activeScopeStack[i];
        if (scope.type === "race" && !scope.winnerId) {
          scope.winnerId = stepId;
          break; // Only update innermost race scope
        }
      }
    }
    onEvent?.(eventWithContext, context as C);
  };

  // Use the exported early exit function with proper type parameter
  const earlyExit = createEarlyExit<E>;

  // Local type guard that narrows to EarlyExit<E> specifically
  const isEarlyExitE = (e: unknown): e is EarlyExit<E> => isEarlyExit(e);

  const wrapForStep = (
    error: unknown,
    meta?: StepFailureMeta
  ): E | UnexpectedError => {
    if (!wrapMode) {
      return error as E;
    }

    if (meta?.origin === "result") {
      return {
        type: "UNEXPECTED_ERROR",
        cause: {
          type: "STEP_FAILURE",
          origin: "result",
          error,
          ...(meta.resultCause !== undefined
            ? { cause: meta.resultCause }
            : {}),
        },
      };
    }

    if (meta?.origin === "throw") {
      return {
        type: "UNEXPECTED_ERROR",
        cause: {
          type: "STEP_FAILURE",
          origin: "throw",
          error,
          thrown: meta.thrown,
        },
      };
    }

    return {
      type: "UNEXPECTED_ERROR",
      cause: {
        type: "STEP_FAILURE",
        origin: "result",
        error,
      },
    };
  };

  const unexpectedFromFailure = (failure: EarlyExit<E>): UnexpectedError => ({
    type: "UNEXPECTED_ERROR",
    cause:
      failure.meta.origin === "result"
        ? {
            type: "STEP_FAILURE" as const,
            origin: "result" as const,
            error: failure.error,
            ...(failure.meta.resultCause !== undefined
              ? { cause: failure.meta.resultCause }
              : {}),
          }
        : {
            type: "STEP_FAILURE" as const,
            origin: "throw" as const,
            error: failure.error,
            thrown: failure.meta.thrown,
          },
  });

  // Helper to check if a value is a Result (has ok property) vs a function
  const isResultLike = (value: unknown): value is Result<unknown, unknown, unknown> | Promise<Result<unknown, unknown, unknown>> => {
    if (typeof value === 'function') return false;
    if (value && typeof value === 'object' && 'ok' in value) return true;
    // Check for Promise<Result> - it will have a then method
    if (value && typeof value === 'object' && 'then' in value && typeof (value as Promise<unknown>).then === 'function') return true;
    return false;
  };

  try {
    // Step function: requires step('id', fn, opts) or step('id', result, opts)
    const stepFn = <T, StepE, StepC = unknown>(
      id: string,
      operationOrResult: (() => Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>) | Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>,
      stepOptions?: StepOptions
    ): Promise<T> => {
      return (async () => {
        // Validate required string ID
        if (typeof id !== 'string' || id.length === 0) {
          throw new Error(
            '[awaitly] step() requires an explicit string ID as the first argument. ' +
            'Example: step("fetchUser", () => fetchUser(id))'
          );
        }

        const parsedOptions: StepOptions = stepOptions ?? {};

        // Name is always derived from ID
        const stepName = id;
        const stepKey = parsedOptions.key ?? id;  // For general events (step_start, step_success, etc.)
        const explicitKey = parsedOptions.key ?? id;  // For step_complete and caching (ID is used when no key)
        const { description: stepDescription, retry: retryConfig, timeout: timeoutConfig } = parsedOptions;
        const stepId = generateStepId(stepKey);
        const hasEventListeners = onEvent;
        const overallStartTime = hasEventListeners ? performance.now() : 0;

        // Determine if this is a direct Result or a function
        const isDirectResult = isResultLike(operationOrResult);
        const operation = isDirectResult
          ? () => operationOrResult as Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>
          : operationOrResult as () => Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>;

        // Build effective retry config with defaults
        // Ensure at least 1 attempt (0 would skip the loop entirely and crash)
        const maxAttempts = Math.max(1, retryConfig?.attempts ?? 1);
        const effectiveRetry = {
          attempts: maxAttempts,
          backoff: retryConfig?.backoff ?? DEFAULT_RETRY_CONFIG.backoff,
          initialDelay: retryConfig?.initialDelay ?? DEFAULT_RETRY_CONFIG.initialDelay,
          maxDelay: retryConfig?.maxDelay ?? DEFAULT_RETRY_CONFIG.maxDelay,
          jitter: retryConfig?.jitter ?? DEFAULT_RETRY_CONFIG.jitter,
          retryOn: retryConfig?.retryOn ?? DEFAULT_RETRY_CONFIG.retryOn,
          onRetry: retryConfig?.onRetry ?? DEFAULT_RETRY_CONFIG.onRetry,
        };

        // Emit step_start only once (before first attempt)
        if (onEvent) {
          emitEvent({
            type: "step_start",
            workflowId,
            stepId,
            stepKey,
            name: stepName,
            description: stepDescription,
            ts: Date.now(),
          });
        }

        let lastResult: Result<T, StepE, StepC> | undefined;

        for (let attempt = 1; attempt <= effectiveRetry.attempts; attempt++) {
          const attemptStartTime = hasEventListeners ? performance.now() : 0;

          try {
            // Execute operation with optional timeout
            let result: Result<T, StepE, StepC>;

            if (timeoutConfig) {
              // Wrap with timeout, passing workflow signal for { signal: true } steps
              result = await executeWithTimeout(
                operation as () => Promise<Result<T, StepE, StepC>>,
                timeoutConfig,
                { name: stepName, key: stepKey, attempt },
                _workflowSignal
              );
            } else {
              result = await operation();
            }

            // Success case
            if (result.ok) {
              const durationMs = performance.now() - overallStartTime;
              emitEvent({
                type: "step_success",
                workflowId,
                stepId,
                stepKey,
                name: stepName,
                description: stepDescription,
                ts: Date.now(),
                durationMs,
              });
              if (explicitKey) {
                emitEvent({
                  type: "step_complete",
                  workflowId,
                  stepKey: explicitKey,
                  name: stepName,
                  description: stepDescription,
                  ts: Date.now(),
                  durationMs,
                  result,
                });
              }
              return result.value;
            }

            // Result error case - check if we should retry
            lastResult = result;

            if (attempt < effectiveRetry.attempts && effectiveRetry.retryOn(result.error, attempt)) {
              const delay = calculateRetryDelay(attempt, effectiveRetry);

              // Emit retry event
              emitEvent({
                type: "step_retry",
                workflowId,
                stepId,
                stepKey,
                name: stepName,
                ts: Date.now(),
                attempt: attempt + 1,
                maxAttempts: effectiveRetry.attempts,
                delayMs: delay,
                error: result.error as unknown as E,
              });

              effectiveRetry.onRetry(result.error, attempt, delay);
              await sleep(delay);
              continue;
            }

            // No more retries or retryOn returned false - emit exhausted event if we retried
            if (effectiveRetry.attempts > 1) {
              emitEvent({
                type: "step_retries_exhausted",
                workflowId,
                stepId,
                stepKey,
                name: stepName,
                ts: Date.now(),
                durationMs: performance.now() - overallStartTime,
                attempts: attempt,
                lastError: result.error as unknown as E,
              });
            }

            // Fall through to final error handling below
            break;

          } catch (thrown) {
            const durationMs = performance.now() - attemptStartTime;

            // Handle timeout with 'option' behavior - return undefined as success
            if (isTimeoutOptionMarker(thrown)) {
              const timeoutMs = thrown.ms;
              emitEvent({
                type: "step_timeout",
                workflowId,
                stepId,
                stepKey,
                name: stepName,
                ts: Date.now(),
                timeoutMs,
                attempt,
              });
              emitEvent({
                type: "step_success",
                workflowId,
                stepId,
                stepKey,
                name: stepName,
                description: stepDescription,
                ts: Date.now(),
                durationMs: performance.now() - overallStartTime,
              });
              if (explicitKey) {
                emitEvent({
                  type: "step_complete",
                  workflowId,
                  stepKey: explicitKey,
                  name: stepName,
                  description: stepDescription,
                  ts: Date.now(),
                  durationMs: performance.now() - overallStartTime,
                  result: ok(undefined),
                });
              }
              // Return undefined as success value (timeout was treated as optional)
              return undefined as T;
            }

            // Handle early exit - propagate immediately
            if (isEarlyExitE(thrown)) {
              emitEvent({
                type: "step_aborted",
                workflowId,
                stepId,
                stepKey,
                name: stepName,
                description: stepDescription,
                ts: Date.now(),
                durationMs,
              });
              throw thrown;
            }

            // Handle timeout error
            if (isStepTimeoutError(thrown)) {
              // Get timeout metadata from the error (works for both standard and custom errors)
              const timeoutMeta = getStepTimeoutMeta(thrown);
              const timeoutMs = timeoutConfig?.ms ?? timeoutMeta?.timeoutMs ?? 0;
              emitEvent({
                type: "step_timeout",
                workflowId,
                stepId,
                stepKey,
                name: stepName,
                ts: Date.now(),
                timeoutMs,
                attempt,
              });

              // Check if we should retry after timeout
              if (attempt < effectiveRetry.attempts && effectiveRetry.retryOn(thrown, attempt)) {
                const delay = calculateRetryDelay(attempt, effectiveRetry);

                emitEvent({
                  type: "step_retry",
                  workflowId,
                  stepId,
                  stepKey,
                  name: stepName,
                  ts: Date.now(),
                  attempt: attempt + 1,
                  maxAttempts: effectiveRetry.attempts,
                  delayMs: delay,
                  error: thrown as unknown as E,
                });

                effectiveRetry.onRetry(thrown, attempt, delay);
                await sleep(delay);
                continue;
              }

              // No more retries - emit exhausted if we retried
              if (effectiveRetry.attempts > 1) {
                emitEvent({
                  type: "step_retries_exhausted",
                  workflowId,
                  stepId,
                  stepKey,
                  name: stepName,
                  ts: Date.now(),
                  durationMs: performance.now() - overallStartTime,
                  attempts: attempt,
                  lastError: thrown as unknown as E,
                });
              }

              // Treat STEP_TIMEOUT as a typed error - exit directly without UNEXPECTED_ERROR wrapper
              // This provides better DX: users get STEP_TIMEOUT directly in result.error
              const totalDurationMs = performance.now() - overallStartTime;
              emitEvent({
                type: "step_error",
                workflowId,
                stepId,
                stepKey,
                name: stepName,
                description: stepDescription,
                ts: Date.now(),
                durationMs: totalDurationMs,
                error: thrown as unknown as E,
              });
              if (explicitKey) {
                emitEvent({
                  type: "step_complete",
                  workflowId,
                  stepKey: explicitKey,
                  name: stepName,
                  description: stepDescription,
                  ts: Date.now(),
                  durationMs: totalDurationMs,
                  result: err(thrown as unknown as E, { cause: thrown }),
                  meta: { origin: "throw", thrown },
                });
              }
              onError?.(thrown as unknown as E, stepName, context);
              throw earlyExit(thrown as unknown as E, { origin: "throw", thrown });
            }

            // Handle other thrown errors (continue to error handling below)

            // Check if we should retry thrown errors
            if (attempt < effectiveRetry.attempts && effectiveRetry.retryOn(thrown, attempt)) {
              const delay = calculateRetryDelay(attempt, effectiveRetry);

              emitEvent({
                type: "step_retry",
                workflowId,
                stepId,
                stepKey,
                name: stepName,
                ts: Date.now(),
                attempt: attempt + 1,
                maxAttempts: effectiveRetry.attempts,
                delayMs: delay,
                error: thrown as unknown as E,
              });

              effectiveRetry.onRetry(thrown, attempt, delay);
              await sleep(delay);
              continue;
            }

            // No more retries for thrown errors - emit exhausted if we retried
            if (effectiveRetry.attempts > 1 && !isStepTimeoutError(thrown)) {
              emitEvent({
                type: "step_retries_exhausted",
                workflowId,
                stepId,
                stepKey,
                name: stepName,
                ts: Date.now(),
                durationMs: performance.now() - overallStartTime,
                attempts: attempt,
                lastError: thrown as unknown as E,
              });
            }

            // Handle the error based on mode
            const totalDurationMs = performance.now() - overallStartTime;

            if (catchUnexpected) {
              let mappedError: E;
              try {
                mappedError = catchUnexpected(thrown) as unknown as E;
              } catch (mapperError) {
                throw createMapperException(mapperError);
              }
              emitEvent({
                type: "step_error",
                workflowId,
                stepId,
                stepKey,
                name: stepName,
                description: stepDescription,
                ts: Date.now(),
                durationMs: totalDurationMs,
                error: mappedError,
              });
              if (explicitKey) {
                emitEvent({
                  type: "step_complete",
                  workflowId,
                  stepKey: explicitKey,
                  name: stepName,
                  description: stepDescription,
                  ts: Date.now(),
                  durationMs: totalDurationMs,
                  result: err(mappedError, { cause: thrown }),
                  meta: { origin: "throw", thrown },
                });
              }
              onError?.(mappedError as E, stepName, context);
              throw earlyExit(mappedError as E, { origin: "throw", thrown });
            } else {
              const unexpectedError: UnexpectedError = {
                type: "UNEXPECTED_ERROR",
                cause: { type: "UNCAUGHT_EXCEPTION", thrown },
              };
              emitEvent({
                type: "step_error",
                workflowId,
                stepId,
                stepKey,
                name: stepName,
                description: stepDescription,
                ts: Date.now(),
                durationMs: totalDurationMs,
                error: unexpectedError,
              });
              if (explicitKey) {
                emitEvent({
                  type: "step_complete",
                  workflowId,
                  stepKey: explicitKey,
                  name: stepName,
                  description: stepDescription,
                  ts: Date.now(),
                  durationMs: totalDurationMs,
                  result: err(unexpectedError, { cause: thrown }),
                  meta: { origin: "throw", thrown },
                });
              }
              throw thrown;
            }
          }
        }

        // All retries exhausted with Result error - handle final error
        // At this point lastResult must be an error result (we only reach here on error)
        const errorResult = lastResult as { ok: false; error: StepE; cause?: StepC };
        const totalDurationMs = performance.now() - overallStartTime;
        const wrappedError = wrapForStep(errorResult.error, {
          origin: "result",
          resultCause: errorResult.cause,
        });
        emitEvent({
          type: "step_error",
          workflowId,
          stepId,
          stepKey,
          name: stepName,
          description: stepDescription,
          ts: Date.now(),
          durationMs: totalDurationMs,
          error: wrappedError,
        });
        if (explicitKey) {
          emitEvent({
            type: "step_complete",
            workflowId,
            stepKey: explicitKey,
            name: stepName,
            description: stepDescription,
            ts: Date.now(),
            durationMs: totalDurationMs,
            result: errorResult,
            meta: { origin: "result", resultCause: errorResult.cause },
          });
        }
        onError?.(errorResult.error as unknown as E, stepName, context);
        throw earlyExit(errorResult.error as unknown as E, {
          origin: "result",
          resultCause: errorResult.cause,
        });
      })();
    };

    stepFn.try = <T, Err>(
      id: string,
      operation: () => T | Promise<T>,
      opts:
        | { error: Err; key?: string }
        | { onError: (cause: unknown) => Err; key?: string }
    ): Promise<T> => {
      // Validate required string ID
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error(
          '[awaitly] step.try() requires an explicit string ID as the first argument. ' +
          'Example: step.try("parse", () => JSON.parse(str), { error: "PARSE_ERROR" })'
        );
      }

      const stepKey = opts.key ?? id; // Use id as key if not provided
      const stepName = id; // Name is always the id
      const stepId = id;
      const mapToError = "error" in opts ? () => opts.error : opts.onError;
      const hasEventListeners = onEvent;

      return (async () => {
        const startTime = hasEventListeners ? performance.now() : 0;

        if (onEvent) {
          emitEvent({
            type: "step_start",
            workflowId,
            stepId,
            stepKey,
            name: stepName,
            ts: Date.now(),
          });
        }

        try {
          const value = await operation();
          const durationMs = performance.now() - startTime;
          emitEvent({
            type: "step_success",
            workflowId,
            stepId,
            stepKey,
            name: stepName,
            ts: Date.now(),
            durationMs,
          });
          // Emit step_complete for keyed steps (for state persistence)
          if (stepKey) {
            emitEvent({
              type: "step_complete",
              workflowId,
              stepKey,
              name: stepName,
              ts: Date.now(),
              durationMs,
              result: ok(value),
            });
          }
          return value;
        } catch (error) {
          const mapped = mapToError(error);
          const durationMs = performance.now() - startTime;
          const wrappedError = wrapForStep(mapped, { origin: "throw", thrown: error });
          emitEvent({
            type: "step_error",
            workflowId,
            stepId,
            stepKey,
            name: stepName,
            ts: Date.now(),
            durationMs,
            error: wrappedError,
          });
          // Emit step_complete for keyed steps (for state persistence)
          // Note: For step.try errors, we encode the mapped error, not the original thrown
          if (stepKey) {
            emitEvent({
              type: "step_complete",
              workflowId,
              stepKey,
              name: stepName,
              ts: Date.now(),
              durationMs,
              result: err(mapped, { cause: error }),
              meta: { origin: "throw", thrown: error },
            });
          }
          onError?.(mapped as unknown as E, stepName, context);
          throw earlyExit(mapped as unknown as E, { origin: "throw", thrown: error });
        }
      })();
    };

    // step.fromResult: Execute a Result-returning function and map its typed error
    stepFn.fromResult = <T, ResultE, Err>(
      id: string,
      operation: () => Result<T, ResultE, unknown> | AsyncResult<T, ResultE, unknown>,
      opts:
        | { error: Err; key?: string }
        | { onError: (resultError: ResultE) => Err; key?: string }
    ): Promise<T> => {
      // Validate required string ID
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error(
          '[awaitly] step.fromResult() requires an explicit string ID as the first argument. ' +
          'Example: step.fromResult("callProvider", () => callProvider(input), { onError: (e) => ({ type: "FAILED" }) })'
        );
      }

      const stepKey = opts.key ?? id; // Use id as key if not provided
      const stepName = id; // Name is always the id
      const stepId = id;
      const mapToError = "error" in opts ? () => opts.error : opts.onError;
      const hasEventListeners = onEvent;

      return (async () => {
        const startTime = hasEventListeners ? performance.now() : 0;

        if (onEvent) {
          emitEvent({
            type: "step_start",
            workflowId,
            stepId,
            stepKey,
            name: stepName,
            ts: Date.now(),
          });
        }

        const result = await operation();

        if (result.ok) {
          const durationMs = performance.now() - startTime;
          emitEvent({
            type: "step_success",
            workflowId,
            stepId,
            stepKey,
            name: stepName,
            ts: Date.now(),
            durationMs,
          });
          // Emit step_complete for keyed steps (for state persistence)
          if (stepKey) {
            emitEvent({
              type: "step_complete",
              workflowId,
              stepKey,
              name: stepName,
              ts: Date.now(),
              durationMs,
              result: ok(result.value),
            });
          }
          return result.value;
        } else {
          const mapped = mapToError(result.error);
          const durationMs = performance.now() - startTime;
          // For fromResult, the cause is the original result.error (what got mapped)
          // This is analogous to step.try using thrown exception as cause
          const wrappedError = wrapForStep(mapped, {
            origin: "result",
            resultCause: result.error,
          });
          emitEvent({
            type: "step_error",
            workflowId,
            stepId,
            stepKey,
            name: stepName,
            ts: Date.now(),
            durationMs,
            error: wrappedError,
          });
          // Emit step_complete for keyed steps (for state persistence)
          if (stepKey) {
            emitEvent({
              type: "step_complete",
              workflowId,
              stepKey,
              name: stepName,
              ts: Date.now(),
              durationMs,
              result: err(mapped, { cause: result.error }),
              meta: { origin: "result", resultCause: result.error },
            });
          }
          onError?.(mapped as unknown as E, stepName, context);
          throw earlyExit(mapped as unknown as E, {
            origin: "result",
            resultCause: result.error,
          });
        }
      })();
    };

    // step.retry: Execute an operation with retry and optional timeout
    stepFn.retry = <T, StepE, StepC = unknown>(
      id: string,
      operation: () => Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>,
      options: RetryOptions & { key?: string; timeout?: TimeoutOptions }
    ): Promise<T> => {
      // Validate required string ID
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error(
          '[awaitly] step.retry() requires an explicit string ID as the first argument. ' +
          'Example: step.retry("fetchData", () => fetchData(), { attempts: 3 })'
        );
      }

      // Delegate to stepFn with retry options merged into StepOptions
      // Use key for caching if provided, otherwise use id
      return stepFn(id, operation, {
        key: options.key ?? id,
        retry: {
          attempts: options.attempts,
          backoff: options.backoff,
          initialDelay: options.initialDelay,
          maxDelay: options.maxDelay,
          jitter: options.jitter,
          retryOn: options.retryOn,
          onRetry: options.onRetry,
        },
        timeout: options.timeout,
      });
    };

    // step.withTimeout: Execute an operation with a timeout
    stepFn.withTimeout = <T, StepE, StepC = unknown>(
      id: string,
      operation:
        | (() => Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>)
        | ((signal: AbortSignal) => Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>),
      options: TimeoutOptions & { key?: string }
    ): Promise<T> => {
      // Validate required string ID
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error(
          '[awaitly] step.withTimeout() requires an explicit string ID as the first argument. ' +
          'Example: step.withTimeout("slowOp", () => slowOp(), { ms: 5000 })'
        );
      }

      // Delegate to stepFn with timeout options
      // The signal handling happens in executeWithTimeout when timeout.signal is true
      // Use key for caching if provided, otherwise use id
      return stepFn(
        id,
        operation as () => Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>,
        {
          key: options.key ?? id,
          timeout: options,
        }
      );
    };

    // step.sleep: Pause execution for a specified duration
    stepFn.sleep = (
      id: string,
      duration: DurationInput,
      options?: { key?: string; ttl?: number; description?: string; signal?: AbortSignal }
    ): Promise<void> => {
      // Validate required string ID
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error(
          '[awaitly] step.sleep() requires an explicit string ID as the first argument. ' +
          'Example: step.sleep("delay", "5s")'
        );
      }

      // Parse duration - inline to avoid importing duration module
      const d = typeof duration === "string" ? parseDurationString(duration) : duration;
      if (!d) {
        throw new Error(`step.sleep: invalid duration '${duration}'`);
      }
      const ms = d.millis;
      const userSignal = options?.signal;

      // Delegate to stepFn with a cancellation-aware sleep operation
      // Use key for caching if provided, otherwise use id
      return stepFn(
        id,
        async (): AsyncResult<void, never> => {
          // Check if already aborted (workflow or user signal)
          if (_workflowSignal?.aborted || userSignal?.aborted) {
            const e = new Error("Sleep aborted");
            e.name = "AbortError";
            throw e;
          }

          return new Promise<Result<void, never>>((resolve, reject) => {
            // Using object to avoid prefer-const warning while allowing
            // onAbort to reference the timeout before it's assigned
            const state = { timeoutId: undefined as ReturnType<typeof setTimeout> | undefined };

            const onAbort = () => {
              if (state.timeoutId) clearTimeout(state.timeoutId);
              const e = new Error("Sleep aborted");
              e.name = "AbortError";
              reject(e);
            };

            _workflowSignal?.addEventListener("abort", onAbort, { once: true });
            userSignal?.addEventListener("abort", onAbort, { once: true });

            state.timeoutId = setTimeout(() => {
              _workflowSignal?.removeEventListener("abort", onAbort);
              userSignal?.removeEventListener("abort", onAbort);
              resolve(ok(undefined));
            }, ms);
          });
        },
        {
          key: options?.key ?? id,
          description: options?.description,
        }
      );
    };

    // step.parallel: Execute parallel operations with scope events
    // 1. Object form: step.parallel(name, { key: fn | { fn, errors } })
    // 2. Array form: step.parallel(name, () => allAsync([...]))
    stepFn.parallel = ((...args: unknown[]): Promise<unknown> => {
      if (typeof args[0] !== "string") {
        throw new TypeError(
          "step.parallel(name, ...): first argument must be a string (step name). Example: step.parallel('Fetch data', { user: () => fetchUser(), posts: () => fetchPosts() })"
        );
      }
      const name = args[0] as string;
      const second = args[1];
      if (typeof second === "function") {
        return executeParallelArray(name, second as () => MaybeAsyncResult<unknown[], unknown, unknown>);
      }
      if (second && typeof second === "object" && !Array.isArray(second)) {
        const rawOperations = second as Record<string, (() => MaybeAsyncResult<unknown, unknown, unknown>) | ParallelOperationDescriptor<unknown, readonly string[]>>;
        const normalizedOperations = normalizeParallelOperations(rawOperations);
        return executeParallelNamed(normalizedOperations, { name });
      }
      throw new TypeError(
        "step.parallel(name, ...): second argument must be a function (array form) or an object of operations (object form)."
      );
    }) as RunStep<E>["parallel"];

    function normalizeParallelOperations(
      rawOperations: Record<string, (() => MaybeAsyncResult<unknown, unknown, unknown>) | ParallelOperationDescriptor<unknown, readonly string[]>>
    ): Record<string, () => MaybeAsyncResult<unknown, unknown, unknown>> {
      const out: Record<string, () => MaybeAsyncResult<unknown, unknown, unknown>> = {};
      for (const [key, value] of Object.entries(rawOperations)) {
        if (typeof value === "function") {
          out[key] = value;
        } else if (value && typeof value === "object" && "fn" in value) {
          out[key] = value.fn;
        } else {
          throw new TypeError(`step.parallel: operation "${key}" must be a function or { fn, errors? } object`);
        }
      }
      return out;
    }

    // Array form implementation
    function executeParallelArray<T>(
      name: string,
      operation: () => MaybeAsyncResult<T[], unknown, unknown>
    ): Promise<T[]> {
      const scopeId = `scope_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      return (async () => {
        const startTime = performance.now();
        let scopeEnded = false;

        // Push this scope onto the stack for proper nesting tracking
        activeScopeStack.push({ scopeId, type: "parallel" });

        // Helper to emit scope_end exactly once
        const emitScopeEnd = () => {
          if (scopeEnded) return;
          scopeEnded = true;
          // Pop this scope from the stack
          const idx = activeScopeStack.findIndex(s => s.scopeId === scopeId);
          if (idx !== -1) activeScopeStack.splice(idx, 1);
          emitEvent({
            type: "scope_end",
            workflowId,
            scopeId,
            ts: Date.now(),
            durationMs: performance.now() - startTime,
          });
        };

        // Emit scope_start event
        emitEvent({
          type: "scope_start",
          workflowId,
          scopeId,
          scopeType: "parallel",
          name,
          ts: Date.now(),
        });

        try {
          const result = await operation();

          // Emit scope_end before processing result
          emitScopeEnd();

          if (!result.ok) {
            onError?.(result.error as unknown as E, name, context);
            throw earlyExit(result.error as unknown as E, {
              origin: "result",
              resultCause: result.cause,
            });
          }

          return result.value;
        } catch (error) {
          // Always emit scope_end in finally-like fashion
          emitScopeEnd();
          throw error;
        }
      })();
    }

    // Named object form implementation - execute each operation in parallel
    function executeParallelNamed<T extends Record<string, unknown>>(
      operations: Record<string, () => MaybeAsyncResult<unknown, unknown, unknown>>,
      options: { name?: string }
    ): Promise<T> {
      const keys = Object.keys(operations);
      const name = options.name ?? `Parallel(${keys.join(", ")})`;
      const scopeId = `scope_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      return (async () => {
        const startTime = performance.now();
        let scopeEnded = false;

        // Push this scope onto the stack for proper nesting tracking
        activeScopeStack.push({ scopeId, type: "parallel" });

        // Helper to emit scope_end exactly once
        const emitScopeEnd = () => {
          if (scopeEnded) return;
          scopeEnded = true;
          const idx = activeScopeStack.findIndex(s => s.scopeId === scopeId);
          if (idx !== -1) activeScopeStack.splice(idx, 1);
          emitEvent({
            type: "scope_end",
            workflowId,
            scopeId,
            ts: Date.now(),
            durationMs: performance.now() - startTime,
          });
        };

        // Emit scope_start event with operation names in metadata
        emitEvent({
          type: "scope_start",
          workflowId,
          scopeId,
          scopeType: "parallel",
          name,
          ts: Date.now(),
        });

        try {
          // Execute all operations in parallel, fail-fast on first error
          const results = await new Promise<{ key: string; result: Result<unknown, unknown, unknown> }[]>((resolve) => {
            if (keys.length === 0) {
              resolve([]);
              return;
            }

            let settled = false;
            let pendingCount = keys.length;
            const resultArray: { key: string; result: Result<unknown, unknown, unknown> }[] = new Array(keys.length);

            for (let i = 0; i < keys.length; i++) {
              const key = keys[i];
              const index = i;

              Promise.resolve(operations[key]())
                .catch((reason) => err(
                  { type: "PROMISE_REJECTED" as const, cause: reason },
                  { cause: { type: "PROMISE_REJECTION" as const, reason } }
                ))
                .then((result) => {
                  if (settled) return;

                  // Fail-fast: if any operation fails, resolve immediately with just the failed entry
                  if (!result.ok) {
                    settled = true;
                    resolve([{ key, result }]);
                    return;
                  }

                  resultArray[index] = { key, result };
                  pendingCount--;

                  if (pendingCount === 0) {
                    resolve(resultArray);
                  }
                });
            }
          });

          // Emit scope_end before processing results
          emitScopeEnd();

          // Check for errors and build result object
          const output: Record<string, unknown> = {};
          for (const { key, result } of results) {
            if (!result.ok) {
              onError?.(result.error as unknown as E, key, context);
              throw earlyExit(result.error as unknown as E, {
                origin: "result",
                resultCause: result.cause,
              });
            }
            output[key] = result.value;
          }

          return output as T;
        } catch (error) {
          // Always emit scope_end in finally-like fashion
          emitScopeEnd();
          throw error;
        }
      })();
    }

    // step.race: Execute a race operation with scope events
    stepFn.race = <T, StepE, StepC>(
      name: string,
      operation: () => Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>
    ): Promise<T> => {
      const scopeId = `scope_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      return (async () => {
        const startTime = performance.now();
        let scopeEnded = false;

        // Push this race scope onto the stack to track the first successful step as winner
        const scopeEntry = { scopeId, type: "race" as const, winnerId: undefined as string | undefined };
        activeScopeStack.push(scopeEntry);

        // Helper to emit scope_end exactly once, including winnerId
        const emitScopeEnd = () => {
          if (scopeEnded) return;
          scopeEnded = true;
          // Pop this scope from the stack
          const idx = activeScopeStack.findIndex(s => s.scopeId === scopeId);
          if (idx !== -1) activeScopeStack.splice(idx, 1);
          emitEvent({
            type: "scope_end",
            workflowId,
            scopeId,
            ts: Date.now(),
            durationMs: performance.now() - startTime,
            winnerId: scopeEntry.winnerId,
          });
        };

        // Emit scope_start event
        emitEvent({
          type: "scope_start",
          workflowId,
          scopeId,
          scopeType: "race",
          name,
          ts: Date.now(),
        });

        try {
          const result = await operation();

          // Emit scope_end before processing result
          emitScopeEnd();

          if (!result.ok) {
            onError?.(result.error as unknown as E, name, context);
            throw earlyExit(result.error as unknown as E, {
              origin: "result",
              resultCause: result.cause,
            });
          }

          return result.value;
        } catch (error) {
          // Always emit scope_end in finally-like fashion
          emitScopeEnd();
          throw error;
        }
      })();
    };

    // step.allSettled: Execute an allSettled operation with scope events
    stepFn.allSettled = <T, StepE, StepC>(
      name: string,
      operation: () => Result<T[], StepE, StepC> | AsyncResult<T[], StepE, StepC>
    ): Promise<T[]> => {
      const scopeId = `scope_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      return (async () => {
        const startTime = performance.now();
        let scopeEnded = false;

        // Push this scope onto the stack for proper nesting tracking
        activeScopeStack.push({ scopeId, type: "allSettled" });

        // Helper to emit scope_end exactly once
        const emitScopeEnd = () => {
          if (scopeEnded) return;
          scopeEnded = true;
          // Pop this scope from the stack
          const idx = activeScopeStack.findIndex(s => s.scopeId === scopeId);
          if (idx !== -1) activeScopeStack.splice(idx, 1);
          emitEvent({
            type: "scope_end",
            workflowId,
            scopeId,
            ts: Date.now(),
            durationMs: performance.now() - startTime,
          });
        };

        // Emit scope_start event
        emitEvent({
          type: "scope_start",
          workflowId,
          scopeId,
          scopeType: "allSettled",
          name,
          ts: Date.now(),
        });

        try {
          const result = await operation();

          // Emit scope_end before processing result
          emitScopeEnd();

          if (!result.ok) {
            onError?.(result.error as unknown as E, name, context);
            throw earlyExit(result.error as unknown as E, {
              origin: "result",
              resultCause: result.cause,
            });
          }

          return result.value;
        } catch (error) {
          // Always emit scope_end in finally-like fashion
          emitScopeEnd();
          throw error;
        }
      })();
    };

    // step.if: Mark a conditional for static analysis
    // Runtime: just executes the condition and returns the result
    // Analyzer: extracts the id and conditionLabel for DecisionNode
    stepFn.if = <T extends boolean>(
      _id: string,
      _conditionLabel: string,
      condition: () => T
    ): T => {
      return condition();
    };

    // step.label: Alias for step.if - mark a conditional for static analysis
    // Use step.label for strict mode when conditionals contain step calls
    stepFn.label = stepFn.if;

    // step.branch: Execute a branch with explicit metadata for static analysis
    // Runtime: evaluates condition and executes appropriate arm
    // Analyzer: extracts branch metadata (conditionLabel, per-arm errors, out)
    stepFn.branch = async <
      T,
      const ThenErrs extends readonly string[] = readonly [],
      const ElseErrs extends readonly string[] = readonly [],
      const Out extends string | undefined = undefined,
    >(
      _id: string,
      options: BranchOptions<T, ThenErrs, ElseErrs, Out>
    ): Promise<T> => {
      const { condition, then: thenFn, else: elseFn } = options;
      const conditionResult = condition();
      if (conditionResult) {
        return await thenFn();
      } else if (elseFn) {
        return await elseFn();
      }
      return undefined as T;
    };

    // step.arm: Create an arm definition for use with step.branch
    // Runtime: returns the arm definition unchanged
    // Analyzer: extracts arm metadata
    stepFn.arm = <T, const Errs extends readonly string[] = readonly []>(
      fn: () => T | Promise<T>,
      errors?: Errs
    ): ArmDefinition<T, Errs> => {
      return { fn, errors };
    };

    // step.forEach: Execute a forEach loop with static analysis support
    // Supports both simple (run) and complex (item) forms
    stepFn.forEach = async <T, R>(
      _id: string,
      items: Iterable<T> | AsyncIterable<T>,
      options: ForEachRunOptions<T, R, readonly string[]> | ForEachItemOptions<T, R>
    ): Promise<R[]> => {
      const results: R[] = [];
      const maxIterations = options.maxIterations;
      let index = 0;

      // Check if this is the run form or item form
      const isRunForm = 'run' in options;

      // Convert items to async iterable for uniform handling
      const asyncItems = Symbol.asyncIterator in (items as object)
        ? (items as AsyncIterable<T>)
        : (async function* () { yield* items as Iterable<T>; })();

      for await (const item of asyncItems) {
        if (maxIterations !== undefined && index >= maxIterations) {
          break;
        }

        let result: R;
        if (isRunForm) {
          const runOptions = options as ForEachRunOptions<T, R, readonly string[]>;
          result = await runOptions.run(item, index);
        } else {
          const itemOptions = options as ForEachItemOptions<T, R>;
          result = await itemOptions.item.handler(item, index, stepFn as unknown as RunStep<unknown>);
        }

        results.push(result);
        index++;
      }

      return results;
    };

    // step.item: Create an item handler for use with step.forEach
    // Runtime: returns the handler wrapped in a marker object
    // Analyzer: extracts the inner step structure
    stepFn.item = <T, R>(
      handler: (item: T, index: number, step: RunStep<unknown>) => R | Promise<R>
    ): ForEachItemHandler<T, R> => {
      return {
        __forEachItemHandler: true as const,
        handler,
      };
    };

    // step.dep: Wrap a dependency function for static analysis tracking
    // Runtime: returns the function unchanged
    // Analyzer: records the dependency name
    stepFn.dep = <T extends (...args: unknown[]) => unknown>(
      _name: string,
      fn: T
    ): T => {
      return fn;
    };

    const step = stepFn as RunStep<E | UnexpectedError>;
    const value = await fn(step);

    // Dev-only warning: Detect common mistake of returning ok() or err() from executor
    if (
      process.env.NODE_ENV !== "production" &&
      value !== null &&
      typeof value === "object" &&
      "ok" in value &&
      typeof (value as { ok: unknown }).ok === "boolean"
    ) {
      const maybeResult = value as { ok: boolean; value?: unknown; error?: unknown };
      if (
        (maybeResult.ok === true && "value" in maybeResult) ||
        (maybeResult.ok === false && "error" in maybeResult)
      ) {
        console.warn(
          `awaitly: Workflow executor returned a Result-like object. ` +
            `Return raw values, not ok() or err().\n\n` +
            `  Incorrect: return ok({ data });\n` +
            `  Correct:   return { data };\n\n` +
            `See: https://jagreehal.github.io/awaitly/guides/troubleshooting/#returning-ok-from-workflow-executor-double-wrapping`
        );
      }
    }

    return ok(value);
  } catch (error) {
    // If a catchUnexpected mapper threw, propagate without re-processing
    if (isMapperException(error)) {
      throw error.thrown;
    }

    if (isEarlyExitE(error)) {
      // Extract original cause from early exit metadata
      const originalCause = error.meta.origin === "throw"
        ? error.meta.thrown
        : error.meta.resultCause;

      if (catchUnexpected || onError) {
        return err(error.error, { cause: originalCause });
      }
      // If the error is already an UnexpectedError (e.g., from resumed state),
      // return it directly without wrapping in another STEP_FAILURE
      if (isUnexpectedError(error.error)) {
        return err(error.error, { cause: originalCause });
      }
      // If the error is a STEP_TIMEOUT, return it directly without wrapping
      // This provides better DX: users get STEP_TIMEOUT directly in result.error
      if (isStepTimeoutError(error.error)) {
        return err(error.error, { cause: originalCause });
      }
      const unexpectedError = unexpectedFromFailure(error);
      return err(unexpectedError, { cause: originalCause });
    }

    if (catchUnexpected) {
      const mapped = catchUnexpected(error);
      onError?.(mapped, "unexpected", context);
      return err(mapped, { cause: error });
    }

    const unexpectedError: UnexpectedError = {
      type: "UNEXPECTED_ERROR",
      cause: { type: "UNCAUGHT_EXCEPTION", thrown: error },
    };
    onError?.(unexpectedError as unknown as E, "unexpected", context);
    return err(unexpectedError, { cause: error });
  }
}

/**
 * Convenience for run() with catchUnexpected: closed union Result<T, E>.
 * You must provide catchUnexpected to map uncaught exceptions to E.
 */
run.strict = <T, E, C = void>(
  fn: (step: RunStep<E>) => Promise<T> | T,
  options: {
    onError?: (error: E, stepName?: string, ctx?: C) => void;
    /**
     * Listener for workflow events (start, success, error, step events).
     *
     * Note: Context is available both on `event.context` and as the separate `ctx` parameter.
     * The `ctx` parameter is provided for convenience and backward compatibility.
     */
    onEvent?: (event: WorkflowEvent<E | UnexpectedError, C>, ctx: C) => void;
    catchUnexpected: (cause: unknown) => E;
    workflowId?: string;
    context?: C;
    /** @internal External signal for workflow-level cancellation. */
    _workflowSignal?: AbortSignal;
  }
): AsyncResult<T, E, unknown> => {
  return run<T, E, C>(fn, options);
};

// =============================================================================
// Unwrap Utilities
// =============================================================================

/**
 * Error thrown when `unwrap()` is called on an error Result.
 *
 * This error is thrown to prevent silent failures when using `unwrap()`.
 * Prefer using `unwrapOr`, `unwrapOrElse`, or pattern matching with `match` or `isOk`/`isErr`.
 */
export class UnwrapError<E = unknown, C = unknown> extends Error {
  constructor(
    public readonly error: E,
    public readonly cause?: C
  ) {
    super(`Unwrap called on an error result: ${String(error)}`);
    this.name = "UnwrapError";
  }
}

/**
 * Unwraps a Result, throwing an error if it's a failure.
 *
 * @remarks When to use: Only at boundaries or tests where a failure should be fatal.
 *
 * ## When to Use
 *
 * Use `unwrap()` when:
 * - You're certain the Result is successful (e.g., after checking with `isOk`)
 * - You're in a context where errors should crash (e.g., tests, initialization)
 * - You need the value immediately and can't handle errors gracefully
 *
 * ## Why Avoid This
 *
 * **Prefer alternatives** in production code:
 * - `unwrapOr(defaultValue)` - Provide a fallback value
 * - `unwrapOrElse(fn)` - Compute fallback from error
 * - `match()` - Handle both cases explicitly
 * - `isOk()` / `isErr()` - Type-safe pattern matching
 *
 * Throwing errors makes error handling harder and can crash your application.
 *
 * @param r - The Result to unwrap
 * @returns The success value if the Result is successful
 * @throws {UnwrapError} If the Result is an error (includes the error and cause)
 *
 * @example
 * ```typescript
 * // Safe usage after checking
 * const result = someOperation();
 * if (isOk(result)) {
 *   const value = unwrap(result); // Safe - we know it's ok
 * }
 *
 * // Unsafe usage (not recommended)
 * const value = unwrap(someOperation()); // May throw!
 * ```
 */
export const unwrap = <T, E, C>(r: Result<T, E, C>): T => {
  if (r.ok) return r.value;
  throw new UnwrapError<E, C>(r.error, r.cause);
};

/**
 * Unwraps a Result, returning a default value if it's a failure.
 *
 * @remarks When to use: Provide a safe fallback without branching.
 *
 * ## When to Use
 *
 * Use `unwrapOr()` when:
 * - You have a sensible default value for errors
 * - You want to continue execution even on failure
 * - The default value is cheap to compute (use `unwrapOrElse` if expensive)
 *
 * ## Why Use This
 *
 * - **Safe**: Never throws, always returns a value
 * - **Simple**: One-liner for common error handling
 * - **Type-safe**: TypeScript knows you'll always get a `T`
 *
 * @param r - The Result to unwrap
 * @param defaultValue - The value to return if the Result is an error
 * @returns The success value if successful, otherwise the default value
 *
 * @example
 * ```typescript
 * // Provide default for missing data
 * const user = unwrapOr(fetchUser(id), { id: 'anonymous', name: 'Guest' });
 *
 * // Provide default for numeric operations
 * const count = unwrapOr(parseCount(input), 0);
 *
 * // Provide default for optional features
 * const config = unwrapOr(loadConfig(), getDefaultConfig());
 * ```
 */
export const unwrapOr = <T, E, C>(r: Result<T, E, C>, defaultValue: T): T =>
  r.ok ? r.value : defaultValue;

/**
 * Unwraps a Result, computing a default value from the error if it's a failure.
 *
 * @remarks When to use: Compute a fallback from the error (logging, metrics, or derived defaults).
 *
 * ## When to Use
 *
 * Use `unwrapOrElse()` when:
 * - The default value is expensive to compute (lazy evaluation)
 * - You need to log or handle the error before providing a default
 * - The default depends on the error type or cause
 * - You want to transform the error into a success value
 *
 * ## Why Use This Instead of `unwrapOr`
 *
 * - **Lazy**: Default is only computed if needed (better performance)
 * - **Error-aware**: You can inspect the error before providing default
 * - **Flexible**: Default can depend on error type or cause
 *
 * @param r - The Result to unwrap
 * @param fn - Function that receives the error and optional cause, returns the default value
 * @returns The success value if successful, otherwise the result of calling `fn(error, cause)`
 *
 * @example
 * ```typescript
 * // Compute default based on error type
 * const port = unwrapOrElse(parsePort(env.PORT), (error) => {
 *   if (error === 'INVALID_FORMAT') return 3000;
 *   if (error === 'OUT_OF_RANGE') return 8080;
 *   return 4000; // default
 * });
 *
 * // Log error before providing default
 * const data = unwrapOrElse(fetchData(), (error, cause) => {
 *   console.error('Failed to fetch:', error, cause);
 *   return getCachedData();
 * });
 *
 * // Transform error into success value
 * const result = unwrapOrElse(operation(), (error) => {
 *   return { success: false, reason: String(error) };
 * });
 * ```
 */
export const unwrapOrElse = <T, E, C>(
  r: Result<T, E, C>,
  fn: (error: E, cause?: C) => T
): T => (r.ok ? r.value : fn(r.error, r.cause));

// =============================================================================
// Wrapping Functions
// =============================================================================

/**
 * Wraps a synchronous throwing function in a Result.
 *
 * @remarks When to use: Wrap sync code that might throw so exceptions become Err values.
 *
 * ## When to Use
 *
 * Use `from()` when:
 * - You have a synchronous function that throws exceptions
 * - You want to convert exceptions to typed errors
 * - You're integrating with libraries that throw (e.g., JSON.parse, fs.readFileSync)
 * - You need to handle errors without try/catch blocks
 *
 * ## Why Use This
 *
 * - **Type-safe errors**: Convert thrown exceptions to typed Result errors
 * - **No try/catch**: Cleaner code without nested try/catch blocks
 * - **Composable**: Results can be chained with `andThen`, `map`, etc.
 * - **Explicit errors**: Forces you to handle errors explicitly
 *
 * @param fn - The synchronous function to execute (may throw)
 * @returns A Result with the function's return value or the thrown error
 *
 * @example
 * ```typescript
 * // Wrap JSON.parse
 * const parsed = from(() => JSON.parse('{"key": "value"}'));
 * // parsed: { ok: true, value: { key: "value" } }
 *
 * const error = from(() => JSON.parse('invalid'));
 * // error: { ok: false, error: SyntaxError }
 * ```
 */
export function from<T>(fn: () => T): Ok<T> | Err<unknown, unknown>;
/**
 * Wraps a synchronous throwing function in a Result with custom error mapping.
 *
 * Use this overload when you want to map thrown exceptions to your typed error union.
 *
 * @param fn - The synchronous function to execute (may throw)
 * @param onError - Function to map the thrown exception to a typed error
 * @returns A Result with the function's return value or the mapped error
 *
 * @example
 * ```typescript
 * // Map exceptions to typed errors
 * const parsed = from(
 *   () => JSON.parse(input),
 *   (cause) => ({ type: 'PARSE_ERROR' as const, cause })
 * );
 * // parsed.error: { type: 'PARSE_ERROR', cause: SyntaxError }
 *
 * // Map to simple error codes
 * const value = from(
 *   () => riskyOperation(),
 *   () => 'OPERATION_FAILED' as const
 * );
 * ```
 */
export function from<T, E>(fn: () => T, onError: (cause: unknown) => E): Ok<T> | Err<E, unknown>;
export function from<T, E>(fn: () => T, onError?: (cause: unknown) => E) {
  try {
    return ok(fn());
  } catch (cause) {
    return onError ? err(onError(cause), { cause }) : err(cause);
  }
}

/**
 * Wraps a Promise in a Result, converting rejections to errors.
 *
 * @remarks When to use: Wrap a Promise and keep the raw rejection as Err; use tryAsync to map errors.
 *
 * ## When to Use
 *
 * Use `fromPromise()` when:
 * - You have an existing Promise that might reject
 * - You want to convert Promise rejections to typed errors
 * - You're working with libraries that return Promises (fetch, database clients)
 * - You need to handle rejections without .catch() chains
 *
 * ## Why Use This
 *
 * - **Type-safe errors**: Convert Promise rejections to typed Result errors
 * - **Composable**: Results can be chained with `andThen`, `map`, etc.
 * - **Explicit handling**: Forces you to handle errors explicitly
 * - **No .catch() chains**: Cleaner than Promise.catch() patterns
 *
 * @param promise - The Promise to await (may reject)
 * @returns A Promise resolving to a Result with the resolved value or rejection reason
 *
 * @example
 * ```typescript
 * // Wrap fetch
 * const result = await fromPromise(
 *   fetch('/api').then(r => r.json())
 * );
 * // result.ok: true if fetch succeeded, false if rejected
 * ```
 */
export function fromPromise<T>(promise: Promise<T>): Promise<Ok<T> | Err<unknown, unknown>>;
/**
 * Wraps a Promise in a Result with custom error mapping.
 *
 * Use this overload when you want to map Promise rejections to your typed error union.
 *
 * @param promise - The Promise to await (may reject)
 * @param onError - Function to map the rejection reason to a typed error
 * @returns A Promise resolving to a Result with the resolved value or mapped error
 *
 * @example
 * ```typescript
 * // Map fetch errors to typed errors
 * const result = await fromPromise(
 *   fetch('/api').then(r => {
 *     if (!r.ok) throw new Error(`HTTP ${r.status}`);
 *     return r.json();
 *   }),
 *   () => 'FETCH_FAILED' as const
 * );
 * // result.error: 'FETCH_FAILED' if fetch failed
 *
 * // Map with error details
 * const data = await fromPromise(
 *   db.query(sql),
 *   (cause) => ({ type: 'DB_ERROR' as const, message: String(cause) })
 * );
 * ```
 */
export function fromPromise<T, E>(
  promise: Promise<T>,
  onError: (cause: unknown) => E
): Promise<Ok<T> | Err<E, unknown>>;
export async function fromPromise<T, E>(
  promise: Promise<T>,
  onError?: (cause: unknown) => E
): Promise<Ok<T> | Err<E, unknown> | Err<unknown, unknown>> {
  try {
    return ok(await promise);
  } catch (cause) {
    return onError ? err(onError(cause), { cause }) : err(cause);
  }
}

/**
 * Wraps an async function in a Result, catching both thrown exceptions and Promise rejections.
 *
 * @remarks When to use: Wrap async work and map thrown/rejected values into your typed error union.
 *
 * ## When to Use
 *
 * Use `tryAsync()` when:
 * - You have an async function that might throw or reject
 * - You want to convert both exceptions and rejections to typed errors
 * - You're creating new async functions (use `fromPromise` for existing Promises)
 * - You need to handle errors without try/catch or .catch()
 *
 * ## Why Use This Instead of `fromPromise`
 *
 * - **Function form**: Takes a function, not a Promise (lazy evaluation)
 * - **Catches both**: Handles both thrown exceptions and Promise rejections
 * - **Cleaner syntax**: No need to wrap in Promise manually
 *
 * @param fn - The async function to execute (may throw or reject)
 * @returns A Promise resolving to a Result with the function's return value or error
 *
 * @example
 * ```typescript
 * // Wrap async function
 * const result = await tryAsync(async () => {
 *   const data = await fetchData();
 *   return processData(data);
 * });
 * ```
 */
export function tryAsync<T>(fn: () => Promise<T>): AsyncResult<T, unknown>;
/**
 * Wraps an async function in a Result with custom error mapping.
 *
 * Use this overload when you want to map errors to your typed error union.
 *
 * @param fn - The async function to execute (may throw or reject)
 * @param onError - Function to map the error (exception or rejection) to a typed error
 * @returns A Promise resolving to a Result with the function's return value or mapped error
 *
 * @example
 * ```typescript
 * // Map errors to typed errors
 * const result = await tryAsync(
 *   async () => await fetchData(),
 *   () => 'FETCH_ERROR' as const
 * );
 *
 * // Map with error details
 * const data = await tryAsync(
 *   async () => await processFile(path),
 *   (cause) => ({ type: 'PROCESSING_ERROR' as const, cause })
 * );
 * ```
 */
export function tryAsync<T, E>(
  fn: () => Promise<T>,
  onError: (cause: unknown) => E
): AsyncResult<T, E>;
export async function tryAsync<T, E>(
  fn: () => Promise<T>,
  onError?: (cause: unknown) => E
): AsyncResult<T, E | unknown> {
  try {
    return ok(await fn());
  } catch (cause) {
    return onError ? err(onError(cause), { cause }) : err(cause);
  }
}

/**
 * Converts a nullable value to a Result.
 *
 * @remarks When to use: Turn null/undefined into a typed error before continuing.
 *
 * ## When to Use
 *
 * Use `fromNullable()` when:
 * - You have a value that might be `null` or `undefined`
 * - You want to treat null/undefined as an error case
 * - You're working with APIs that return nullable values (DOM APIs, optional properties)
 * - You want to avoid null checks scattered throughout your code
 *
 * ## Why Use This
 *
 * - **Type-safe**: Converts nullable types to non-nullable Results
 * - **Explicit errors**: Forces you to handle null/undefined cases
 * - **Composable**: Results can be chained with `andThen`, `map`, etc.
 * - **No null checks**: Eliminates need for `if (value == null)` checks
 *
 * @param value - The value that may be null or undefined
 * @param onNull - Function that returns an error when value is null/undefined
 * @returns A Result with the value if not null/undefined, otherwise the error from `onNull`
 *
 * @example
 * ```typescript
 * // Convert DOM element lookup
 * const element = fromNullable(
 *   document.getElementById('app'),
 *   () => 'ELEMENT_NOT_FOUND' as const
 * );
 *
 * // Convert optional property
 * const userId = fromNullable(
 *   user.id,
 *   () => 'USER_ID_MISSING' as const
 * );
 *
 * // Convert database query result
 * const record = fromNullable(
 *   await db.find(id),
 *   () => ({ type: 'NOT_FOUND' as const, id })
 * );
 * ```
 */
export function fromNullable<T, E>(
  value: T | null | undefined,
  onNull: () => E
): Result<T, E> {
  return value != null ? ok(value) : err(onNull());
}

// =============================================================================
// Transformers
// =============================================================================

/**
 * Transforms the success value of a Result.
 *
 * @remarks When to use: Transform only the Ok value while leaving Err untouched.
 *
 * ## When to Use
 *
 * Use `map()` when:
 * - You need to transform a success value to another type
 * - You want to apply a pure function to the value
 * - You're building a pipeline of transformations
 * - The transformation cannot fail (use `andThen` if it can fail)
 *
 * ## Why Use This
 *
 * - **Functional style**: Composable, chainable transformations
 * - **Error-preserving**: Errors pass through unchanged
 * - **Type-safe**: TypeScript tracks the transformation
 * - **No unwrapping**: Avoids manual `if (r.ok)` checks
 *
 * @param r - The Result to transform
 * @param fn - Pure function that transforms the success value (must not throw)
 * @returns A new Result with the transformed value, or the original error if `r` was an error
 *
 * @example
 * ```typescript
 * // Transform numeric value
 * const doubled = map(ok(21), n => n * 2);
 * // doubled: { ok: true, value: 42 }
 *
 * // Transform object property
 * const name = map(fetchUser(id), user => user.name);
 *
 * // Chain transformations
 * const formatted = map(
 *   map(parseNumber(input), n => n * 2),
 *   n => `Result: ${n}`
 * );
 * ```
 */
export function map<T, U>(r: Ok<T>, fn: (value: T) => U): Ok<U>;
export function map<T, U, E, C>(r: Err<E, C>, fn: (value: T) => U): Err<E, C>;
export function map<T, U, E, C>(r: Result<T, E, C>, fn: (value: T) => U): Result<U, E, C>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function map(r: any, fn: any): any {
  return r.ok ? ok(fn(r.value)) : r;
}

/**
 * Transforms the error value of a Result.
 *
 * @remarks When to use: Retype or normalize errors while leaving Ok values unchanged.
 *
 * ## When to Use
 *
 * Use `mapError()` when:
 * - You need to normalize or transform error types
 * - You want to convert errors to a different error type
 * - You're building error handling pipelines
 * - You need to format error messages or codes
 *
 * ## Why Use This
 *
 * - **Error normalization**: Convert errors to a common format
 * - **Type transformation**: Change error type while preserving value type
 * - **Composable**: Can be chained with other transformers
 * - **Success-preserving**: Success values pass through unchanged
 *
 * @param r - The Result to transform
 * @param fn - Function that transforms the error value (must not throw)
 * @returns A new Result with the original value, or the transformed error if `r` was an error
 *
 * @example
 * ```typescript
 * // Normalize error codes
 * const normalized = mapError(err('not_found'), e => e.toUpperCase());
 * // normalized: { ok: false, error: 'NOT_FOUND' }
 *
 * // Convert error types
 * const typed = mapError(
 *   err('404'),
 *   code => ({ type: 'HTTP_ERROR' as const, status: parseInt(code) })
 * );
 *
 * // Format error messages
 * const formatted = mapError(
 *   err('PARSE_ERROR'),
 *   code => `Failed to parse: ${code}`
 * );
 * ```
 */
export function mapError<T, E, F, C>(
  r: Result<T, E, C>,
  fn: (error: E) => F
): Result<T, F, C> {
  return r.ok ? r : err(fn(r.error), { cause: r.cause });
}

/**
 * Pattern matches on a Result, calling the appropriate handler.
 *
 * @remarks When to use: Handle both Ok and Err in a single expression that returns a value.
 *
 * ## When to Use
 *
 * Use `match()` when:
 * - You need to handle both success and error cases
 * - You want to transform a Result to a different type
 * - You need exhaustive handling (both cases must be handled)
 * - You're building user-facing messages or responses
 *
 * ## Why Use This
 *
 * - **Exhaustive**: Forces you to handle both success and error cases
 * - **Type-safe**: TypeScript ensures both handlers are provided
 * - **Functional**: Pattern matching style, similar to Rust's `match` or Haskell's `case`
 * - **Single expression**: Can be used in expressions, not just statements
 *
 * @param r - The Result to match
 * @param handlers - Object with `ok` and `err` handler functions
 * @param handlers.ok - Function called with the success value
 * @param handlers.err - Function called with the error and optional cause
 * @returns The return value of the appropriate handler (both must return the same type `R`)
 *
 * @example
 * ```typescript
 * // Build user-facing messages
 * const message = match(result, {
 *   ok: (user) => `Hello ${user.name}`,
 *   err: (error) => `Error: ${error}`,
 * });
 *
 * // Transform to API response
 * const response = match(operation(), {
 *   ok: (data) => ({ status: 200, body: data }),
 *   err: (error) => ({ status: 400, error: String(error) }),
 * });
 *
 * // Handle with cause
 * const response = match(result, {
 *   ok: (value) => ({ status: 'success', data: value }),
 *   err: (error, cause) => ({ status: 'error', error, cause }),
 * });
 * ```
 */
export function match<T, E, C, R>(r: Ok<T>, handlers: { ok: (value: T) => R; err: (error: E, cause?: C) => R }): R;
export function match<T, E, C, R>(r: Err<E, C>, handlers: { ok: (value: T) => R; err: (error: E, cause?: C) => R }): R;
export function match<T, E, C, R>(r: Result<T, E, C>, handlers: { ok: (value: T) => R; err: (error: E, cause?: C) => R }): R;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function match(r: any, handlers: any): any {
  return r.ok ? handlers.ok(r.value) : handlers.err(r.error, r.cause);
}

/**
 * Chains Results together (flatMap/monadic bind).
 *
 * @remarks When to use: Chain dependent operations that return Result without nested branching.
 *
 * ## When to Use
 *
 * Use `andThen()` when:
 * - You need to chain operations that can fail
 * - The next operation depends on the previous success value
 * - You're building a pipeline of dependent operations
 * - You want to avoid nested `if (r.ok)` checks
 *
 * ## Why Use This Instead of `map`
 *
 * - **Can fail**: The chained function returns a Result (can fail)
 * - **Short-circuits**: If first Result fails, second operation never runs
 * - **Error accumulation**: Errors from both operations are in the union
 * - **Composable**: Can chain multiple operations together
 *
 * ## Common Pattern
 *
 * This is the fundamental building block for Result pipelines:
 * ```typescript
 * andThen(operation1(), value1 =>
 *   andThen(operation2(value1), value2 =>
 *     ok({ value1, value2 })
 *   )
 * )
 * ```
 *
 * @param r - The first Result
 * @param fn - Function that takes the success value and returns a new Result (may fail)
 * @returns The Result from `fn` if `r` was successful, otherwise the original error
 *
 * @example
 * ```typescript
 * // Chain dependent operations
 * const userPosts = andThen(
 *   fetchUser('1'),
 *   user => fetchPosts(user.id)
 * );
 *
 * // Build complex pipelines
 * const result = andThen(parseInput(input), parsed =>
 *   andThen(validate(parsed), validated =>
 *     process(validated)
 *   )
 * );
 *
 * // Chain with different error types
 * const data = andThen(
 *   fetchUser(id), // Returns Result<User, 'FETCH_ERROR'>
 *   user => fetchPosts(user.id) // Returns Result<Post[], 'NOT_FOUND'>
 * );
 * // data.error: 'FETCH_ERROR' | 'NOT_FOUND'
 * ```
 */
export function andThen<T, U>(r: Ok<T>, fn: (value: T) => Ok<U>): Ok<U>;
export function andThen<T, F, C2>(r: Ok<T>, fn: (value: T) => Err<F, C2>): Err<F, C2>;
export function andThen<T, U, F, C2>(r: Ok<T>, fn: (value: T) => Result<U, F, C2>): Result<U, F, C2>;
export function andThen<T, U, E, F, C1, C2>(r: Err<E, C1>, fn: (value: T) => Result<U, F, C2>): Err<E, C1>;
export function andThen<T, U, E, F, C1, C2>(r: Result<T, E, C1>, fn: (value: T) => Result<U, F, C2>): Result<U, E | F, C1 | C2>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function andThen(r: any, fn: any): any {
  return r.ok ? fn(r.value) : r;
}

/**
 * Executes a side effect on a successful Result without changing it.
 *
 * @remarks When to use: Add side effects (logging, metrics) on Ok without changing the Result.
 *
 * ## When to Use
 *
 * Use `tap()` when:
 * - You need to log, debug, or observe success values
 * - You want to perform side effects in a pipeline
 * - You need to mutate external state based on success
 * - You're debugging and want to inspect values without breaking the chain
 *
 * ## Why Use This
 *
 * - **Non-breaking**: Doesn't change the Result, just performs side effect
 * - **Composable**: Can be inserted anywhere in a pipeline
 * - **Type-preserving**: Returns the same Result type
 * - **Lazy**: Side effect only runs if Result is successful
 *
 * @param r - The Result to tap
 * @param fn - Side effect function called with the success value (return value ignored)
 * @returns The original Result unchanged (for chaining)
 *
 * @example
 * ```typescript
 * // Log success values
 * const logged = tap(result, user => console.log('Got user:', user.name));
 * // logged === result, but console.log was called
 *
 * // Debug in pipeline
 * const debugged = pipe(
 *   fetchUser(id),
 *   r => tap(r, user => console.log('Fetched:', user)),
 *   r => map(r, user => user.name)
 * );
 *
 * // Mutate external state
 * const tracked = tap(result, data => {
 *   analytics.track('operation_success', data);
 * });
 * ```
 */
export function tap<T, E, C>(
  r: Result<T, E, C>,
  fn: (value: T) => void
): Result<T, E, C> {
  if (r.ok) fn(r.value);
  return r;
}

/**
 * Executes a side effect on an error Result without changing it.
 *
 * @remarks When to use: Add side effects (logging, metrics) on Err without changing the Result.
 *
 * ## When to Use
 *
 * Use `tapError()` when:
 * - You need to log, debug, or observe error values
 * - You want to perform side effects on errors in a pipeline
 * - You need to report errors to external systems (logging, monitoring)
 * - You're debugging and want to inspect errors without breaking the chain
 *
 * ## Why Use This
 *
 * - **Non-breaking**: Doesn't change the Result, just performs side effect
 * - **Composable**: Can be inserted anywhere in a pipeline
 * - **Type-preserving**: Returns the same Result type
 * - **Lazy**: Side effect only runs if Result is an error
 *
 * @param r - The Result to tap
 * @param fn - Side effect function called with the error and optional cause (return value ignored)
 * @returns The original Result unchanged (for chaining)
 *
 * @example
 * ```typescript
 * // Log errors
 * const logged = tapError(result, (error, cause) => {
 *   console.error('Error:', error, cause);
 * });
 *
 * // Report to error tracking
 * const tracked = tapError(result, (error, cause) => {
 *   errorTracker.report(error, cause);
 * });
 *
 * // Debug in pipeline
 * const debugged = pipe(
 *   operation(),
 *   r => tapError(r, (err, cause) => console.error('Failed:', err)),
 *   r => mapError(r, err => 'FORMATTED_ERROR')
 * );
 * ```
 */
export function tapError<T, E, C>(
  r: Result<T, E, C>,
  fn: (error: E, cause?: C) => void
): Result<T, E, C> {
  if (!r.ok) fn(r.error, r.cause);
  return r;
}

/**
 * Transforms the success value of a Result, catching any errors thrown by the transform.
 *
 * @remarks When to use: Transform Ok values with a function that might throw and capture the failure.
 *
 * ## When to Use
 *
 * Use `mapTry()` when:
 * - Your transform function might throw exceptions
 * - You want to convert transform errors to typed errors
 * - You're working with libraries that throw (e.g., JSON.parse, Date parsing)
 * - You need to handle both Result errors and transform exceptions
 *
 * ## Why Use This Instead of `map`
 *
 * - **Exception-safe**: Catches exceptions from the transform function
 * - **Error mapping**: Converts thrown exceptions to typed errors
 * - **Dual error handling**: Handles both Result errors and transform exceptions
 *
 * @param result - The Result to transform
 * @param transform - Function to transform the success value (may throw exceptions)
 * @param onError - Function to map thrown exceptions to a typed error
 * @returns A Result with:
 *   - Transformed value if both Result and transform succeed
 *   - Original error if Result was an error
 *   - Transform error if transform threw an exception
 *
 * @example
 * ```typescript
 * // Safe JSON parsing
 * const parsed = mapTry(
 *   ok('{"key": "value"}'),
 *   JSON.parse,
 *   () => 'PARSE_ERROR' as const
 * );
 *
 * // Safe date parsing
 * const date = mapTry(
 *   ok('2024-01-01'),
 *   str => new Date(str),
 *   () => 'INVALID_DATE' as const
 * );
 *
 * // Transform with error details
 * const processed = mapTry(
 *   result,
 *   value => riskyTransform(value),
 *   (cause) => ({ type: 'TRANSFORM_ERROR' as const, cause })
 * );
 * ```
 */
export function mapTry<T, U, E, F, C>(
  result: Result<T, E, C>,
  transform: (value: T) => U,
  onError: (cause: unknown) => F
): Result<U, E | F, C | unknown> {
  if (!result.ok) return result;
  try {
    return ok(transform(result.value));
  } catch (error) {
    return err(onError(error), { cause: error });
  }
}

/**
 * Transforms the error value of a Result, catching any errors thrown by the transform.
 *
 * @remarks When to use: Transform errors when the mapping might throw and you want that captured.
 *
 * ## When to Use
 *
 * Use `mapErrorTry()` when:
 * - Your error transform function might throw exceptions
 * - You're doing complex error transformations (e.g., string formatting, object construction)
 * - You want to handle both Result errors and transform exceptions
 * - You need to safely normalize error types
 *
 * ## Why Use This Instead of `mapError`
 *
 * - **Exception-safe**: Catches exceptions from the error transform function
 * - **Error mapping**: Converts thrown exceptions to typed errors
 * - **Dual error handling**: Handles both Result errors and transform exceptions
 *
 * @param result - The Result to transform
 * @param transform - Function to transform the error value (may throw exceptions)
 * @param onError - Function to map thrown exceptions to a typed error
 * @returns A Result with:
 *   - Original value if Result was successful
 *   - Transformed error if both Result was error and transform succeeded
 *   - Transform error if transform threw an exception
 *
 * @example
 * ```typescript
 * // Safe error formatting
 * const formatted = mapErrorTry(
 *   err('not_found'),
 *   e => e.toUpperCase(), // Might throw if e is not a string
 *   () => 'FORMAT_ERROR' as const
 * );
 *
 * // Complex error transformation
 * const normalized = mapErrorTry(
 *   result,
 *   error => ({ type: 'NORMALIZED', message: String(error) }),
 *   () => 'TRANSFORM_ERROR' as const
 * );
 * ```
 */
export function mapErrorTry<T, E, F, G, C>(
  result: Result<T, E, C>,
  transform: (error: E) => F,
  onError: (cause: unknown) => G
): Result<T, F | G, C | unknown> {
  if (result.ok) return result;
  try {
    return err(transform(result.error), { cause: result.cause });
  } catch (error) {
    return err(onError(error), { cause: error });
  }
}

/**
 * Transforms both the success value and error value of a Result simultaneously.
 *
 * ## When to Use
 *
 * Use `bimap()` when:
 * - You need to transform both success and error in one operation
 * - You're normalizing Results to a common format
 * - You want symmetric transformation of both cases
 * - You're building adapters between different Result types
 *
 * ## Why Use This Instead of `map` + `mapError`
 *
 * - **Single operation**: Transforms both cases in one call
 * - **Clearer intent**: Shows you're handling both cases symmetrically
 * - **Less code**: Avoids chaining map and mapError
 *
 * @param r - The Result to transform
 * @param onOk - Function that transforms the success value
 * @param onErr - Function that transforms the error value
 * @returns A new Result with transformed value or transformed error
 *
 * @example
 * ```typescript
 * // Normalize to API response format
 * const response = bimap(
 *   fetchUser(id),
 *   user => ({ status: 'success', data: user }),
 *   error => ({ status: 'error', code: error })
 * );
 *
 * // Transform types
 * const stringified = bimap(
 *   parseNumber(input),
 *   n => `Value: ${n}`,
 *   e => `Error: ${e}`
 * );
 *
 * // Adapt between error types
 * const adapted = bimap(
 *   externalResult,
 *   value => internalValue(value),
 *   error => internalError(error)
 * );
 * ```
 */
export function bimap<T, U, E, F, C>(
  r: Result<T, E, C>,
  onOk: (value: T) => U,
  onErr: (error: E) => F
): Result<U, F, C> {
  return r.ok ? ok(onOk(r.value)) : err(onErr(r.error), { cause: r.cause });
}

/**
 * Recovers from an error by returning a new Result.
 * Similar to neverthrow's `.orElse()`.
 *
 * @remarks When to use: Recover from Err by returning a fallback Result or retyping the error.
 *
 * ## When to Use
 *
 * Use `orElse()` when:
 * - You want to recover from errors with fallback operations
 * - The recovery might also fail (returns a Result)
 * - You need to chain fallback strategies
 * - You're implementing retry or fallback patterns
 *
 * ## Why Use This
 *
 * - **Fallback chains**: Try alternative operations on failure
 * - **Error recovery**: Convert errors to success with fallback values
 * - **Composable**: Can chain multiple orElse calls for cascading fallbacks
 * - **Type-safe**: TypeScript tracks the error union through recovery
 *
 * @param r - The Result to potentially recover from
 * @param fn - Function that takes the error and returns a new Result (may succeed or fail)
 * @returns The original Result if successful, or the result of the recovery function
 *
 * @example
 * ```typescript
 * // Fallback to default user
 * const user = orElse(
 *   fetchUser(id),
 *   error => error === 'NOT_FOUND' ? ok(defaultUser) : err(error)
 * );
 *
 * // Try cache, then database, then fail
 * const data = orElse(
 *   orElse(
 *     fetchFromCache(key),
 *     () => fetchFromDatabase(key)
 *   ),
 *   () => err('DATA_UNAVAILABLE' as const)
 * );
 *
 * // Convert specific errors to success
 * const result = orElse(
 *   riskyOperation(),
 *   error => error.code === 'RETRY' ? ok(defaultValue) : err(error)
 * );
 * ```
 */
export function orElse<T, E, E2, C, C2>(
  r: Result<T, E, C>,
  fn: (error: E, cause?: C) => Result<T, E2, C2>
): Result<T, E2, C2> {
  return r.ok ? r : fn(r.error, r.cause);
}

/**
 * Async version of orElse for recovering from errors with async operations.
 *
 * @param r - The Result or AsyncResult to potentially recover from
 * @param fn - Async function that takes the error and returns a new Result
 * @returns Promise of the original Result if successful, or the result of the recovery function
 *
 * @example
 * ```typescript
 * // Try primary API, fall back to secondary
 * const data = await orElseAsync(
 *   await fetchFromPrimaryApi(),
 *   async (error) => {
 *     if (error === 'UNAVAILABLE') {
 *       return await fetchFromSecondaryApi();
 *     }
 *     return err(error);
 *   }
 * );
 * ```
 */
export async function orElseAsync<T, E, E2, C, C2>(
  r: Result<T, E, C> | Promise<Result<T, E, C>>,
  fn: (error: E, cause?: C) => Result<T, E2, C2> | Promise<Result<T, E2, C2>>
): Promise<Result<T, E2, C2>> {
  const resolved = await r;
  return resolved.ok ? resolved : fn(resolved.error, resolved.cause);
}

/**
 * Recovers from an error by returning a plain value (not a Result).
 * Useful when you want to provide a default value on error.
 *
 * ## When to Use
 *
 * Use `recover()` when:
 * - You want to provide a fallback value on error
 * - Recovery cannot fail (unlike orElse which returns a Result)
 * - You're implementing default value patterns
 * - You want to guarantee a successful Result
 *
 * ## Why Use This Instead of `orElse`
 *
 * - **Simpler**: Recovery function returns plain value, not Result
 * - **Guaranteed success**: Always returns ok() after recovery
 * - **Clearer intent**: Shows recovery cannot fail
 *
 * @param r - The Result to potentially recover from
 * @param fn - Function that takes the error and returns a recovery value
 * @returns The original Result if successful, or ok(recoveryValue) if error
 *
 * @example
 * ```typescript
 * // Provide default user on NOT_FOUND
 * const user = recover(
 *   fetchUser(id),
 *   error => error === 'NOT_FOUND' ? defaultUser : guestUser
 * );
 *
 * // Convert all errors to default
 * const config = recover(
 *   loadConfig(),
 *   () => defaultConfig
 * );
 *
 * // Recover with error-based defaults
 * const value = recover(
 *   parseNumber(input),
 *   error => error === 'EMPTY' ? 0 : -1
 * );
 * ```
 */
export function recover<T, E, C>(
  r: Result<T, E, C>,
  fn: (error: E, cause?: C) => T
): Ok<T> {
  return r.ok ? ok(r.value) : ok(fn(r.error, r.cause));
}

/**
 * Async version of recover for recovering with async operations.
 *
 * @param r - The Result or AsyncResult to potentially recover from
 * @param fn - Async function that takes the error and returns a recovery value
 * @returns Promise of ok(value) - either original or recovered
 *
 * @example
 * ```typescript
 * // Recover by fetching default from API
 * const user = await recoverAsync(
 *   await fetchUser(id),
 *   async (error) => await fetchDefaultUser()
 * );
 * ```
 */
export async function recoverAsync<T, E, C>(
  r: Result<T, E, C> | Promise<Result<T, E, C>>,
  fn: (error: E, cause?: C) => T | Promise<T>
): Promise<Ok<T>> {
  const resolved = await r;
  if (resolved.ok) return ok(resolved.value);
  return ok(await fn(resolved.error, resolved.cause));
}

// =============================================================================
// Result Hydration (Serialization)
// =============================================================================

/**
 * Validates and type-narrows a value to a Result.
 *
 * Since this library uses plain objects for Results, serialization is trivial -
 * the serialized form IS the Result. This function validates the structure and
 * provides type-safe narrowing.
 *
 * ## When to Use
 *
 * Use `hydrate()` when:
 * - Receiving Results over RPC/network
 * - Deserializing Results from storage
 * - Validating untrusted data as Results
 *
 * @param value - The unknown value to validate as a Result
 * @returns The value as a typed Result, or null if invalid
 *
 * @example
 * ```typescript
 * // Deserialize from JSON
 * const parsed = JSON.parse(jsonString);
 * const result = hydrate<User, ApiError>(parsed);
 * if (result) {
 *   // result is Result<User, ApiError>
 * }
 *
 * // Validate RPC response
 * const rpcResponse = await fetchFromService();
 * const result = hydrate<Data, ServiceError>(rpcResponse);
 * ```
 */
export function hydrate<T, E, C = unknown>(value: unknown): Result<T, E, C> | null {
  if (
    value !== null &&
    typeof value === "object" &&
    "ok" in value &&
    typeof value.ok === "boolean"
  ) {
    if (value.ok === true && "value" in value) {
      return value as Result<T, E, C>;
    }
    if (value.ok === false && "error" in value) {
      return value as Result<T, E, C>;
    }
  }
  return null;
}

/**
 * Type guard to check if a value is a valid serialized Result.
 *
 * @param value - The value to check
 * @returns True if the value is a valid Result structure
 *
 * @example
 * ```typescript
 * if (isSerializedResult(data)) {
 *   // data is Result<unknown, unknown, unknown>
 *   if (data.ok) {
 *     console.log(data.value);
 *   }
 * }
 * ```
 */
export function isSerializedResult(
  value: unknown
): value is Result<unknown, unknown, unknown> {
  return hydrate(value) !== null;
}

// =============================================================================
// Batch Operations
// =============================================================================

type AllValues<T extends readonly Result<unknown, unknown, unknown>[]> = {
  [K in keyof T]: T[K] extends Ok<infer V>
    ? V
    : T[K] extends Err<unknown, unknown>
      ? never
      : T[K] extends Result<infer V, unknown, unknown>
        ? V
        : never;
};
type AllErrors<T extends readonly Result<unknown, unknown, unknown>[]> = {
  [K in keyof T]: T[K] extends Ok<unknown>
    ? never
    : T[K] extends Err<infer E, unknown>
      ? E
      : T[K] extends Result<unknown, infer E, unknown>
        ? E
        : never;
}[number];
type AllCauses<T extends readonly Result<unknown, unknown, unknown>[]> = {
  [K in keyof T]: T[K] extends Ok<unknown>
    ? never
    : T[K] extends Err<unknown, infer C>
      ? C
      : T[K] extends Result<unknown, unknown, infer C>
        ? C
        : never;
}[number];

// Conditional type: returns Ok<...> when there are no errors, Result<...> otherwise
// Note: We only check AllErrors, not AllCauses - causes only matter when there are errors
type AllResult<T extends readonly Result<unknown, unknown, unknown>[]> =
  [AllErrors<T>] extends [never]
    ? Ok<AllValues<T>>
    : Result<AllValues<T>, AllErrors<T>, AllCauses<T>>;

/**
 * Combines multiple Results into one, requiring all to succeed.
 *
 * ## When to Use
 *
 * Use `all()` when:
 * - You have multiple independent operations that all must succeed
 * - You want to short-circuit on the first error (fail-fast)
 * - You need all values together (e.g., combining API responses)
 * - Performance matters (stops on first error, doesn't wait for all)
 *
 * ## Why Use This
 *
 * - **Fail-fast**: Stops immediately on first error (better performance)
 * - **Type-safe**: TypeScript infers the array type from input
 * - **Short-circuit**: Doesn't evaluate remaining Results after error
 * - **Composable**: Can be chained with other operations
 *
 * ## Important
 *
 * - **Short-circuits**: Returns first error immediately, doesn't wait for all Results
 * - **All must succeed**: If any Result fails, the entire operation fails
 * - **Use `allSettled`**: If you need to collect all errors (e.g., form validation)
 *
 * @param results - Array of Results to combine (all must succeed)
 * @returns A Result with an array of all success values, or the first error encountered
 *
 * @example
 * ```typescript
 * // Combine multiple successful Results
 * const combined = all([ok(1), ok(2), ok(3)]);
 * // combined: { ok: true, value: [1, 2, 3] }
 *
 * // Short-circuits on first error
 * const error = all([ok(1), err('ERROR'), ok(3)]);
 * // error: { ok: false, error: 'ERROR' }
 * // Note: ok(3) is never evaluated
 *
 * // Combine API responses
 * const data = all([
 *   fetchUser(id),
 *   fetchPosts(id),
 *   fetchComments(id)
 * ]);
 * // data.value: [user, posts, comments] if all succeed
 * ```
 */
export function all<const T extends readonly Result<unknown, unknown, unknown>[]>(
  results: T
): AllResult<T> {
  const values: unknown[] = [];
  for (const result of results) {
    if (!result.ok) {
      return result as unknown as AllResult<T>;
    }
    values.push(result.value);
  }
  return ok(values) as AllResult<T>;
}

/**
 * Combines multiple Results or Promises of Results into one (async version of `all`).
 *
 * ## When to Use
 *
 * Use `allAsync()` when:
 * - You have multiple async operations that all must succeed
 * - You want to run operations in parallel (better performance)
 * - You want to short-circuit on the first error (fail-fast)
 * - You need all values together from parallel operations
 *
 * ## Why Use This Instead of `all`
 *
 * - **Parallel execution**: All Promises start immediately (faster)
 * - **Async support**: Works with Promises and AsyncResults
 * - **Promise rejection handling**: Converts Promise rejections to `PromiseRejectedError`
 *
 * ## Important
 *
 * - **Short-circuits**: Returns first error immediately, cancels remaining operations
 * - **Parallel**: All operations start simultaneously (unlike sequential `andThen`)
 * - **Use `allSettledAsync`**: If you need to collect all errors
 *
 * @param results - Array of Results or Promises of Results to combine (all must succeed)
 * @returns A Promise resolving to a Result with an array of all success values, or the first error
 *
 * @example
 * ```typescript
 * // Parallel API calls
 * const combined = await allAsync([
 *   fetchUser('1'),
 *   fetchPosts('1'),
 *   fetchComments('1')
 * ]);
 * // All three calls start simultaneously
 * // combined: { ok: true, value: [user, posts, comments] } if all succeed
 *
 * // Mix Results and Promises
 * const data = await allAsync([
 *   ok(cachedUser), // Already resolved
 *   fetchPosts(userId), // Promise
 * ]);
 * ```
 */
export async function allAsync<
  const T extends readonly (Result<unknown, unknown, unknown> | Promise<Result<unknown, unknown, unknown>>)[]
>(
  results: T
): Promise<
  Result<
    { [K in keyof T]: T[K] extends Result<infer V, unknown, unknown> | Promise<Result<infer V, unknown, unknown>> ? V : never },
    { [K in keyof T]: T[K] extends Result<unknown, infer E, unknown> | Promise<Result<unknown, infer E, unknown>> ? E : never }[number] | PromiseRejectedError,
    { [K in keyof T]: T[K] extends Result<unknown, unknown, infer C> | Promise<Result<unknown, unknown, infer C>> ? C : never }[number] | PromiseRejectionCause
  >
> {
  type Values = { [K in keyof T]: T[K] extends Result<infer V, unknown, unknown> | Promise<Result<infer V, unknown, unknown>> ? V : never };
  type Errors = { [K in keyof T]: T[K] extends Result<unknown, infer E, unknown> | Promise<Result<unknown, infer E, unknown>> ? E : never }[number] | PromiseRejectedError;
  type Causes = { [K in keyof T]: T[K] extends Result<unknown, unknown, infer C> | Promise<Result<unknown, unknown, infer C>> ? C : never }[number] | PromiseRejectionCause;

  if (results.length === 0) {
    return ok([]) as Result<Values, Errors, Causes>;
  }

  return new Promise((resolve) => {
    let settled = false;
    let pendingCount = results.length;
    const values: unknown[] = new Array(results.length);

    for (let i = 0; i < results.length; i++) {
      const index = i;
      Promise.resolve(results[index])
        .catch((reason) => err(
          { type: "PROMISE_REJECTED" as const, cause: reason },
          { cause: { type: "PROMISE_REJECTION" as const, reason } as PromiseRejectionCause }
        ))
        .then((result) => {
          if (settled) return;

          if (!result.ok) {
            settled = true;
            resolve(result as Result<Values, Errors, Causes>);
            return;
          }

          values[index] = result.value;
          pendingCount--;

          if (pendingCount === 0) {
            resolve(ok(values) as Result<Values, Errors, Causes>);
          }
        });
    }
  });
}

export type SettledError<E, C = unknown> = { error: E; cause?: C };

// Conditional type: returns Ok<...> when there are no errors, Result<...> otherwise
type AllSettledResult<T extends readonly Result<unknown, unknown, unknown>[]> =
  [AllErrors<T>] extends [never]
    ? Ok<AllValues<T>>
    : Result<AllValues<T>, SettledError<AllErrors<T>, AllCauses<T>>[]>;

/**
 * Combines multiple Results, collecting all errors instead of short-circuiting.
 *
 * ## When to Use
 *
 * Use `allSettled()` when:
 * - You need to see ALL errors, not just the first one
 * - You're doing form validation (show all field errors)
 * - You want to collect partial results (some succeed, some fail)
 * - You need to process all Results regardless of failures
 *
 * ## Why Use This Instead of `all`
 *
 * - **Collects all errors**: Returns array of all errors, not just first
 * - **No short-circuit**: Evaluates all Results even if some fail
 * - **Partial success**: Can see which operations succeeded and which failed
 * - **Better UX**: Show users all validation errors at once
 *
 * ## Important
 *
 * - **No short-circuit**: All Results are evaluated (slower if many fail early)
 * - **Error array**: Returns array of `{ error, cause }` objects, not single error
 * - **Use `all`**: If you want fail-fast behavior (better performance)
 *
 * @param results - Array of Results to combine (all are evaluated)
 * @returns A Result with:
 *   - Array of all success values if all succeed
 *   - Array of `{ error, cause }` objects if any fail
 *
 * @example
 * ```typescript
 * // Form validation - show all errors
 * const validated = allSettled([
 *   validateEmail(email),
 *   validatePassword(password),
 *   validateAge(age),
 * ]);
 * // If email and password fail:
 * // { ok: false, error: [
 * //   { error: 'INVALID_EMAIL' },
 * //   { error: 'WEAK_PASSWORD' }
 * // ]}
 *
 * // Collect partial results
 * const results = allSettled([
 *   fetchUser('1'), // succeeds
 *   fetchUser('2'), // fails
 *   fetchUser('3'), // succeeds
 * ]);
 * // Can see which succeeded and which failed
 * ```
 */
export function allSettled<const T extends readonly Result<unknown, unknown, unknown>[]>(
  results: T
): AllSettledResult<T> {
  const values: unknown[] = [];
  const errors: SettledError<unknown>[] = [];

  for (const result of results) {
    if (result.ok) {
      values.push(result.value);
    } else {
      errors.push({ error: result.error, cause: result.cause });
    }
  }

  if (errors.length > 0) {
    return err(errors) as unknown as AllSettledResult<T>;
  }

  return ok(values) as unknown as AllSettledResult<T>;
}

/**
 * Splits an array of Results into separate arrays of success values and errors.
 *
 * ## When to Use
 *
 * Use `partition()` when:
 * - You have an array of Results and need to separate successes from failures
 * - You want to process successes and errors separately
 * - You're collecting results from multiple operations (some may fail)
 * - You need to handle partial success scenarios
 *
 * ## Why Use This
 *
 * - **Simple separation**: One call splits successes and errors
 * - **Type-safe**: TypeScript knows `values` is `T[]` and `errors` is `E[]`
 * - **No unwrapping**: Doesn't require manual `if (r.ok)` checks
 * - **Preserves order**: Maintains original array order in both arrays
 *
 * ## Common Pattern
 *
 * Often used after `Promise.all()` with Results:
 * ```typescript
 * const results = await Promise.all(ids.map(id => fetchUser(id)));
 * const { values: users, errors } = partition(results);
 * // Process successful users, handle errors separately
 * ```
 *
 * @param results - Array of Results to partition
 * @returns An object with:
 *   - `values`: Array of all success values (type `T[]`)
 *   - `errors`: Array of all error values (type `E[]`)
 *
 * @example
 * ```typescript
 * // Split successes and errors
 * const results = [ok(1), err('ERROR_1'), ok(3), err('ERROR_2')];
 * const { values, errors } = partition(results);
 * // values: [1, 3]
 * // errors: ['ERROR_1', 'ERROR_2']
 *
 * // Process batch operations
 * const userResults = await Promise.all(userIds.map(id => fetchUser(id)));
 * const { values: users, errors: fetchErrors } = partition(userResults);
 *
 * // Process successful users
 * users.forEach(user => processUser(user));
 *
 * // Handle errors
 * fetchErrors.forEach(error => logError(error));
 * ```
 */
export function partition<T, E, C>(
  results: readonly Result<T, E, C>[]
): { values: T[]; errors: E[] } {
  const values: T[] = [];
  const errors: E[] = [];

  for (const result of results) {
    if (result.ok) {
      values.push(result.value);
    } else {
      errors.push(result.error);
    }
  }

  return { values, errors };
}

type AnyValue<T extends readonly Result<unknown, unknown, unknown>[]> =
  T[number] extends Result<infer U, unknown, unknown> ? U : never;
type AnyErrors<T extends readonly Result<unknown, unknown, unknown>[]> = {
  -readonly [K in keyof T]: T[K] extends Result<unknown, infer E, unknown> ? E : never;
}[number];
type AnyCauses<T extends readonly Result<unknown, unknown, unknown>[]> = {
  -readonly [K in keyof T]: T[K] extends Result<unknown, unknown, infer C> ? C : never;
}[number];

/**
 * Returns the first successful Result from an array (succeeds fast).
 *
 * ## When to Use
 *
 * Use `any()` when:
 * - You have multiple fallback options and need the first that succeeds
 * - You're trying multiple strategies (e.g., cache → DB → API)
 * - You want fail-fast success (stops on first success)
 * - You have redundant data sources and any one will do
 *
 * ## Why Use This
 *
 * - **Succeeds fast**: Returns immediately on first success (better performance)
 * - **Fallback pattern**: Perfect for trying multiple options
 * - **Short-circuits**: Stops evaluating after first success
 * - **Type-safe**: TypeScript infers the success type
 *
 * ## Important
 *
 * - **First success wins**: Returns first successful Result, ignores rest
 * - **All errors**: If all fail, returns first error (not all errors)
 * - **Empty array**: Returns `EmptyInputError` if array is empty
 * - **Use `all`**: If you need ALL to succeed
 *
 * @param results - Array of Results to check (evaluated in order)
 * @returns The first successful Result, or first error if all fail, or `EmptyInputError` if empty
 *
 * @example
 * ```typescript
 * // Try multiple fallback strategies
 * const data = any([
 *   fetchFromCache(id),
 *   fetchFromDB(id),
 *   fetchFromAPI(id)
 * ]);
 * // Returns first that succeeds
 *
 * // Try multiple formats
 * const parsed = any([
 *   parseJSON(input),
 *   parseXML(input),
 *   parseYAML(input)
 * ]);
 *
 * // All errors case
 * const allErrors = any([err('A'), err('B'), err('C')]);
 * // allErrors: { ok: false, error: 'A' } (first error)
 * ```
 */
export function any<const T extends readonly Result<unknown, unknown, unknown>[]>(
  results: T
): Result<AnyValue<T>, AnyErrors<T> | EmptyInputError, AnyCauses<T>> {
  type ReturnErr = Result<never, AnyErrors<T> | EmptyInputError, AnyCauses<T>>;
  type ReturnOk = Result<AnyValue<T>, never, AnyCauses<T>>;

  if (results.length === 0) {
    return err({
      type: "EMPTY_INPUT",
      message: "any() requires at least one Result",
    }) as ReturnErr;
  }
  let firstError: Result<never, unknown, unknown> | null = null;
  for (const result of results) {
    if (result.ok) return result as ReturnOk;
    if (!firstError) firstError = result;
  }
  return firstError as ReturnErr;
}

type AnyAsyncValue<T extends readonly MaybeAsyncResult<unknown, unknown, unknown>[]> =
  Awaited<T[number]> extends Result<infer U, unknown, unknown> ? U : never;
type AnyAsyncErrors<T extends readonly MaybeAsyncResult<unknown, unknown, unknown>[]> = {
  -readonly [K in keyof T]: Awaited<T[K]> extends Result<unknown, infer E, unknown>
    ? E
    : never;
}[number];
type AnyAsyncCauses<T extends readonly MaybeAsyncResult<unknown, unknown, unknown>[]> = {
  -readonly [K in keyof T]: Awaited<T[K]> extends Result<unknown, unknown, infer C>
    ? C
    : never;
}[number];

/**
 * Returns the first successful Result from an array of Results or Promises (async version of `any`).
 *
 * ## When to Use
 *
 * Use `anyAsync()` when:
 * - You have multiple async fallback options and need the first that succeeds
 * - You're trying multiple async strategies in parallel (cache → DB → API)
 * - You want fail-fast success from parallel operations
 * - You have redundant async data sources and any one will do
 *
 * ## Why Use This Instead of `any`
 *
 * - **Parallel execution**: All Promises start immediately (faster)
 * - **Async support**: Works with Promises and AsyncResults
 * - **Promise rejection handling**: Converts Promise rejections to `PromiseRejectedError`
 *
 * ## Important
 *
 * - **First success wins**: Returns first successful Result (from any Promise)
 * - **Parallel**: All operations run simultaneously
 * - **All errors**: If all fail, returns first error encountered
 *
 * @param results - Array of Results or Promises of Results to check (all start in parallel)
 * @returns A Promise resolving to the first successful Result, or first error if all fail
 *
 * @example
 * ```typescript
 * // Try multiple async fallbacks in parallel
 * const data = await anyAsync([
 *   fetchFromCache(id), // Fastest wins
 *   fetchFromDB(id),
 *   fetchFromAPI(id)
 * ]);
 *
 * // Try multiple API endpoints
 * const response = await anyAsync([
 *   fetch('/api/v1/data'),
 *   fetch('/api/v2/data'),
 *   fetch('/backup-api/data')
 * ]);
 * ```
 */
export async function anyAsync<
  const T extends readonly MaybeAsyncResult<unknown, unknown, unknown>[],
>(
  results: T
): Promise<
  Result<AnyAsyncValue<T>, AnyAsyncErrors<T> | EmptyInputError | PromiseRejectedError, AnyAsyncCauses<T> | PromiseRejectionCause>
> {
  type ReturnErr = Result<
    never,
    AnyAsyncErrors<T> | EmptyInputError | PromiseRejectedError,
    AnyAsyncCauses<T> | PromiseRejectionCause
  >;
  type ReturnOk = Result<AnyAsyncValue<T>, never, AnyAsyncCauses<T>>;

  if (results.length === 0) {
    return err({
      type: "EMPTY_INPUT",
      message: "anyAsync() requires at least one Result",
    }) as ReturnErr;
  }

  return new Promise((resolve) => {
    let settled = false;
    let pendingCount = results.length;
    let firstError: Result<never, unknown, unknown> | null = null;

    for (const item of results) {
      Promise.resolve(item)
        .catch((reason) =>
          err(
            { type: "PROMISE_REJECTED" as const, cause: reason },
            { cause: { type: "PROMISE_REJECTION" as const, reason } as PromiseRejectionCause }
          )
        )
        .then((result) => {
          if (settled) return;

          if (result.ok) {
            settled = true;
            resolve(result as ReturnOk);
            return;
          }

          if (!firstError) firstError = result;
          pendingCount--;

          if (pendingCount === 0) {
            resolve(firstError as ReturnErr);
          }
        });
    }
  });
}

type AllAsyncValues<T extends readonly MaybeAsyncResult<unknown, unknown, unknown>[]> = {
  [K in keyof T]: Awaited<T[K]> extends Result<infer V, unknown, unknown> ? V : never;
};
type AllAsyncErrors<T extends readonly MaybeAsyncResult<unknown, unknown, unknown>[]> = {
  [K in keyof T]: Awaited<T[K]> extends Result<unknown, infer E, unknown> ? E : never;
}[number];
type AllAsyncCauses<T extends readonly MaybeAsyncResult<unknown, unknown, unknown>[]> = {
  [K in keyof T]: Awaited<T[K]> extends Result<unknown, unknown, infer C> ? C : never;
}[number];

/**
 * Combines multiple Results or Promises of Results, collecting all errors (async version of `allSettled`).
 *
 * ## When to Use
 *
 * Use `allSettledAsync()` when:
 * - You have multiple async operations and need ALL errors reported
 * - You're doing async form validation (show all field errors at once)
 * - You want to run operations in parallel and collect all results
 *
 * ## Behavior
 *
 * **Note:** Unlike `Promise.allSettled()`, this returns a Result:
 * - `ok(values[])` if ALL succeed
 * - `err(SettledError[])` if ANY fail (with all collected errors)
 *
 * This is consistent with awaitly's philosophy - all functions return Results.
 * `Promise.allSettled()` always succeeds with per-item status objects; this function
 * returns a single Result indicating overall success or failure.
 *
 * ## Why Use This Instead of `allSettled`
 *
 * - **Parallel execution**: All Promises start immediately (faster)
 * - **Async support**: Works with Promises and AsyncResults
 * - **Promise rejection handling**: Converts Promise rejections to `PromiseRejectedError`
 *
 * ## Important
 *
 * - **No short-circuit**: All operations complete (even if some fail)
 * - **Parallel**: All operations run simultaneously
 * - **Error array**: Returns array of `SettledError` objects (`{ error, cause? }`)
 *
 * @param results - Array of Results or Promises of Results to combine (all are evaluated)
 * @returns A Promise resolving to a Result with:
 *   - `ok(values[])` - Array of all success values if ALL succeed
 *   - `err(errors[])` - Array of `SettledError` objects if ANY fail
 *
 * @example
 * ```typescript
 * // Async form validation - see all errors at once
 * const validated = await allSettledAsync([
 *   validateEmailAsync(email),
 *   validatePasswordAsync(password),
 *   checkUsernameAvailableAsync(username),
 * ]);
 *
 * if (!validated.ok) {
 *   // validated.error is array of all validation failures
 *   console.log('Errors:', validated.error.map(e => e.error));
 * }
 *
 * // Parallel API calls with error collection
 * const results = await allSettledAsync([
 *   fetchUser('1'),
 *   fetchUser('2'),
 *   fetchUser('3'),
 * ]);
 * ```
 */
export async function allSettledAsync<
  const T extends readonly MaybeAsyncResult<unknown, unknown, unknown>[],
>(
  results: T
): Promise<Result<AllAsyncValues<T>, SettledError<AllAsyncErrors<T> | PromiseRejectedError, AllAsyncCauses<T> | PromiseRejectionCause>[]>> {
  const settled = await Promise.all(
    results.map((item) =>
      Promise.resolve(item)
        .then((result) => ({ status: "result" as const, result }))
        .catch((reason) => ({
          status: "rejected" as const,
          error: { type: "PROMISE_REJECTED" as const, cause: reason } as PromiseRejectedError,
          cause: { type: "PROMISE_REJECTION" as const, reason } as PromiseRejectionCause,
        }))
    )
  );

  const values: unknown[] = [];
  const errors: SettledError<unknown, unknown>[] = [];

  for (const item of settled) {
    if (item.status === "rejected") {
      errors.push({ error: item.error, cause: item.cause });
    } else if (item.result.ok) {
      values.push(item.result.value);
    } else {
      errors.push({ error: item.result.error, cause: item.result.cause });
    }
  }

  if (errors.length > 0) {
    return err(errors) as unknown as Result<AllAsyncValues<T>, SettledError<AllAsyncErrors<T> | PromiseRejectedError, AllAsyncCauses<T> | PromiseRejectionCause>[]>;
  }
  return ok(values) as unknown as Result<AllAsyncValues<T>, SettledError<AllAsyncErrors<T> | PromiseRejectedError, AllAsyncCauses<T> | PromiseRejectionCause>[]>;
}

/**
 * Combines two Results into a tuple Result.
 *
 * ## When to Use
 *
 * Use `zip()` when:
 * - You have two independent Results and need both values together
 * - You want to combine validation results before processing
 * - You need a pair/tuple from two separate operations
 *
 * ## Why Use This Instead of `all()`
 *
 * - **Simpler types**: Returns `[A, B]` instead of array inference
 * - **Two-argument**: Cleaner API for common case of combining two Results
 * - **Compose with andThen**: Chain multiple zips for complex combinations
 *
 * ## Important
 *
 * - **Short-circuits**: Returns first error if either fails
 * - **Order matters**: If both fail, returns error from first argument
 * - **Use `all()`**: For more than 2 Results
 *
 * @param a - First Result
 * @param b - Second Result
 * @returns A Result containing a tuple `[A, B]` if both succeed, or the first error
 *
 * @example
 * ```typescript
 * // Combine two Results
 * const userResult = await fetchUser('1');
 * const postsResult = await fetchPosts('1');
 * const combined = zip(userResult, postsResult);
 * // combined: Result<[User, Post[]], UserError | PostsError>
 *
 * // Use with andThen for chaining
 * const result = andThen(
 *   zip(fetchUser('1'), fetchPosts('1')),
 *   ([user, posts]) => createDashboard(user, posts)
 * );
 *
 * // Validation combination
 * const validated = zip(
 *   validateEmail(email),
 *   validatePassword(password)
 * );
 * if (validated.ok) {
 *   const [email, password] = validated.value;
 *   createAccount(email, password);
 * }
 * ```
 */
export function zip<A, EA, CA, B, EB, CB>(
  a: Result<A, EA, CA>,
  b: Result<B, EB, CB>
): Result<[A, B], EA | EB, CA | CB> {
  if (!a.ok) return a as Result<never, EA, CA>;
  if (!b.ok) return b as Result<never, EB, CB>;
  return ok([a.value, b.value]) as Result<[A, B], never, never>;
}

/**
 * Async version of `zip()` - combines two Results or Promises of Results into a tuple.
 *
 * ## When to Use
 *
 * Use `zipAsync()` when:
 * - You have two async operations and need both results together
 * - You want to run two fetches in parallel and combine results
 * - You need to combine Promises of Results into a single Result
 *
 * ## Why Use This Instead of `allAsync()`
 *
 * - **Simpler types**: Returns `[A, B]` instead of array inference
 * - **Two-argument**: Cleaner API for common case of combining two async Results
 * - **Parallel execution**: Both Promises start immediately
 *
 * ## Important
 *
 * - **Parallel**: Both operations run simultaneously (faster than sequential)
 * - **Short-circuits result**: Returns first argument's error if it fails, else second's
 * - **Waits for both**: Both Promises complete before returning (unlike `allAsync` fail-fast)
 * - **Rejection handling**: Promise rejections are wrapped as `PromiseRejectedError`
 * - **Use `allAsync()`**: For more than 2 Results
 *
 * @param a - First Result or Promise of Result
 * @param b - Second Result or Promise of Result
 * @returns A Promise of Result containing a tuple `[A, B]` if both succeed
 *
 * @example
 * ```typescript
 * // Parallel async operations
 * const result = await zipAsync(
 *   fetchUser('1'),
 *   fetchPosts('1')
 * );
 * // Both fetches run in parallel
 * // result: Result<[User, Post[]], UserError | PostsError>
 *
 * // Mix sync and async
 * const combined = await zipAsync(
 *   ok({ cached: true }), // Already resolved
 *   fetchFromAPI(id),     // Async fetch
 * );
 *
 * // With chaining
 * const dashboard = await zipAsync(fetchUser('1'), fetchPosts('1'))
 *   .then(result => andThen(result, ([user, posts]) => createDashboard(user, posts)));
 * ```
 */
export async function zipAsync<A, EA, CA, B, EB, CB>(
  a: Result<A, EA, CA> | Promise<Result<A, EA, CA>>,
  b: Result<B, EB, CB> | Promise<Result<B, EB, CB>>
): AsyncResult<[A, B], EA | EB | PromiseRejectedError, CA | CB | PromiseRejectionCause> {
  // Wrap rejections into PromiseRejectedError (consistent with allAsync)
  const wrapRejection = <T, E, C>(
    p: Result<T, E, C> | Promise<Result<T, E, C>>
  ): Promise<Result<T, E | PromiseRejectedError, C | PromiseRejectionCause>> =>
    Promise.resolve(p).catch((reason) =>
      err(
        { type: "PROMISE_REJECTED" as const, cause: reason } as PromiseRejectedError,
        { cause: { type: "PROMISE_REJECTION" as const, reason } as PromiseRejectionCause }
      )
    );

  const [ra, rb] = await Promise.all([wrapRejection(a), wrapRejection(b)]);
  return zip(ra, rb);
}
