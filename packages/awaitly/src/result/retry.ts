/**
 * awaitly/result retry support
 *
 * Retry async operations with configurable backoff without the full workflow engine.
 */

import type { AsyncResult } from "./index";
import { ok, err } from "./index";

/** Configuration for retry behavior */
export type RetryConfig<E = unknown> = {
  /** Number of retry attempts (not including the initial attempt) */
  times: number;
  /** Base delay between retries in milliseconds */
  delayMs: number;
  /** Backoff strategy */
  backoff?: "constant" | "linear" | "exponential";
  /** Predicate to determine if an error should trigger a retry. Defaults to always retry. */
  shouldRetry?: (error: E) => boolean;
};

/**
 * Wraps an async function that might throw into an AsyncResult, with retry support.
 *
 * @remarks When to use: Wrap async work with retry logic for transient failures without needing the full workflow engine.
 *
 * @example
 * ```typescript
 * const result = await tryAsyncRetry(
 *   () => fetch('/api/data').then(r => r.json()),
 *   { retry: { times: 3, delayMs: 100, backoff: 'exponential' } }
 * );
 * ```
 */
export function tryAsyncRetry<T>(
  fn: () => Promise<T>,
  config: { retry: RetryConfig<unknown> }
): AsyncResult<T, unknown>;
export function tryAsyncRetry<T, E>(
  fn: () => Promise<T>,
  onError: (cause: unknown) => E,
  config: { retry: RetryConfig<E> }
): AsyncResult<T, E>;
export async function tryAsyncRetry<T, E>(
  fn: () => Promise<T>,
  onErrorOrConfig: ((cause: unknown) => E) | { retry: RetryConfig<unknown> },
  maybeConfig?: { retry: RetryConfig<E> }
): AsyncResult<T, E | unknown> {
  const onError = typeof onErrorOrConfig === "function" ? onErrorOrConfig : undefined;
  const config = typeof onErrorOrConfig === "function" ? maybeConfig! : onErrorOrConfig;
  const retry = config.retry;

  const getDelay = (attempt: number): number => {
    switch (retry.backoff) {
      case "linear":
        return retry.delayMs * (attempt + 1);
      case "exponential":
        return retry.delayMs * 2 ** attempt;
      case "constant":
      default:
        return retry.delayMs;
    }
  };

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const execute = async (): AsyncResult<T, E | unknown> => {
    try {
      return ok(await fn());
    } catch (cause) {
      return onError ? err(onError(cause), { cause }) : err(cause);
    }
  };

  let result = await execute();
  const shouldRetryFn = retry.shouldRetry ?? (() => true);

  for (let attempt = 0; attempt < retry.times; attempt++) {
    if (result.ok) break;
    if (!shouldRetryFn(result.error as E)) break;
    await sleep(getDelay(attempt));
    result = await execute();
  }

  return result;
}
