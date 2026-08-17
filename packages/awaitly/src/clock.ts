/**
 * Time as a value: read `now()` and `sleep()` through a `Clock` so retry,
 * timeout, and sleep can be driven by `createTestClock` in tests.
 *
 * Production code uses {@link systemClock}. Tests pass a test clock into
 * `run`, `createWorkflow`, `retry`, `timeout`, or `createCircuitBreaker`.
 * Policy wrappers do not pick up `run({ clock })` automatically — pass
 * `clock` at wrap time, or use `step.retry` / `step.sleep` / `step.withTimeout`
 * inside a run that has `clock`.
 */

/**
 * Source of wall time and delays for control-flow waits.
 *
 * `sleep` **resolves** when the duration elapses or when `signal` aborts.
 * It never rejects. Callers that treat abort as failure (`step.sleep`)
 * throw after it returns if the signal is aborted.
 */
export interface Clock {
  /** Current Unix time in milliseconds. */
  now(): number;
  /**
   * Wait `ms` milliseconds, or until `signal` aborts.
   * `ms <= 0` and an already-aborted signal resolve immediately.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

const resolveOnAbort = (
  ms: number,
  signal: AbortSignal | undefined,
  schedule: (resolve: () => void) => { cancel: () => void }
): Promise<void> => {
  if (signal?.aborted || ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const state: { onAbort?: () => void } = {};
    const { cancel } = schedule(() => {
      if (state.onAbort) signal?.removeEventListener("abort", state.onAbort);
      resolve();
    });
    state.onAbort = () => {
      cancel();
      resolve();
    };
    signal?.addEventListener("abort", state.onAbort, { once: true });
  });
};

/**
 * Real wall clock. `now()` is `Date.now()`; `sleep` is `setTimeout`.
 */
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    return resolveOnAbort(ms, signal, (resolve) => {
      const id = setTimeout(resolve, ms);
      return { cancel: () => clearTimeout(id) };
    });
  },
};
