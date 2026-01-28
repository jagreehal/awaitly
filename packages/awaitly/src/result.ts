/**
 * awaitly/result (internal)
 *
 * Core Result primitives - minimal bundle for typed error handling.
 * This file is intentionally kept small for optimal tree-shaking.
 * The full orchestration (run, step, etc.) lives in core.ts.
 */

// =============================================================================
// Core Result Types
// =============================================================================

/**
 * Represents a successful result.
 * Use `ok(value)` to create instances.
 */
export type Ok<T> = { ok: true; value: T };

/**
 * Represents a failed result.
 * Use `err(error)` to create instances.
 */
export type Err<E, C = unknown> = { ok: false; error: E; cause?: C };

/**
 * Represents a successful computation or a failed one.
 */
export type Result<T, E = unknown, C = unknown> = Ok<T> | Err<E, C>;

/**
 * A Promise that resolves to a Result.
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

export type UnexpectedError = {
  type: typeof UNEXPECTED_ERROR;
  cause: UnexpectedCause;
};
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
 */
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

/**
 * Creates a failed Result.
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
 */
export const isOk = <T, E, C>(r: Result<T, E, C>): r is Ok<T> => r.ok;

/**
 * Checks if a Result is a failure.
 */
export const isErr = <T, E, C>(r: Result<T, E, C>): r is Err<E, C> => !r.ok;

/**
 * Checks if an error is an UnexpectedError.
 */
export const isUnexpectedError = (e: unknown): e is UnexpectedError =>
  typeof e === "object" &&
  e !== null &&
  "type" in e &&
  e.type === UNEXPECTED_ERROR;

/**
 * Checks if an error is a PromiseRejectedError.
 */
export const isPromiseRejectedError = (e: unknown): e is PromiseRejectedError =>
  typeof e === "object" &&
  e !== null &&
  "type" in e &&
  e.type === PROMISE_REJECTED;

// =============================================================================
// Error Matching
// =============================================================================

export type MatchErrorHandlers<E extends string, R> = {
  [K in E]: (error: K extends "UNEXPECTED_ERROR" ? UnexpectedError : K) => R;
};

/**
 * Match on string error types with exhaustive checking.
 * Takes an error value (not a Result) and handlers for each error type.
 */
export function matchError<E extends string, R>(
  error: E | UnexpectedError,
  handlers: MatchErrorHandlers<E, R>
): R {
  // Handle UnexpectedError objects
  if (isUnexpectedError(error)) {
    return (handlers as MatchErrorHandlers<"UNEXPECTED_ERROR", R>).UNEXPECTED_ERROR(error);
  }
  // Handle the string literal "UNEXPECTED_ERROR" - wrap it in an UnexpectedError object
  // to maintain the typed contract that UNEXPECTED_ERROR handler receives an object
  if (error === "UNEXPECTED_ERROR") {
    const syntheticError: UnexpectedError = {
      type: UNEXPECTED_ERROR,
      cause: { type: "UNCAUGHT_EXCEPTION", thrown: error },
    };
    return (handlers as MatchErrorHandlers<"UNEXPECTED_ERROR", R>).UNEXPECTED_ERROR(syntheticError);
  }
  // Cast to the excluded type since we've handled UNEXPECTED_ERROR above
  type StringErrors = Exclude<E, "UNEXPECTED_ERROR">;
  return (handlers as unknown as Record<string, (e: string) => R>)[error as StringErrors](error as StringErrors);
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
// Unwrap Utilities
// =============================================================================

/**
 * Error thrown when attempting to unwrap an Err result.
 */
export class UnwrapError extends Error {
  public readonly error: unknown;
  public readonly cause?: unknown;

  constructor(result: Err<unknown, unknown>) {
    const errorStr =
      typeof result.error === "string"
        ? result.error
        : JSON.stringify(result.error);
    super(`Attempted to unwrap an Err: ${errorStr}`);
    this.name = "UnwrapError";
    this.error = result.error;
    this.cause = result.cause;
  }
}

/**
 * Extracts the value from an Ok result, or throws UnwrapError if it's an Err.
 */
export const unwrap = <T, E, C>(r: Result<T, E, C>): T => {
  if (r.ok) return r.value;
  throw new UnwrapError(r);
};

/**
 * Extracts the value from an Ok result, or returns a default value if it's an Err.
 */
export const unwrapOr = <T, E, C>(r: Result<T, E, C>, defaultValue: T): T =>
  r.ok ? r.value : defaultValue;

/**
 * Extracts the value from an Ok result, or calls a function to get a default value if it's an Err.
 */
export const unwrapOrElse = <T, E, C>(
  r: Result<T, E, C>,
  fn: (error: E, cause?: C) => T
): T => (r.ok ? r.value : fn(r.error, r.cause));

// =============================================================================
// Wrapping Functions
// =============================================================================

/**
 * Wraps a synchronous function that might throw into a Result.
 */
export function from<T>(fn: () => T): Ok<T> | Err<unknown, unknown>;
export function from<T, E>(fn: () => T, onError: (cause: unknown) => E): Ok<T> | Err<E, unknown>;
export function from<T, E>(fn: () => T, onError?: (cause: unknown) => E) {
  try {
    return ok(fn());
  } catch (cause) {
    return onError ? err(onError(cause), { cause }) : err(cause);
  }
}

/**
 * Wraps a Promise into a Result.
 */
export function fromPromise<T>(promise: Promise<T>): Promise<Ok<T> | Err<unknown, unknown>>;
export function fromPromise<T, E>(
  promise: Promise<T>,
  onError: (cause: unknown) => E
): Promise<Ok<T> | Err<E, unknown>>;
export async function fromPromise<T, E>(
  promise: Promise<T>,
  onError?: (cause: unknown) => E
): Promise<Ok<T> | Err<E | unknown, unknown>> {
  try {
    return ok(await promise);
  } catch (cause) {
    return onError ? err(onError(cause), { cause }) : err(cause);
  }
}

/**
 * Wraps an async function that might throw into an AsyncResult.
 */
export function tryAsync<T>(fn: () => Promise<T>): AsyncResult<T, unknown>;
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
 * Converts a nullable value into a Result.
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
 * Transforms the value inside an Ok result.
 */
export function map<T, U>(r: Ok<T>, fn: (value: T) => U): Ok<U>;
export function map<T, U, E, C>(r: Err<E, C>, fn: (value: T) => U): Err<E, C>;
export function map<T, U, E, C>(r: Result<T, E, C>, fn: (value: T) => U): Result<U, E, C>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function map(r: any, fn: any): any {
  return r.ok ? ok(fn(r.value)) : r;
}

/**
 * Transforms the error inside an Err result.
 */
export function mapError<T, E, F, C>(
  r: Result<T, E, C>,
  fn: (error: E, cause?: C) => F
): Result<T, F, C> {
  return r.ok ? r : err(fn(r.error, r.cause), { cause: r.cause });
}

/**
 * Pattern match on a Result.
 */
export function match<T, E, C, R>(r: Ok<T>, handlers: { ok: (value: T) => R; err: (error: E, cause?: C) => R }): R;
export function match<T, E, C, R>(r: Err<E, C>, handlers: { ok: (value: T) => R; err: (error: E, cause?: C) => R }): R;
export function match<T, E, C, R>(r: Result<T, E, C>, handlers: { ok: (value: T) => R; err: (error: E, cause?: C) => R }): R;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function match(r: any, handlers: any): any {
  return r.ok ? handlers.ok(r.value) : handlers.err(r.error, r.cause);
}

/**
 * Chain Result-returning functions.
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
 * Execute a side effect on Ok values.
 */
export function tap<T, E, C>(
  r: Result<T, E, C>,
  fn: (value: T) => void
): Result<T, E, C> {
  if (r.ok) fn(r.value);
  return r;
}

/**
 * Execute a side effect on Err values.
 */
export function tapError<T, E, C>(
  r: Result<T, E, C>,
  fn: (error: E, cause?: C) => void
): Result<T, E, C> {
  if (!r.ok) fn(r.error, r.cause);
  return r;
}

/**
 * Transform value with a function that might throw.
 */
export function mapTry<T, U, E, F, C>(
  r: Result<T, E, C>,
  fn: (value: T) => U,
  onError: (thrown: unknown) => F
): Result<U, E | F, C | unknown> {
  if (!r.ok) return r;
  try {
    return ok(fn(r.value));
  } catch (error) {
    return err(onError(error), { cause: error });
  }
}

/**
 * Transform error with a function that might throw.
 */
export function mapErrorTry<T, E, F, G, C>(
  r: Result<T, E, C>,
  fn: (error: E) => F,
  onError: (thrown: unknown) => G
): Result<T, F | G, C | unknown> {
  if (r.ok) return r;
  try {
    return err(fn(r.error), { cause: r.cause });
  } catch (error) {
    return err(onError(error), { cause: error });
  }
}

/**
 * Transform both value and error.
 */
export function bimap<T, U, E, F, C>(
  r: Result<T, E, C>,
  onOk: (value: T) => U,
  onErr: (error: E, cause?: C) => F
): Result<U, F, C> {
  return r.ok ? ok(onOk(r.value)) : err(onErr(r.error, r.cause), { cause: r.cause });
}

/**
 * Provide an alternative Result if the first is an Err.
 */
export function orElse<T, E, E2, C, C2>(
  r: Result<T, E, C>,
  fn: (error: E, cause?: C) => Result<T, E2, C2>
): Result<T, E2, C | C2> {
  return r.ok ? r : fn(r.error, r.cause);
}

/**
 * Async version of orElse.
 */
export async function orElseAsync<T, E, E2, C, C2>(
  r: Result<T, E, C>,
  fn: (error: E, cause?: C) => Promise<Result<T, E2, C2>>
): Promise<Result<T, E2, C | C2>> {
  return r.ok ? r : fn(r.error, r.cause);
}

/**
 * Recover from errors - always returns Ok<T>.
 */
export function recover<T, E, C>(
  r: Result<T, E, C>,
  fn: (error: E, cause?: C) => T
): Ok<T> {
  return r.ok ? ok(r.value) : ok(fn(r.error, r.cause));
}

/**
 * Async version of recover - always returns Promise<Ok<T>>.
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
 * Hydrate a serialized Result back into a proper Result object.
 */
export function hydrate<T, E, C = unknown>(value: unknown): Result<T, E, C> | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("ok" in value)) return null;

  const obj = value as Record<string, unknown>;
  if (obj.ok === true && "value" in obj) {
    return ok(obj.value as T);
  }
  if (obj.ok === false && "error" in obj) {
    return err(obj.error as E, { cause: obj.cause as C });
  }
  return null;
}

/**
 * Type guard to check if a value is a serialized Result.
 */
export function isSerializedResult(
  value: unknown
): value is { ok: boolean; value?: unknown; error?: unknown; cause?: unknown } {
  if (typeof value !== "object" || value === null) return false;
  if (!("ok" in value)) return false;
  const obj = value as Record<string, unknown>;
  return (
    (obj.ok === true && "value" in obj) ||
    (obj.ok === false && "error" in obj)
  );
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
 * Combines multiple Results into a single Result containing an array of values.
 * Returns the first Err encountered, or Ok with all values.
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
 * Async version of all - works with Promises of Results.
 */
export async function allAsync<
  const T extends readonly (Result<unknown, unknown, unknown> | Promise<Result<unknown, unknown, unknown>>)[]
>(
  results: T
): Promise<
  Result<
    { [K in keyof T]: T[K] extends Result<infer V, unknown, unknown> | Promise<Result<infer V, unknown, unknown>> ? V : never },
    | { [K in keyof T]: T[K] extends Result<unknown, infer E, unknown> | Promise<Result<unknown, infer E, unknown>> ? E : never }[number]
    | PromiseRejectedError,
    | { [K in keyof T]: T[K] extends Result<unknown, unknown, infer C> | Promise<Result<unknown, unknown, infer C>> ? C : never }[number]
    | PromiseRejectionCause
  >
> {
  const values: unknown[] = [];
  for (const resultOrPromise of results) {
    try {
      const r = await resultOrPromise;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!r.ok) return r as any;
      values.push(r.value);
    } catch (reason) {
      return err(
        { type: PROMISE_REJECTED, cause: reason } as PromiseRejectedError,
        { cause: { type: "PROMISE_REJECTION", reason } as PromiseRejectionCause }
      );
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ok(values) as any;
}

export type SettledError<E, C = unknown> = { error: E; cause?: C };

// Conditional type: returns Ok<...> when there are no errors, Result<...> otherwise
type AllSettledResult<T extends readonly Result<unknown, unknown, unknown>[]> =
  [AllErrors<T>] extends [never]
    ? Ok<AllValues<T>>
    : Result<AllValues<T>, SettledError<AllErrors<T>, AllCauses<T>>[]>;

/**
 * Collects all Results, returning Ok with values if all succeed,
 * or Err with array of errors if any fail.
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
 * Async version of allSettled.
 */
export async function allSettledAsync<
  const T extends readonly (Result<unknown, unknown, unknown> | Promise<Result<unknown, unknown, unknown>>)[]
>(
  results: T
): Promise<
  Result<
    { [K in keyof T]: T[K] extends Result<infer V, unknown, unknown> | Promise<Result<infer V, unknown, unknown>> ? V : never },
    SettledError<
      | { [K in keyof T]: T[K] extends Result<unknown, infer E, unknown> | Promise<Result<unknown, infer E, unknown>> ? E : never }[number]
      | PromiseRejectedError,
      | { [K in keyof T]: T[K] extends Result<unknown, unknown, infer C> | Promise<Result<unknown, unknown, infer C>> ? C : never }[number]
      | PromiseRejectionCause
    >[]
  >
> {
  const settled = await Promise.all(
    results.map((item) =>
      Promise.resolve(item)
        .then((result) => ({ status: "result" as const, result }))
        .catch((reason) => ({
          status: "rejected" as const,
          error: { type: PROMISE_REJECTED, cause: reason } as PromiseRejectedError,
          cause: { type: "PROMISE_REJECTION", reason } as PromiseRejectionCause,
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return err(errors) as any;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ok(values) as any;
}

/**
 * Partitions Results into { values, errors }.
 */
export function partition<T, E, C>(
  results: readonly Result<T, E, C>[]
): { values: T[]; errors: E[] } {
  const values: T[] = [];
  const errors: E[] = [];
  for (const r of results) {
    if (r.ok) values.push(r.value);
    else errors.push(r.error);
  }
  return { values, errors };
}

/**
 * Returns the first Ok result, or an EmptyInputError/first Err if all fail.
 */
export function any<const T extends readonly Result<unknown, unknown, unknown>[]>(
  results: T
): T extends readonly []
  ? Err<EmptyInputError, unknown>
  : Result<
      { [K in keyof T]: T[K] extends Result<infer V, unknown, unknown> ? V : never }[number],
      AllErrors<T> | EmptyInputError,
      AllCauses<T>
    >;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function any(results: any): any {
  if (results.length === 0) {
    return err({ type: "EMPTY_INPUT", message: "any() requires at least one Result" });
  }
  let firstErr: Err<unknown, unknown> | undefined;
  for (const r of results) {
    if (r.ok) return r;
    if (!firstErr) firstErr = r;
  }
  return firstErr;
}

/**
 * Async version of any - races promises and returns first success.
 */
export async function anyAsync<
  const T extends readonly (Result<unknown, unknown, unknown> | Promise<Result<unknown, unknown, unknown>>)[]
>(
  results: T
): Promise<
  T extends readonly []
    ? Err<EmptyInputError, unknown>
    : Result<
        { [K in keyof T]: T[K] extends Result<infer V, unknown, unknown> | Promise<Result<infer V, unknown, unknown>> ? V : never }[number],
        | { [K in keyof T]: T[K] extends Result<unknown, infer E, unknown> | Promise<Result<unknown, infer E, unknown>> ? E : never }[number]
        | EmptyInputError
        | PromiseRejectedError,
        | { [K in keyof T]: T[K] extends Result<unknown, unknown, infer C> | Promise<Result<unknown, unknown, infer C>> ? C : never }[number]
        | PromiseRejectionCause
      >
> {
  if (results.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return err({ type: "EMPTY_INPUT", message: "anyAsync() requires at least one Result" }) as any;
  }

  return new Promise((resolve) => {
    let settled = false;
    let pendingCount = results.length;
    let firstError: Err<unknown, unknown> | null = null;

    for (const item of results) {
      Promise.resolve(item)
        .catch((reason) =>
          err(
            { type: PROMISE_REJECTED, cause: reason } as PromiseRejectedError,
            { cause: { type: "PROMISE_REJECTION", reason } as PromiseRejectionCause }
          )
        )
        .then((result) => {
          if (settled) return;

          if (result.ok) {
            settled = true;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            resolve(result as any);
            return;
          }

          if (!firstError) firstError = result;
          pendingCount--;

          if (pendingCount === 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            resolve(firstError as any);
          }
        });
    }
  });
}

/**
 * Combines exactly two Results into a tuple.
 */
export function zip<A, EA, CA, B, EB, CB>(
  a: Result<A, EA, CA>,
  b: Result<B, EB, CB>
): Result<[A, B], EA | EB, CA | CB> {
  if (!a.ok) return a;
  if (!b.ok) return b;
  return ok([a.value, b.value]);
}

/**
 * Async version of zip.
 */
export async function zipAsync<A, EA, CA, B, EB, CB>(
  a: Result<A, EA, CA> | Promise<Result<A, EA, CA>>,
  b: Result<B, EB, CB> | Promise<Result<B, EB, CB>>
): Promise<Result<[A, B], EA | EB | PromiseRejectedError, CA | CB | PromiseRejectionCause>> {
  // Wrap rejections into PromiseRejectedError (consistent with allAsync)
  const wrapRejection = <T, E, C>(
    p: Result<T, E, C> | Promise<Result<T, E, C>>
  ): Promise<Result<T, E | PromiseRejectedError, C | PromiseRejectionCause>> =>
    Promise.resolve(p).catch((reason) =>
      err(
        { type: PROMISE_REJECTED, cause: reason } as PromiseRejectedError,
        { cause: { type: "PROMISE_REJECTION", reason } as PromiseRejectionCause }
      )
    );

  const [ra, rb] = await Promise.all([wrapRejection(a), wrapRejection(b)]);
  return zip(ra, rb);
}
