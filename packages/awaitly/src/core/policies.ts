/**
 * Per-dependency policies: retry, timeout, fallback.
 *
 * Policies are value-level function wrappers declared where dependencies
 * are declared — in the deps object — so call sites stay pristine and the
 * policy is statically visible in the deps literal (the analyzer reads it
 * as fact, not inference):
 *
 * ```typescript
 * const result = await run(
 *   {
 *     getUser,
 *     charge: retry(timeout(charge, 5000), { attempts: 3 }),
 *     sendEmail: fallback(sendEmail, () => ({ queued: true })),
 *   },
 *   async (s) => {
 *     const user = await s.getUser(userId);   // call sites unchanged
 *     const payment = await s.charge(user.id);
 *     return s.sendEmail(user.id);
 *   }
 * );
 * ```
 *
 * Every policy returns a Result-returning function with exact error-union
 * math:
 * - `retry(fn, opts)` — same errors as `fn` (the last failure propagates)
 * - `timeout(fn, ms)` — errors of `fn` plus `TimeoutError`
 * - `fallback(fn, fb)` — errors of `fn` are consumed; only `fb`'s errors remain
 *
 * Plain (non-Result) functions are valid inputs: their values are
 * normalized to `ok()`, and their throws keep throwing (so they surface as
 * `UnexpectedError` at the run/workflow layer, same as unwrapped deps).
 */

import { err, ok, type AsyncResult, type Err, type ErrorOf } from "../result";
import { TimeoutError, UnexpectedError } from "../errors";
import { type Duration, toMillis } from "../duration";
import { isDepResultShaped, type DepValueOfReturn } from "./bound-steps";

type AnyFunction = (...args: never[]) => unknown;

/** Milliseconds or a Duration value. */
export type PolicyDelay = number | Duration;

const toMs = (d: PolicyDelay): number => (typeof d === "number" ? d : toMillis(d));

/** The unwrapped success value a policy resolves to for a given function. */
type PolicyValue<F extends AnyFunction> = DepValueOfReturn<ReturnType<F>>;

/** A function wrapped by a policy: same arguments, Result-returning. */
export type PolicyFn<F extends AnyFunction, E> = (
  ...args: Parameters<F>
) => AsyncResult<PolicyValue<F>, E>;

/** One observed call outcome, with Result errs kept intact (cause included). */
type Attempt =
  | { kind: "ok"; value: unknown }
  | { kind: "err"; error: unknown; result: Err<unknown, unknown> }
  | { kind: "threw"; thrown: unknown };

const attemptCall = async (fn: AnyFunction, args: readonly unknown[]): Promise<Attempt> => {
  try {
    const value = await (fn as unknown as (...a: unknown[]) => unknown)(...args);
    if (isDepResultShaped(value)) {
      return value.ok
        ? { kind: "ok", value: value.value }
        : { kind: "err", error: value.error, result: value };
    }
    return { kind: "ok", value };
  } catch (thrown) {
    return { kind: "threw", thrown };
  }
};

/** Preserve the wrapped function's name so events, diagrams, and stack traces stay readable. */
const named = <T extends (...args: never[]) => unknown>(wrapped: T, source: AnyFunction): T => {
  const name = source.name;
  if (name) {
    Object.defineProperty(wrapped, "name", { value: name, configurable: true });
  }
  return wrapped;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// =============================================================================
// retry
// =============================================================================

export interface RetryPolicyOptions {
  /** Total attempts including the first call (minimum 1). */
  attempts: number;
  /** Base delay between attempts. Default: no delay. */
  delay?: PolicyDelay;
  /** How the delay grows per attempt. Default: "fixed". */
  backoff?: "fixed" | "linear" | "exponential";
  /** Upper bound for the computed delay. */
  maxDelay?: PolicyDelay;
  /**
   * Decide whether a failure is retryable. Receives the Result error, or
   * the thrown value for plain functions. Default: retry everything.
   */
  retryIf?: (failure: unknown) => boolean;
  /** Observer invoked before each re-attempt. */
  onRetry?: (info: { attempt: number; failure: unknown }) => void;
}

/**
 * Retry a dependency. The error union is unchanged: if all attempts fail,
 * the last failure propagates exactly as it would have without the policy
 * (typed err for Result functions, throw for plain functions).
 */
export function retry<F extends AnyFunction>(
  fn: F,
  options: RetryPolicyOptions
): PolicyFn<F, ErrorOf<F>> {
  const attempts = Math.max(1, Math.trunc(options.attempts));
  const baseDelay = options.delay === undefined ? 0 : toMs(options.delay);
  const maxDelay = options.maxDelay === undefined ? Infinity : toMs(options.maxDelay);
  const backoff = options.backoff ?? "fixed";

  const delayFor = (attempt: number): number => {
    const raw =
      backoff === "exponential"
        ? baseDelay * 2 ** (attempt - 1)
        : backoff === "linear"
          ? baseDelay * attempt
          : baseDelay;
    return Math.min(raw, maxDelay);
  };

  const wrapped = async (...args: Parameters<F>) => {
    let last: Attempt = { kind: "threw", thrown: undefined };
    for (let attempt = 1; attempt <= attempts; attempt++) {
      last = await attemptCall(fn, args);
      if (last.kind === "ok") return ok(last.value);
      const failure = last.kind === "err" ? last.error : last.thrown;
      if (options.retryIf && !options.retryIf(failure)) break;
      if (attempt < attempts) {
        options.onRetry?.({ attempt, failure });
        const ms = delayFor(attempt);
        if (ms > 0) await sleep(ms);
      }
    }
    if (last.kind === "err") return last.result;
    throw last.thrown;
  };

  return named(wrapped, fn) as PolicyFn<F, ErrorOf<F>>;
}

// =============================================================================
// timeout
// =============================================================================

/**
 * Bound a dependency's execution time. On timeout, resolves to
 * `err(TimeoutError)` — adding `TimeoutError` to the error union. The
 * underlying operation is not cancelled (no AbortSignal is threaded);
 * its eventual result is discarded.
 */
export function timeout<F extends AnyFunction>(
  fn: F,
  after: PolicyDelay
): PolicyFn<F, ErrorOf<F> | TimeoutError> {
  const ms = toMs(after);
  const TIMED_OUT = Symbol("timed-out");

  const wrapped = async (...args: Parameters<F>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        attemptCall(fn, args),
        new Promise<typeof TIMED_OUT>((resolve) => {
          timer = setTimeout(() => resolve(TIMED_OUT), ms);
        }),
      ]);
      if (outcome === TIMED_OUT) {
        return err(new TimeoutError({ operation: fn.name || undefined, ms }));
      }
      if (outcome.kind === "ok") return ok(outcome.value);
      if (outcome.kind === "err") return outcome.result;
      throw outcome.thrown;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  return named(wrapped, fn) as PolicyFn<F, ErrorOf<F> | TimeoutError>;
}

// =============================================================================
// fallback
// =============================================================================

/**
 * Recover from a dependency's failure. The handler receives the failure
 * (the typed Result error, or `UnexpectedError` wrapping a throw) plus the
 * original arguments, and its result becomes the outcome. The base
 * function's errors are consumed; only the handler's errors remain in the
 * union — `fallback(fn, () => defaultValue)` has no typed errors at all.
 */
export function fallback<
  F extends AnyFunction,
  FB extends (failure: ErrorOf<F> | UnexpectedError, ...args: Parameters<F>) => unknown,
>(
  fn: F,
  onFailure: FB
): (
  ...args: Parameters<F>
) => AsyncResult<PolicyValue<F> | DepValueOfReturn<ReturnType<FB>>, ErrorOf<FB>> {
  const wrapped = async (...args: Parameters<F>) => {
    const outcome = await attemptCall(fn, args);
    if (outcome.kind === "ok") return ok(outcome.value);

    const failure =
      outcome.kind === "err" ? outcome.error : new UnexpectedError({ cause: outcome.thrown });
    const recovered = await attemptCall(onFailure, [failure, ...args]);
    if (recovered.kind === "ok") return ok(recovered.value);
    if (recovered.kind === "err") return recovered.result;
    throw recovered.thrown;
  };

  return named(wrapped, fn) as (
    ...args: Parameters<F>
  ) => AsyncResult<PolicyValue<F> | DepValueOfReturn<ReturnType<FB>>, ErrorOf<FB>>;
}
