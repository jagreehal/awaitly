/**
 * awaitly/flow
 *
 * The closest thing to `Effect.gen(function* () { ... })` that stays in plain
 * `async/await`. You pass a deps object up front; every method becomes a
 * step automatically — the step ID is the deps-object key. The workflow body
 * calls deps directly:
 *
 * ```typescript
 * import { flow } from 'awaitly/flow';
 *
 * const result = await flow({ getUser, createOrder }, async (d) => {
 *   const user = await d.getUser(userId);          // → step('getUser', () => getUser(userId))
 *   const order = await d.createOrder(user);       // → step('createOrder', () => createOrder(user))
 *   return order;
 * });
 * ```
 *
 * ## Per-call escape hatch (`c`)
 *
 * The body accepts an optional second argument — the flow context — for the
 * two cases the unwrapped form can't express:
 *
 * ```typescript
 * await flow({ getUser, getPosts }, async (d, c) => {
 *   // Custom step id (overrides the auto-id 'getUser'):
 *   const u = await c.key('user:1', () => c.raw.getUser('1'));
 *
 *   // Parallel execution with named results:
 *   const { posts, profile } = await c.all('fetchUserData', {
 *     posts: () => c.raw.getPosts(u.id),
 *     profile: () => c.raw.getProfile(u.id),
 *   });
 * });
 * ```
 *
 * `c.raw` is the original deps object (functions still return `Result`); pass
 * it to `c.key` / `c.all` so the engine sees a single step boundary.
 *
 * ## Trade-offs vs. `run()`
 *
 * - **No per-call retry/timeout/cache.** Those still live in `run()` + the
 *   `step.*` helpers. Use `run()` directly when you need them.
 * - **Loosely typed events.** `onEvent` exposes `WorkflowEvent<unknown>`. Use
 *   `run()` if you need fully typed event payloads.
 *
 * ## Gains
 *
 * - The workflow body reads like ordinary `async/await` code — the step
 *   boundary is implicit and ids are property names.
 * - Errors are inferred from the deps shape; `UnexpectedError` is included
 *   unless `catchUnexpected` is set.
 * - Non-function values on the deps object pass through untouched, so you
 *   can attach constants or helper objects alongside the dep functions.
 */
import {
  type AsyncResult,
  type Result,
  type UnexpectedError,
  type WorkflowEvent,
  runInternal,
} from "./core";

// `any[]` is the pragmatic choice for a low-level wrapper that has to accept
// arbitrary user-supplied function signatures. The public surface (`Flowed`,
// `FlowErrors`) constrains via this in the conditional-type branch; runtime
// is verified by tests in `flow.test.ts`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => unknown;

// `ErrorOfResult` is split out so it distributes over the `Ok | Err` union
// that Result returns. Without this, the conditional sees the whole union at
// once, fails the `{ ok: false }` check on the `Ok` branch, and collapses to
// `never` — silently erasing FlowErrors<D>.
type ErrorOfResult<R> = R extends { ok: false; error: infer E } ? E : never;

type ErrorOfFn<F> = F extends AnyFunction
  ? ErrorOfResult<Awaited<ReturnType<F>>>
  : never;

/** Loose record: function values get stepified, anything else passes through. */
type DepsRecord = Record<string, unknown>;

/**
 * The deps object as seen from inside the flow body. Function deps that
 * return `AsyncResult<T, E>` (or `Result<T, E>`) become `(...args) =>
 * Promise<T>` — the unwrapped success value, with the Err short-circuiting
 * the flow. Non-function entries are kept as-is.
 */
export type Flowed<D extends DepsRecord> = {
  [K in keyof D]: D[K] extends (...args: infer Args) => infer R
    ? R extends Promise<{ ok: true; value: infer V } | { ok: false; error: unknown }>
      ? (...args: Args) => Promise<V>
      : R extends { ok: true; value: infer V } | { ok: false; error: unknown }
        ? (...args: Args) => Promise<V>
        : D[K]
    : D[K];
};

/** Union of error types from any function-valued keys on `D`. */
export type FlowErrors<D extends DepsRecord> = {
  [K in keyof D]: ErrorOfFn<D[K]>;
}[keyof D];

/**
 * Per-call escape hatch passed to the flow body as the optional second
 * argument. Use these when the implicit auto-step form can't express what
 * you need (custom step id, parallel execution).
 *
 * Inside `key` / `all` callbacks, call deps through `c.raw` (the original
 * Result-returning deps) so the engine sees a single step boundary. Calling
 * the wrapped form (`d.*`) from within a `key` / `all` callback would
 * produce a nested auto-step and is not the intended use.
 */
export interface FlowContext<D extends DepsRecord> {
  /**
   * The original deps object — functions still return `Result` / `AsyncResult`.
   * Pass calls to these into `c.key` / `c.all`; pass `d.*` for the default
   * unwrapped/auto-stepped path.
   */
  raw: D;

  /**
   * Run a Result-returning op with a custom step id. The id replaces the
   * deps-object key for tracing, caching, and replay — useful when the same
   * dep is called multiple times in one flow.
   *
   * The callback's error type is constrained to `FlowErrors<D>` so it
   * composes with the flow's inferred error union.
   */
  key: <T, E extends FlowErrors<D>>(
    id: string,
    fn: () => Result<T, E> | AsyncResult<T, E>
  ) => Promise<T>;

  /**
   * Execute a set of Result-returning ops in parallel under a single named
   * scope (mirrors `step.all`'s object form). Returns the unwrapped values
   * keyed by the same names.
   */
  all: <
    TOps extends Record<
      string,
      () =>
        | Result<unknown, FlowErrors<D>>
        | AsyncResult<unknown, FlowErrors<D>>
    >
  >(
    name: string,
    operations: TOps
  ) => Promise<{
    [K in keyof TOps]: TOps[K] extends () =>
      | Result<infer V, FlowErrors<D>>
      | AsyncResult<infer V, FlowErrors<D>>
      ? V
      : never;
  }>;
}

/**
 * Options for a single `flow()` call.
 *
 * `onEvent` is typed as `WorkflowEvent<unknown>` deliberately — keeps this
 * surface small. If you need typed event payloads, use `run()`.
 */
export interface FlowOptions<U = UnexpectedError> {
  /**
   * Replace `UnexpectedError` with a custom type at the boundary. Any
   * exception escaping a dep is mapped through this fn; the flow's error
   * type becomes `FlowErrors<deps> | U` instead of
   * `FlowErrors<deps> | UnexpectedError`.
   */
  catchUnexpected?: (cause: unknown) => U;

  /**
   * Step lifecycle events (start/success/error/aborted). The deps-object key
   * is the step id emitted here — handy for tracing.
   */
  onEvent?: (event: WorkflowEvent<unknown>) => void;
}

// Internal: the shape we hand to the engine's step API once we've erased the
// per-dep return type. Tests cover the runtime contract.
type ResultLike = { ok: true; value: unknown } | { ok: false; error: unknown };

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasMalformedErrBranch = (value: unknown): value is { ok: false } =>
  isObjectRecord(value) && value.ok === false && !("error" in value);

type InternalStep = (
  id: string,
  op: () => ResultLike | Promise<ResultLike>
) => Promise<unknown>;

/**
 * Run a flow over a deps object. Each function dep call becomes a step using
 * the property name as the step id; non-function deps pass through.
 *
 * @param deps - Result-returning functions (plus optional non-fn values) keyed by step id
 * @param body - Workflow body; receives the wrapped deps
 * @param options - Optional flow-level options
 */
export function flow<D extends DepsRecord, T>(
  deps: D,
  body: (d: Flowed<D>, c: FlowContext<D>) => Promise<T> | T
): Promise<Result<T, FlowErrors<D> | UnexpectedError>>;
export function flow<D extends DepsRecord, T, U>(
  deps: D,
  body: (d: Flowed<D>, c: FlowContext<D>) => Promise<T> | T,
  options: FlowOptions<U> & { catchUnexpected: (cause: unknown) => U }
): Promise<Result<T, FlowErrors<D> | U>>;
export function flow<D extends DepsRecord, T, U = UnexpectedError>(
  deps: D,
  body: (d: Flowed<D>, c: FlowContext<D>) => Promise<T> | T,
  options?: FlowOptions<U>
): Promise<Result<T, FlowErrors<D> | UnexpectedError | U>> {
  return runInternal<T, FlowErrors<D>, U>(
    async ({ step }) => {
      const stepFn = step as unknown as InternalStep;
      const stepWithAll = step as unknown as InternalStep & {
        all: (
          name: string,
          ops: Record<string, () => ResultLike | Promise<ResultLike>>
        ) => Promise<Record<string, unknown>>;
      };
      const wrapped: Record<string, unknown> = {};
      for (const key of Object.keys(deps)) {
        const value = deps[key];
        if (typeof value === "function") {
          const fn = value as (
            ...args: unknown[]
          ) => ResultLike | Promise<ResultLike>;
          wrapped[key] = (...args: unknown[]) =>
            stepFn(key, async () => {
              const result = await Reflect.apply(fn, deps, args);
              if (hasMalformedErrBranch(result)) {
                throw new TypeError(
                  `flow(${key}) expected Err to include an error field`
                );
              }
              return result;
            });
        } else {
          wrapped[key] = value;
        }
      }
      const context: FlowContext<D> = {
        raw: deps,
        key: ((id, fn) =>
          stepFn(
            id,
            fn as () => ResultLike | Promise<ResultLike>
          )) as FlowContext<D>["key"],
        all: ((name, ops) =>
          stepWithAll.all(
            name,
            ops as Record<string, () => ResultLike | Promise<ResultLike>>
          )) as FlowContext<D>["all"],
      };
      return body(wrapped as Flowed<D>, context);
    },
    {
      catchUnexpected: options?.catchUnexpected,
      onEvent: options?.onEvent,
    }
  );
}
