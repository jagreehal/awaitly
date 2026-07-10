/**
 * Bound steps for the deps-first forms: run(deps, fn) and workflow({ steps }).
 *
 * Each dep key becomes a step function with the dep's own arguments that
 * unwraps the ok value and early-exits on err. Kept out of core/index.ts
 * so the core stays focused on the run/step engine.
 */

import { ok, type AsyncResult, type Result } from "../result";

type AnyFunction = (...args: never[]) => unknown;

/**
 * Success value of a dependency's return type. Result-returning deps
 * contribute their `ok` value; plain (non-Result) deps pass through as-is.
 */
type DepValueOfReturn<R> = [Extract<Awaited<R>, { ok: true }>] extends [never]
  ? Awaited<R>
  : Extract<Awaited<R>, { ok: true }> extends { value: infer V }
    ? V
    : never;

/**
 * The steps object passed to `run(deps, fn)`: each dep key becomes a step
 * function with the same arguments that resolves to the unwrapped value
 * (early-exiting the run on error).
 *
 * @example
 * ```typescript
 * const result = await run({ getUser, getOrder }, async (s) => {
 *   const user = await s.getUser(userId);   // User — unwrapped
 *   const order = await s.getOrder(user.id); // Order
 *   return { user, order };
 * });
 * ```
 */
export type BoundSteps<Deps extends Record<string, AnyFunction>> = {
  [K in keyof Deps]: (
    ...args: Parameters<Deps[K]>
  ) => Promise<DepValueOfReturn<ReturnType<Deps[K]>>>;
};

/**
 * The step-shaped callable bindSteps needs: the classic RunStep instantiated
 * for a single (id, operation) call. Both core run's stepFn and the
 * workflow's cached step satisfy this structurally.
 */
export type StepCallable = (
  id: string,
  operation: () => AsyncResult<unknown, unknown, unknown>
) => Promise<unknown>;

/**
 * Detects a Result-shaped value returned by a dependency. Stricter than
 * core's isResultLike (which also matches thenables to tell Results from
 * functions): requires a boolean `ok` plus the matching payload key, so
 * plain domain objects that happen to have an `ok` field are less likely
 * to be misread as Results.
 */
const isDepResultShaped = (
  value: unknown
): value is Result<unknown, unknown, unknown> =>
  typeof value === "object" &&
  value !== null &&
  "ok" in value &&
  typeof (value as { ok: unknown }).ok === "boolean" &&
  ((value as { ok: boolean }).ok ? "value" in value : "error" in value);

/**
 * Builds the bound-steps object for `run(deps, fn)` and workflow parity:
 * each dep key becomes `(...args) => step(key, () => deps[key](...args))`,
 * with plain return values coerced to ok() so non-Result deps work as an
 * on-ramp.
 *
 * Repeat invocations of the same dep within one execution auto-suffix the
 * step key (`getUser`, `getUser#2`, ...). This keeps loop iterations
 * distinct — critical in workflows, where the step key doubles as the
 * cache key and a bare repeat would silently return the first result.
 * Invocation order is deterministic for deterministic code, so suffixed
 * keys stay stable across durable-workflow replays.
 *
 * @internal Used by core run() and the workflow layer; not public API.
 */
export const bindSteps = <Deps extends Record<string, AnyFunction>>(
  deps: Deps,
  step: StepCallable
): BoundSteps<Deps> => {
  const steps: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const invocationCounts = new Map<string, number>();
  for (const key of Object.keys(deps)) {
    const dep = deps[key] as unknown as (...args: unknown[]) => unknown;
    // Types say deps are functions, but untyped JS callers may pass
    // metadata alongside them — skip anything that isn't callable.
    if (typeof dep !== "function") continue;
    steps[key] = (...args: unknown[]) => {
      const count = (invocationCounts.get(key) ?? 0) + 1;
      invocationCounts.set(key, count);
      const stepKey = count === 1 ? key : `${key}#${count}`;
      // eslint-disable-next-line awaitly/step-require-id -- internal binding: the dep key IS the step ID
      return step(stepKey, async () => {
        const value = await dep(...args);
        return isDepResultShaped(value) ? value : ok(value);
      });
    };
  }
  return steps as BoundSteps<Deps>;
};
