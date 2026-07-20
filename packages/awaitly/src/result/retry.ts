/**
 * Internal retry support for Result operations.
 *
 * Retry async operations with configurable backoff without the full workflow
 * engine. Not a public entry point — the public retry surface is the `retry`
 * policy exported from the root `awaitly` entry.
 */

import type { AsyncResult } from "./index";
import { ok, err, tryAsync } from "./index";
import type { RetryOptions } from "../core";
import { UnexpectedError } from "../errors";

/** Object-style config for async edge wrapping with optional retry. */
export type TryAsyncBoundaryConfig<T, E> = {
  /** Async operation to execute (may throw/reject). */
  try: () => Promise<T>;
  /** Maps thrown/rejected causes into typed domain errors. */
  catch: (cause: unknown) => E;
  /** Optional retry policy; when omitted, no retries are performed. */
  retry?: RetryOptions<E>;
};

const computeDelay = (
  attempt: number,
  initialDelay: number,
  backoff: NonNullable<RetryOptions["backoff"]>
): number => {
  switch (backoff) {
    case "linear":
      return initialDelay * attempt;
    case "exponential":
      return initialDelay * 2 ** (attempt - 1);
    case "fixed":
    default:
      return initialDelay;
  }
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wraps an async function that might throw into an AsyncResult, with retry support.
 *
 * @remarks When to use: Wrap async work with retry logic for transient failures without needing the full workflow engine.
 *
 * @example
 * ```typescript
 * const result = await tryAsyncRetry(
 *   () => fetch('/api/data').then(r => r.json()),
 *   (cause) => ({ type: 'FETCH_FAILED' as const, cause }),
 *   { retry: { attempts: 3, initialDelay: 100, backoff: 'exponential' } }
 * );
 * ```
 */
export function tryAsyncRetry<T>(
  fn: () => Promise<T>,
  config: { retry: RetryOptions<unknown> }
): AsyncResult<T, unknown>;
export function tryAsyncRetry<T, E>(
  fn: () => Promise<T>,
  onError: (cause: unknown) => E,
  config: { retry: RetryOptions<E> }
): AsyncResult<T, E>;
export async function tryAsyncRetry<T, E>(
  fn: () => Promise<T>,
  onErrorOrConfig: ((cause: unknown) => E) | { retry: RetryOptions<unknown> },
  maybeConfig?: { retry: RetryOptions<E> }
): AsyncResult<T, E | unknown> {
  const onError =
    typeof onErrorOrConfig === "function" ? onErrorOrConfig : undefined;
  const config =
    typeof onErrorOrConfig === "function" ? maybeConfig! : onErrorOrConfig;
  const retry = config.retry;
  const attempts = Math.max(1, retry.attempts);
  const initialDelay = retry.initialDelay ?? 100;
  const backoff = retry.backoff ?? "exponential";
  const shouldRetryFn = retry.shouldRetry ?? (() => true);

  const execute = async (): AsyncResult<T, E | unknown> => {
    try {
      return ok(await fn());
    } catch (cause) {
      return onError ? err(onError(cause), { cause }) : err(cause);
    }
  };

  let result = await execute();
  for (let attempt = 1; attempt < attempts; attempt++) {
    if (result.ok) return result;
    if (!shouldRetryFn(result.error as E, attempt)) return result;
    await sleep(computeDelay(attempt, initialDelay, backoff));
    result = await execute();
  }
  return result;
}

/**
 * Object-style boundary wrapper for async vendor edges.
 *
 * Keeps async/await ergonomics while centralizing error classification and
 * retry policy in one place.
 *
 * @example
 * ```typescript
 * const result = await tryAsyncBoundary({
 *   try: () => paymentProvider.authorize(card, total),
 *   catch: (cause) =>
 *     isTimeout(cause)
 *       ? new PaymentLimbo({ attemptId, cause })
 *       : new TransientVendorError({ vendor: "stripe", cause }),
 *   retry: {
 *     attempts: 3,
 *     initialDelay: 100,
 *     shouldRetry: (e) => e instanceof TransientVendorError,
 *   },
 * });
 * ```
 */
export function tryAsyncBoundary<T, E>(
  config: TryAsyncBoundaryConfig<T, E>
): AsyncResult<T, E>;
export function tryAsyncBoundary<T>(
  config: {
    try: () => Promise<T>;
    retry?: RetryOptions<UnexpectedError>;
  }
): AsyncResult<T, UnexpectedError>;
export function tryAsyncBoundary<T, E>(
  config:
    | { try: () => Promise<T>; retry?: RetryOptions<UnexpectedError> }
    | TryAsyncBoundaryConfig<T, E>
): AsyncResult<T, E | UnexpectedError> {
  if ("catch" in config && typeof config.catch === "function") {
    if (!config.retry) {
      return tryAsync(config.try, config.catch);
    }
    return tryAsyncRetry(config.try, config.catch, { retry: config.retry });
  }

  const onUnexpected = (cause: unknown) => new UnexpectedError({ cause });
  if (!config.retry) {
    return tryAsync(config.try, onUnexpected);
  }
  return tryAsyncRetry(config.try, onUnexpected, {
    retry: config.retry as RetryOptions<UnexpectedError>,
  });
}
