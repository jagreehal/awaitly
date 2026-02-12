/**
 * awaitly/functional
 *
 * Effect-inspired functional utilities for Result types.
 * Provides pipe-based composition with automatic error short-circuiting.
 */

import type { Result, AsyncResult, PromiseRejectedError, PromiseRejectionCause } from "../result";
import { ok, err, isOk, isErr, PROMISE_REJECTED } from "../result";

// =============================================================================
// Composition
// =============================================================================

/**
 * Pipe a value through a series of functions left-to-right.
 *
 * @example
 * ```typescript
 * const result = pipe(
 *   5,
 *   (x) => x * 2,
 *   (x) => x + 1
 * ); // 11
 * ```
 */
export function pipe<A>(a: A): A;
export function pipe<A, B>(a: A, ab: (a: A) => B): B;
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C;
export function pipe<A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D;
export function pipe<A, B, C, D, E>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E
): E;
export function pipe<A, B, C, D, E, F>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F
): F;
export function pipe<A, B, C, D, E, F, G>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G
): G;
export function pipe<A, B, C, D, E, F, G, H>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H
): H;
export function pipe<A, B, C, D, E, F, G, H, I>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H,
  hi: (h: H) => I
): I;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pipe(a: unknown, ...fns: Array<(x: any) => any>): unknown {
  return fns.reduce((acc, fn) => fn(acc), a);
}

/**
 * Compose functions left-to-right (returns a function).
 *
 * @example
 * ```typescript
 * const double = (x: number) => x * 2;
 * const addOne = (x: number) => x + 1;
 * const transform = flow(double, addOne);
 * transform(5); // 11
 * ```
 */
export function flow<A, B>(ab: (a: A) => B): (a: A) => B;
export function flow<A, B, C>(ab: (a: A) => B, bc: (b: B) => C): (a: A) => C;
export function flow<A, B, C, D>(ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): (a: A) => D;
export function flow<A, B, C, D, E>(
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E
): (a: A) => E;
export function flow<A, B, C, D, E, F>(
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F
): (a: A) => F;
export function flow<A, B, C, D, E, F, G>(
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G
): (a: A) => G;
export function flow<A, B, C, D, E, F, G, H>(
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H
): (a: A) => H;
export function flow<A, B, C, D, E, F, G, H, I>(
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H,
  hi: (h: H) => I
): (a: A) => I;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function flow(...fns: Array<(x: any) => any>): (a: unknown) => unknown {
  return (a: unknown) => fns.reduce((acc, fn) => fn(acc), a);
}

/**
 * Compose functions right-to-left.
 *
 * @example
 * ```typescript
 * const double = (x: number) => x * 2;
 * const addOne = (x: number) => x + 1;
 * const transform = compose(addOne, double);
 * transform(5); // 11 (double first, then addOne)
 * ```
 */
export function compose<A, B>(ab: (a: A) => B): (a: A) => B;
export function compose<A, B, C>(bc: (b: B) => C, ab: (a: A) => B): (a: A) => C;
export function compose<A, B, C, D>(cd: (c: C) => D, bc: (b: B) => C, ab: (a: A) => B): (a: A) => D;
export function compose<A, B, C, D, E>(
  de: (d: D) => E,
  cd: (c: C) => D,
  bc: (b: B) => C,
  ab: (a: A) => B
): (a: A) => E;
export function compose<A, B, C, D, E, F>(
  ef: (e: E) => F,
  de: (d: D) => E,
  cd: (c: C) => D,
  bc: (b: B) => C,
  ab: (a: A) => B
): (a: A) => F;
export function compose<A, B, C, D, E, F, G>(
  fg: (f: F) => G,
  ef: (e: E) => F,
  de: (d: D) => E,
  cd: (c: C) => D,
  bc: (b: B) => C,
  ab: (a: A) => B
): (a: A) => G;
export function compose<A, B, C, D, E, F, G, H>(
  gh: (g: G) => H,
  fg: (f: F) => G,
  ef: (e: E) => F,
  de: (d: D) => E,
  cd: (c: C) => D,
  bc: (b: B) => C,
  ab: (a: A) => B
): (a: A) => H;
export function compose<A, B, C, D, E, F, G, H, I>(
  hi: (h: H) => I,
  gh: (g: G) => H,
  fg: (f: F) => G,
  ef: (e: E) => F,
  de: (d: D) => E,
  cd: (c: C) => D,
  bc: (b: B) => C,
  ab: (a: A) => B
): (a: A) => I;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function compose(...fns: Array<(x: any) => any>): (a: unknown) => unknown {
  return (a: unknown) => fns.reduceRight((acc, fn) => fn(acc), a);
}

/**
 * Identity function - returns its argument unchanged.
 *
 * @example
 * ```typescript
 * identity(42); // 42
 * ```
 */
export const identity = <A>(a: A): A => a;

// =============================================================================
// Result Combinators (sync)
// =============================================================================

/**
 * Transform the success value of a Result.
 *
 * @example
 * ```typescript
 * const result = Awaitly.ok(5);
 * map(result, (x) => x * 2); // Awaitly.ok(10)
 *
 * const error = Awaitly.err("not found");
 * map(error, (x) => x * 2); // Awaitly.err("not found")
 * ```
 */
export function map<T, U, E, C>(result: Result<T, E, C>, fn: (value: T) => U): Result<U, E, C> {
  if (isOk(result)) {
    return ok(fn(result.value));
  }
  return result as Result<U, E, C>;
}

/**
 * Transform and flatten (short-circuits on error).
 *
 * @example
 * ```typescript
 * const divide = (a: number, b: number): Result<number, string> =>
 *   b === 0 ? Awaitly.err("division by zero") : Awaitly.ok(a / b);
 *
 * const result = Awaitly.ok(10);
 * flatMap(result, (x) => divide(x, 2)); // Awaitly.ok(5)
 * flatMap(result, (x) => divide(x, 0)); // Awaitly.err("division by zero")
 * ```
 */
export function flatMap<T, U, E1, E2, C1, C2>(
  result: Result<T, E1, C1>,
  fn: (value: T) => Result<U, E2, C2>
): Result<U, E1 | E2, C1 | C2> {
  if (isOk(result)) {
    return fn(result.value);
  }
  return result as Result<U, E1 | E2, C1 | C2>;
}

/**
 * Transform both success and error values.
 *
 * @example
 * ```typescript
 * const result = Awaitly.ok(5);
 * bimap(result, (x) => x * 2, (e) => `Error: ${e}`); // Awaitly.ok(10)
 *
 * const error = Awaitly.err("not found");
 * bimap(error, (x) => x * 2, (e) => `Error: ${e}`); // Awaitly.err("Error: not found")
 * ```
 */
export function bimap<T, U, E1, E2, C>(
  result: Result<T, E1, C>,
  onOk: (value: T) => U,
  onErr: (error: E1) => E2
): Result<U, E2, C> {
  if (isOk(result)) {
    return ok(onOk(result.value));
  }
  return err(onErr(result.error), { cause: result.cause }) as Result<U, E2, C>;
}

/**
 * Transform the error value.
 *
 * @example
 * ```typescript
 * const error = Awaitly.err("not found");
 * mapError(error, (e) => ({ type: "ERROR", message: e }));
 * // Awaitly.err({ type: "ERROR", message: "not found" })
 * ```
 */
export function mapError<T, E1, E2, C>(
  result: Result<T, E1, C>,
  fn: (error: E1) => E2
): Result<T, E2, C> {
  if (isErr(result)) {
    return err(fn(result.error), { cause: result.cause }) as Result<T, E2, C>;
  }
  return result as Result<T, E2, C>;
}

/**
 * Side effect on success (returns original result).
 *
 * @example
 * ```typescript
 * const result = Awaitly.ok(5);
 * tap(result, (x) => console.log(`Value: ${x}`)); // logs "Value: 5", returns Awaitly.ok(5)
 * ```
 */
export function tap<T, E, C>(result: Result<T, E, C>, fn: (value: T) => void): Result<T, E, C> {
  if (isOk(result)) {
    fn(result.value);
  }
  return result;
}

/**
 * Side effect on error (returns original result).
 *
 * @example
 * ```typescript
 * const error = Awaitly.err("not found");
 * tapError(error, (e) => console.log(`Error: ${e}`)); // logs "Error: not found", returns err
 * ```
 */
export function tapError<T, E, C>(result: Result<T, E, C>, fn: (error: E) => void): Result<T, E, C> {
  if (isErr(result)) {
    fn(result.error);
  }
  return result;
}

/**
 * Pattern match on Result.
 *
 * @example
 * ```typescript
 * const result = Awaitly.ok(5);
 * match(result, {
 *   ok: (x) => `Success: ${x}`,
 *   err: (e) => `Error: ${e}`
 * }); // "Success: 5"
 * ```
 */
export function match<T, E, U, C>(
  result: Result<T, E, C>,
  patterns: { ok: (value: T) => U; err: (error: E, cause?: C) => U }
): U {
  if (isOk(result)) {
    return patterns.ok(result.value);
  }
  return patterns.err(result.error, result.cause);
}

/**
 * Recover from error by providing fallback value.
 *
 * @example
 * ```typescript
 * const error = Awaitly.err("not found");
 * recover(error, () => 0); // 0
 *
 * const success = Awaitly.ok(5);
 * recover(success, () => 0); // 5
 * ```
 */
export function recover<T, E, C>(result: Result<T, E, C>, fn: (error: E) => T): T {
  if (isOk(result)) {
    return result.value;
  }
  return fn(result.error);
}

/**
 * Recover from error with another Result.
 *
 * @example
 * ```typescript
 * const error = Awaitly.err("not found");
 * recoverWith(error, (e) => ok(0)); // ok(0)
 * recoverWith(error, (e) => err("still failed")); // err("still failed")
 * ```
 */
export function recoverWith<T, E1, E2, C1, C2>(
  result: Result<T, E1, C1>,
  fn: (error: E1) => Result<T, E2, C2>
): Result<T, E2, C1 | C2> {
  if (isOk(result)) {
    return result as Result<T, E2, C1 | C2>;
  }
  return fn(result.error);
}

/**
 * Get the value or a default.
 *
 * @example
 * ```typescript
 * const error = Awaitly.err("not found");
 * getOrElse(error, 0); // 0
 *
 * const success = Awaitly.ok(5);
 * getOrElse(success, 0); // 5
 * ```
 */
export function getOrElse<T, E, C>(result: Result<T, E, C>, defaultValue: T): T {
  if (isOk(result)) {
    return result.value;
  }
  return defaultValue;
}

/**
 * Get the value or compute a default lazily.
 *
 * @example
 * ```typescript
 * const error = Awaitly.err("not found");
 * getOrElseLazy(error, () => expensiveComputation()); // calls expensiveComputation()
 *
 * const success = Awaitly.ok(5);
 * getOrElseLazy(success, () => expensiveComputation()); // 5, doesn't call expensiveComputation
 * ```
 */
export function getOrElseLazy<T, E, C>(result: Result<T, E, C>, fn: () => T): T {
  if (isOk(result)) {
    return result.value;
  }
  return fn();
}

// =============================================================================
// Result Combinators (async)
// =============================================================================

/**
 * Transform success value asynchronously.
 *
 * @example
 * ```typescript
 * const result = Awaitly.ok(5);
 * await mapAsync(result, async (x) => x * 2); // ok(10)
 * ```
 */
export async function mapAsync<T, U, E, C>(
  result: Result<T, E, C> | AsyncResult<T, E, C>,
  fn: (value: T) => Promise<U>
): AsyncResult<U, E, C> {
  const resolved = await result;
  if (isOk(resolved)) {
    return ok(await fn(resolved.value));
  }
  return resolved as Result<U, E, C>;
}

/**
 * Async flatMap.
 *
 * @example
 * ```typescript
 * const fetchUser = async (id: string): AsyncResult<User, "NOT_FOUND"> => { ... };
 * const result = Awaitly.ok("user-123");
 * await flatMapAsync(result, fetchUser); // AsyncResult<User, "NOT_FOUND">
 * ```
 */
export async function flatMapAsync<T, U, E1, E2, C1, C2>(
  result: Result<T, E1, C1> | AsyncResult<T, E1, C1>,
  fn: (value: T) => AsyncResult<U, E2, C2>
): AsyncResult<U, E1 | E2, C1 | C2> {
  const resolved = await result;
  if (isOk(resolved)) {
    return fn(resolved.value);
  }
  return resolved as Result<U, E1 | E2, C1 | C2>;
}

/**
 * Async tap - side effect on success.
 *
 * @example
 * ```typescript
 * const result = Awaitly.ok(5);
 * await tapAsync(result, async (x) => {
 *   await logToServer(x);
 * }); // ok(5)
 * ```
 */
export async function tapAsync<T, E, C>(
  result: Result<T, E, C> | AsyncResult<T, E, C>,
  fn: (value: T) => Promise<void>
): AsyncResult<T, E, C> {
  const resolved = await result;
  if (isOk(resolved)) {
    await fn(resolved.value);
  }
  return resolved;
}

/**
 * Async tapError - side effect on error.
 *
 * @example
 * ```typescript
 * const error = Awaitly.err("not found");
 * await tapErrorAsync(error, async (e) => {
 *   await logErrorToServer(e);
 * }); // err("not found")
 * ```
 */
export async function tapErrorAsync<T, E, C>(
  result: Result<T, E, C> | AsyncResult<T, E, C>,
  fn: (error: E) => Promise<void>
): AsyncResult<T, E, C> {
  const resolved = await result;
  if (isErr(resolved)) {
    await fn(resolved.error);
  }
  return resolved;
}

// =============================================================================
// Collection Utilities (Result-aware)
// =============================================================================

/**
 * Combine array of Results - fails fast on first error.
 *
 * @example
 * ```typescript
 * all([ok(1), ok(2), ok(3)]); // ok([1, 2, 3])
 * all([ok(1), err("fail"), ok(3)]); // err("fail")
 * ```
 */
export function all<T, E, C>(results: Result<T, E, C>[]): Result<T[], E, C> {
  const values: T[] = [];
  for (const result of results) {
    if (isErr(result)) {
      return result as Result<T[], E, C>;
    }
    values.push(result.value);
  }
  return ok(values);
}

/**
 * Combine array of AsyncResults - parallel execution, fails fast.
 *
 * Returns immediately when any result fails, without waiting for
 * pending promises. Only returns all values if every result succeeds.
 *
 * @example
 * ```typescript
 * await allAsync([
 *   fetchUser("1"),
 *   fetchUser("2"),
 *   fetchUser("3")
 * ]); // AsyncResult<User[], "NOT_FOUND">
 * ```
 */
export async function allAsync<T, E, C>(
  results: AsyncResult<T, E, C>[]
): AsyncResult<T[], E | PromiseRejectedError, C | PromiseRejectionCause> {
  if (results.length === 0) {
    return ok([]);
  }

  const values: T[] = new Array(results.length);
  let settledCount = 0;
  let done = false;

  return new Promise((resolve) => {
    results.forEach((resultPromise, index) => {
      resultPromise.then(
        (result) => {
          if (done) return;
          if (isErr(result)) {
            done = true;
            resolve(result as Result<T[], E | PromiseRejectedError, C | PromiseRejectionCause>);
          } else {
            values[index] = result.value;
            settledCount++;
            if (settledCount === results.length) {
              done = true;
              resolve(ok(values));
            }
          }
        },
        (reason) => {
          if (done) return;
          done = true;
          resolve(
            err(
              { type: PROMISE_REJECTED, cause: reason } as PromiseRejectedError,
              { cause: { type: "PROMISE_REJECTION" as const, reason } as PromiseRejectionCause }
            )
          );
        }
      );
    });
  });
}

/**
 * Collect all results, separating successes and failures.
 *
 * @example
 * ```typescript
 * allSettled([ok(1), err("a"), ok(2), err("b")]);
 * // { ok: [1, 2], err: ["a", "b"] }
 * ```
 */
export function allSettled<T, E, C>(results: Result<T, E, C>[]): { ok: T[]; err: E[] } {
  const okValues: T[] = [];
  const errValues: E[] = [];
  for (const result of results) {
    if (isOk(result)) {
      okValues.push(result.value);
    } else {
      errValues.push(result.error);
    }
  }
  return { ok: okValues, err: errValues };
}

/**
 * Async version of allSettled.
 *
 * Handles rejected promises by treating them as errors with
 * type PROMISE_REJECTED.
 *
 * @example
 * ```typescript
 * await allSettledAsync([
 *   fetchUser("1"),
 *   fetchUser("2"),
 *   fetchUser("3")
 * ]); // { ok: [...users], err: [...errors] }
 * ```
 */
export async function allSettledAsync<T, E, C>(
  results: AsyncResult<T, E, C>[]
): Promise<{ ok: T[]; err: (E | PromiseRejectedError)[] }> {
  if (results.length === 0) {
    return { ok: [], err: [] };
  }

  type Settled = { type: "ok"; value: T } | { type: "err"; error: E | PromiseRejectedError };
  const settled: Settled[] = new Array(results.length);
  let settledCount = 0;

  return new Promise((resolve) => {
    results.forEach((resultPromise, index) => {
      resultPromise.then(
        (result) => {
          if (isOk(result)) {
            settled[index] = { type: "ok", value: result.value };
          } else {
            settled[index] = { type: "err", error: result.error };
          }
          settledCount++;
          if (settledCount === results.length) {
            const okValues: T[] = [];
            const errValues: (E | PromiseRejectedError)[] = [];
            for (const s of settled) {
              if (s.type === "ok") {
                okValues.push(s.value);
              } else {
                errValues.push(s.error);
              }
            }
            resolve({ ok: okValues, err: errValues });
          }
        },
        (reason) => {
          settled[index] = { type: "err", error: { type: PROMISE_REJECTED, cause: reason } as PromiseRejectedError };
          settledCount++;
          if (settledCount === results.length) {
            const okValues: T[] = [];
            const errValues: (E | PromiseRejectedError)[] = [];
            for (const s of settled) {
              if (s.type === "ok") {
                okValues.push(s.value);
              } else {
                errValues.push(s.error);
              }
            }
            resolve({ ok: okValues, err: errValues });
          }
        }
      );
    });
  });
}

/**
 * Return first success, or all errors if all fail.
 *
 * @example
 * ```typescript
 * any([err("a"), ok(1), err("b")]); // ok(1)
 * any([err("a"), err("b"), err("c")]); // err(["a", "b", "c"])
 * ```
 */
export function any<T, E, C>(results: Result<T, E, C>[]): Result<T, E[], C> {
  const errors: E[] = [];
  for (const result of results) {
    if (isOk(result)) {
      return result as Result<T, E[], C>;
    }
    errors.push(result.error);
  }
  return err(errors);
}

/**
 * Async version of any - returns first success immediately.
 *
 * Returns as soon as any result succeeds, without waiting for
 * pending promises. Only returns all errors if every result fails.
 *
 * @example
 * ```typescript
 * await anyAsync([
 *   fetchFromCache(key),
 *   fetchFromDb(key),
 *   fetchFromApi(key)
 * ]); // First successful result
 * ```
 */
export async function anyAsync<T, E, C>(
  results: AsyncResult<T, E, C>[]
): AsyncResult<T, (E | PromiseRejectedError)[], C | PromiseRejectionCause> {
  if (results.length === 0) {
    return err([]);
  }

  const errors: (E | PromiseRejectedError | undefined)[] = new Array(results.length);
  let settledCount = 0;
  let done = false;

  return new Promise((resolve) => {
    results.forEach((resultPromise, index) => {
      resultPromise.then(
        (result) => {
          if (done) return;
          if (isOk(result)) {
            done = true;
            resolve(result as Result<T, (E | PromiseRejectedError)[], C | PromiseRejectionCause>);
          } else {
            errors[index] = result.error;
            settledCount++;
            if (settledCount === results.length) {
              done = true;
              resolve(err(errors.filter((e): e is E | PromiseRejectedError => e !== undefined)));
            }
          }
        },
        (reason) => {
          if (done) return;
          errors[index] = { type: PROMISE_REJECTED, cause: reason } as PromiseRejectedError;
          settledCount++;
          if (settledCount === results.length) {
            done = true;
            resolve(err(errors.filter((e): e is E | PromiseRejectedError => e !== undefined)));
          }
        }
      );
    });
  });
}

/**
 * Race async results - first to complete wins.
 *
 * Handles rejected promises by converting them to err() results
 * with type PROMISE_REJECTED.
 *
 * @example
 * ```typescript
 * await race([
 *   fetchFromPrimaryServer(id),
 *   fetchFromBackupServer(id)
 * ]); // Result from whichever server responds first
 * ```
 */
export async function race<T, E, C>(
  results: AsyncResult<T, E, C>[]
): AsyncResult<T, E | PromiseRejectedError, C | PromiseRejectionCause> {
  return Promise.race(
    results.map((p) =>
      p.catch(
        (reason) =>
          err(
            { type: PROMISE_REJECTED, cause: reason } as PromiseRejectedError,
            { cause: { type: "PROMISE_REJECTION" as const, reason } as PromiseRejectionCause }
          ) as Result<T, E | PromiseRejectedError, C | PromiseRejectionCause>
      )
    )
  );
}

/**
 * Sequence an array through a Result-returning function.
 * Stops on first error.
 *
 * @example
 * ```typescript
 * const validate = (x: number): Result<number, string> =>
 *   x > 0 ? ok(x) : err("must be positive");
 *
 * traverse([1, 2, 3], validate); // ok([1, 2, 3])
 * traverse([1, -2, 3], validate); // err("must be positive")
 * ```
 */
export function traverse<T, U, E, C>(
  items: T[],
  fn: (item: T, index: number) => Result<U, E, C>
): Result<U[], E, C> {
  const results: U[] = [];
  for (let i = 0; i < items.length; i++) {
    const result = fn(items[i]!, i);
    if (isErr(result)) {
      return result as Result<U[], E, C>;
    }
    results.push(result.value);
  }
  return ok(results);
}

/**
 * Async version of traverse.
 *
 * @example
 * ```typescript
 * await traverseAsync(userIds, async (id) => fetchUser(id));
 * ```
 */
export async function traverseAsync<T, U, E, C>(
  items: T[],
  fn: (item: T, index: number) => AsyncResult<U, E, C>
): AsyncResult<U[], E, C> {
  const results: U[] = [];
  for (let i = 0; i < items.length; i++) {
    const result = await fn(items[i]!, i);
    if (isErr(result)) {
      return result as Result<U[], E, C>;
    }
    results.push(result.value);
  }
  return ok(results);
}

/**
 * Parallel traverse - executes all in parallel, fails fast.
 *
 * Returns immediately when any result fails, without waiting for
 * pending operations. Only returns all values if every result succeeds.
 *
 * @example
 * ```typescript
 * await traverseParallel(userIds, fetchUser);
 * ```
 */
export async function traverseParallel<T, U, E, C>(
  items: T[],
  fn: (item: T, index: number) => AsyncResult<U, E, C>
): AsyncResult<U[], E | PromiseRejectedError, C | PromiseRejectionCause> {
  return allAsync(items.map((item, index) => fn(item, index)));
}

// =============================================================================
// Pipeable Result Functions (R namespace)
// =============================================================================

/**
 * Curried Result combinators for use in pipe().
 *
 * @example
 * ```typescript
 * import { pipe, R } from 'awaitly/functional';
 *
 * const result = pipe(
 *   fetchUser(id),
 *   R.flatMap(user => fetchPosts(user.id)),
 *   R.map(posts => posts.filter(p => p.published)),
 *   R.tap(posts => console.log(`Found ${posts.length} posts`)),
 *   R.match({
 *     ok: posts => `Found ${posts.length} posts`,
 *     err: error => `Failed: ${error}`
 *   })
 * );
 * ```
 */
export const R = {
  /** Curried map for use in pipe() */
  map:
    <T, U, E, C>(fn: (value: T) => U) =>
    (result: Result<T, E, C>): Result<U, E, C> =>
      map(result, fn),

  /** Curried flatMap for use in pipe() */
  flatMap:
    <T, U, E1, E2, C1, C2>(fn: (value: T) => Result<U, E2, C2>) =>
    (result: Result<T, E1, C1>): Result<U, E1 | E2, C1 | C2> =>
      flatMap(result, fn),

  /** Curried bimap for use in pipe() */
  bimap:
    <T, U, E1, E2, C>(onOk: (value: T) => U, onErr: (error: E1) => E2) =>
    (result: Result<T, E1, C>): Result<U, E2, C> =>
      bimap(result, onOk, onErr),

  /** Curried mapError for use in pipe() */
  mapError:
    <T, E1, E2, C>(fn: (error: E1) => E2) =>
    (result: Result<T, E1, C>): Result<T, E2, C> =>
      mapError(result, fn),

  /** Curried tap for use in pipe() */
  tap:
    <T, E, C>(fn: (value: T) => void) =>
    (result: Result<T, E, C>): Result<T, E, C> =>
      tap(result, fn),

  /** Curried tapError for use in pipe() */
  tapError:
    <T, E, C>(fn: (error: E) => void) =>
    (result: Result<T, E, C>): Result<T, E, C> =>
      tapError(result, fn),

  /** Curried match for use in pipe() */
  match:
    <T, E, U, C>(patterns: { ok: (value: T) => U; err: (error: E, cause?: C) => U }) =>
    (result: Result<T, E, C>): U =>
      match(result, patterns),

  /** Curried recover for use in pipe() */
  recover:
    <T, E, C>(fn: (error: E) => T) =>
    (result: Result<T, E, C>): T =>
      recover(result, fn),

  /** Curried recoverWith for use in pipe() */
  recoverWith:
    <T, E1, E2, C1, C2>(fn: (error: E1) => Result<T, E2, C2>) =>
    (result: Result<T, E1, C1>): Result<T, E2, C1 | C2> =>
      recoverWith(result, fn),

  /** Curried getOrElse for use in pipe() */
  getOrElse:
    <T, E, C>(defaultValue: T) =>
    (result: Result<T, E, C>): T =>
      getOrElse(result, defaultValue),

  /** Curried getOrElseLazy for use in pipe() */
  getOrElseLazy:
    <T, E, C>(fn: () => T) =>
    (result: Result<T, E, C>): T =>
      getOrElseLazy(result, fn),
};
