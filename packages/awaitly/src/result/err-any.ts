import type { Err } from "./index";

/**
 * @internal Unconstrained `err` for library code that forwards an already-typed
 * `E` (generic plumbing, `unknown` causes). Lives outside `result/index.ts` so
 * the `awaitly/result` entry does not export it.
 */
export function errAny<E, C = unknown>(error: E, options?: { cause?: C }): Err<E, C> {
  const cause = options?.cause;
  return { ok: false as const, error, ...(cause !== undefined ? { cause } : {}) } as Err<E, C>;
}
