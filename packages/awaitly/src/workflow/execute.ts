/**
 * createWorkflow implementation and workflow execution logic.
 */

import {
  run,
  ok,
  err,
  createEarlyExit,
  isEarlyExit,
  isUnexpectedError,
  defaultCatchUnexpected,
  type EarlyExit,
  type StepFailureMeta,
  type Result,
  type AsyncResult,
  type UnexpectedError,
  type RunStep,
  type WorkflowEvent,
  type StepOptions,
  type RetryOptions,
  type TimeoutOptions,
  type StreamWritableOptions,
  type StreamReadableOptions,
  type StreamForEachStepOptions,
  type StreamForEachResultType,
  type StreamWriterInterface,
  type StreamReaderInterface,
} from "../core";

import type {
  StreamStore,
  StreamItem,
  StreamWriter,
  StreamReader,
  StreamWriteError,
  StreamCloseError,
  StreamReadError,
  StreamEndedMarker,
} from "../streaming/types";

import {
  streamWriteError,
  streamReadError,
  streamCloseError,
  streamEnded,
} from "../streaming/types";

import {
  createBackpressureController,
  type BackpressureController,
} from "../streaming/backpressure";

import { parse as parseDuration, toMillis, type Duration as DurationType } from "../duration";

import type {
  StepCache,
  ResumeState,
  AnyResultFn,
  ErrorsOfDeps,
  WorkflowOptions,
  WorkflowContext,
  WorkflowFn,
  RunConfig,
  Workflow,
  WorkflowCancelledError,
} from "./types";

import { createResumeStateCollector } from "./resume-state";

import {
  encodeCachedError,
  decodeCachedMeta,
} from "./cache-encoding";

import { isWorkflowCancelled } from "./guards";

import type {
  JSONValue,
  WorkflowSnapshot,
} from "../persistence";

import {
  deserializeCauseNew,
  SnapshotDecodeError,
} from "../persistence";
// =============================================================================
// createWorkflow - Automatic Error Type Inference
// =============================================================================

/**
 * Create a typed workflow with automatic error inference.
 *
 * ## When to Use `createWorkflow`
 *
 * Use `createWorkflow` when you have:
 * - **Multiple dependent async operations** that need to run sequentially
 * - **Complex error handling** where you want type-safe error unions
 * - **Need for observability** via event streams (onEvent)
 * - **Step caching** requirements for expensive operations
 * - **Resume/replay** capabilities for long-running workflows
 * - **Human-in-the-loop** workflows requiring approvals
 *
 * ## Why Use `createWorkflow` Instead of `run()`
 *
 * 1. **Automatic Error Type Inference**: Errors are computed from your declared functions
 *    - No manual error union management
 *    - TypeScript ensures all possible errors are handled
 *    - Refactoring is safer - adding/removing functions updates error types automatically
 *
 * 2. **Step Caching**: Expensive operations can be cached by key
 *    - Prevents duplicate API calls
 *    - Useful for idempotent operations
 *    - Supports resume state for workflow replay
 *
 * 3. **Event Stream**: Built-in observability via `onEvent`
 *    - Track workflow and step lifecycle
 *    - Monitor performance (durationMs)
 *    - Build dashboards and debugging tools
 *
 * 4. **Resume State**: Save and replay workflows
 *    - Useful for long-running processes
 *    - Supports human-in-the-loop workflows
 *    - Enables workflow persistence across restarts
 *
 * ## How It Works
 *
 * 1. **Declare Dependencies**: Pass an object of Result-returning functions
 * 2. **Automatic Inference**: Error types are extracted from function return types
 * 3. **Execute Workflow**: Call the returned workflow function with your logic
 * 4. **Early Exit**: `step()` unwraps Results - on error, workflow exits immediately
 *
 * ## Error Type Inference
 *
 * The error union is automatically computed from all declared functions:
 * - Each function's error type is extracted
 * - Union of all errors is created
 * - Uncaught exceptions are mapped via `catchUnexpected` (default: legacy `UnexpectedError` shape).
 *
 * ## Strict Mode
 *
 * Optional `catchUnexpected` maps uncaught exceptions to a typed error (closed union):
 * - When omitted, the default mapper returns the legacy `UnexpectedError` object.
 * - When provided, your error union is exactly `E | U`.
 *
 * @param deps - Object mapping names to Result-returning functions.
 *               These functions must return `Result<T, E>` or `Promise<Result<T, E>>`.
 *               The error types (`E`) from all functions are automatically combined into a union.
 * @param options - Optional configuration:
 *   - `onEvent`: Callback for workflow/step lifecycle events
 *   - `onError`: Callback for error logging/debugging
 *   - `cache`: Step result cache (Map or custom StepCache implementation)
 *   - `resumeState`: Pre-populated step results for workflow replay
 *   - `createContext`: Factory for per-run context (passed to onEvent)
 *   - `catchUnexpected`: Optional; map uncaught exceptions to a typed error (default: legacy `UnexpectedError`)
 *
 * @returns A workflow function that accepts your workflow logic and returns an AsyncResult.
 *          The error type is automatically inferred from the `deps` parameter.
 *
 * @example
 * ```typescript
 * // Basic usage - automatic error inference
 * const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
 *   id === '1' ? ok({ id, name: 'Alice' }) : err('NOT_FOUND');
 *
 * const fetchPosts = async (userId: string): AsyncResult<Post[], 'FETCH_ERROR'> =>
 *   ok([{ id: 1, title: 'Hello' }]);
 *
 * const getPosts = createWorkflow({ fetchUser, fetchPosts });
 *
 * const result = await getPosts(async ({ step }) => {
 *   const user = await step(fetchUser('1'));
 *   const posts = await step(fetchPosts(user.id));
 *   return { user, posts };
 * });
 * // result.error: 'NOT_FOUND' | 'FETCH_ERROR' | UnexpectedError
 * ```
 *
 * @example
 * ```typescript
 * // With destructured deps in callback
 * const result = await getPosts(async ({ step, deps: { fetchUser, fetchPosts } }) => {
 *   const user = await step(fetchUser('1'));
 *   const posts = await step(fetchPosts(user.id));
 *   return { user, posts };
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Strict mode - closed error union (no UnexpectedError)
 * const getPosts = createWorkflow(
 *   { fetchUser, fetchPosts },
 *   {
 *     catchUnexpected: () => 'UNEXPECTED' as const
 *   }
 * );
 * // result.error: 'NOT_FOUND' | 'FETCH_ERROR' | 'UNEXPECTED'
 * ```
 *
 * @example
 * ```typescript
 * // With step caching - both patterns work identically
 * const cache = new Map<string, Result<unknown, unknown>>();
 * const workflow = createWorkflow({ fetchUser }, { cache });
 *
 * const result = await workflow(async ({ step }) => {
 *   // Function-wrapped pattern with key - cached and emits step_complete
 *   const user1 = await step(() => fetchUser('1'), { key: 'user:1' });
 *
 *   // Direct AsyncResult pattern with key - also cached and emits step_complete
 *   const user2 = await step(fetchUser('1'), { key: 'user:2' });
 *
 *   // Same key uses cache (fetchUser not called again)
 *   const user3 = await step(() => fetchUser('1'), { key: 'user:1' });
 *   return { user1, user2, user3 }; // user1 === user3 (from cache)
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With event stream for observability
 * const workflow = createWorkflow({ fetchUser }, {
 *   onEvent: (event) => {
 *     if (event.type === 'step_start') {
 *       console.log(`Step ${event.name} started`);
 *     }
 *     if (event.type === 'step_success') {
 *       console.log(`Step ${event.name} completed in ${event.durationMs}ms`);
 *     }
 *   }
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With resume state for workflow replay
 * const savedState = { steps: new Map([['user:1', { result: ok({ id: '1', name: 'Alice' }) }]]) };
 * const workflow = createWorkflow({ fetchUser }, { resumeState: savedState });
 *
 * const result = await workflow(async ({ step }) => {
 *   // This step uses cached result from savedState (fetchUser not called)
 *   const user = await step(() => fetchUser('1'), { key: 'user:1' });
 *   return user;
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With typed arguments (new API)
 * const workflow = createWorkflow({ fetchUser, fetchPosts });
 *
 * const result = await workflow(
 *   { userId: '1' }, // Typed arguments
 *   async ({ step, deps: { fetchUser, fetchPosts }, args: { userId } }) => {
 *     const user = await step(fetchUser(userId));
 *     const posts = await step(fetchPosts(user.id));
 *     return { user, posts };
 *   }
 * );
 * ```
 */
// Overload: no deps (single argument); callback receives deps: unknown
export function createWorkflow<
  U = UnexpectedError,
  C = void
>(
  workflowName: string
): Workflow<never, U, unknown, C>;

// Overload: with deps
export function createWorkflow<
  const Deps extends Readonly<Record<string, AnyResultFn>>,
  U = UnexpectedError,
  C = void
>(
  workflowName: string,
  deps: Deps,
  options?: WorkflowOptions<ErrorsOfDeps<Deps>, U, C>
): Workflow<ErrorsOfDeps<Deps>, U, Deps, C>;

// Implementation (deps optional for 1-arg overload compatibility)
export function createWorkflow<
  const Deps extends Readonly<Record<string, AnyResultFn>>,
  U = UnexpectedError,
  C = void
>(
  workflowName: string,
  deps?: Deps,
  options?: WorkflowOptions<ErrorsOfDeps<Deps>, U, C>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  type E = ErrorsOfDeps<Deps>;

  if (typeof workflowName !== "string" || workflowName.length === 0) {
    throw new TypeError(
      "createWorkflow(workflowName, deps, options?): first argument must be a non-empty string. Example: createWorkflow('checkout', { chargeCard, sendEmail })"
    );
  }

  const depsActual = deps ?? ({} as Deps);
  const optionsActual = options;

  // ===========================================================================

  // ===========================================================================
  // Internal execute function - core workflow execution logic
  // ===========================================================================
  async function internalExecute<T>(
    runName: string | undefined,
    userFn: WorkflowFn<T, E, Deps, C>,
    config?: RunConfig<E, U, C, Deps>
  ): Promise<Result<T, E | U, unknown>> {
    // Generate workflowId for this run
    const workflowId = runName ?? crypto.randomUUID();

    // Merge deps: config.deps partially overrides creation-time deps
    const effectiveDeps = config?.deps ? { ...depsActual, ...config.deps } as Deps : depsActual;

    // ===========================================================================
    // Resolve hooks: config?.x ?? options?.x (run-time overrides creation-time)
    // Note: config.x = undefined does NOT override (uses creation-time)
    //       config.x = null DOES override (users asked for it)
    // ===========================================================================

    // Create context for this run (config overrides options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createContextFn = config?.createContext ?? (optionsActual as any)?.createContext;
    const context = createContextFn ? await createContextFn() : undefined as C;

    // Get workflow-level signal (config overrides options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workflowSignal = (config?.signal ?? (optionsActual as any)?.signal) as AbortSignal | undefined;

    // Get event handler (config overrides options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onEventHandler = config?.onEvent ?? (optionsActual as any)?.onEvent;

    // Get error handler (config overrides options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onErrorHandler = config?.onError ?? (optionsActual as any)?.onError;

    // Get shouldRun hook (config overrides options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shouldRunHook = (config?.shouldRun ?? (optionsActual as any)?.shouldRun) as
      | ((workflowId: string, context: C) => boolean | Promise<boolean>)
      | undefined;

    // Get onBeforeStart hook (config overrides options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onBeforeStartHook = (config?.onBeforeStart ?? (optionsActual as any)?.onBeforeStart) as
      | ((workflowId: string, context: C) => boolean | Promise<boolean>)
      | undefined;

    // Get onAfterStep hook (config overrides options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onAfterStepHook = (config?.onAfterStep ?? (optionsActual as any)?.onAfterStep) as
      | ((
          stepKey: string,
          result: Result<unknown, unknown, unknown>,
          workflowId: string,
          context: C
        ) => void | Promise<void>)
      | undefined;

    // Get resumeState (config overrides options) - keep lazy, only evaluate when needed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resumeStateOption = (config?.resumeState ?? (optionsActual as any)?.resumeState) as
      | ResumeState
      | (() => ResumeState | Promise<ResumeState>)
      | undefined;

    // catchUnexpected: from creation-time options or default (legacy UnexpectedError shape).
    // When omitted, U = UnexpectedError and we use defaultCatchUnexpected.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const catchUnexpected = (optionsActual as any)?.catchUnexpected ?? defaultCatchUnexpected;

    // Create workflow data store for step outputs
    const workflowData: Record<string, unknown> = {};

    // Check if dev warnings are enabled (config overrides options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const devWarnings = (config?.devWarnings ?? (optionsActual as any)?.devWarnings) === true && process.env.NODE_ENV !== 'production';
    const ctxSetWarned = new Set<string>(); // Avoid duplicate warnings per key
    const ctxGetWarned = new Set<string>();

    // Create workflow context object to pass to callback
    const workflowContext: WorkflowContext<C> = {
      workflowId,
      onEvent: onEventHandler as ((event: WorkflowEvent<unknown, C>) => void) | undefined,
      context: context !== undefined ? context : undefined,
      signal: workflowSignal,
      // Data store for static analysis
      input: {} as Record<string, unknown>,
      ref: <K extends string>(key: K) => workflowData[key] as never,
      set: <K extends string>(key: K, value: unknown) => {
        if (devWarnings && !ctxSetWarned.has(key)) {
          ctxSetWarned.add(key);
          console.warn(
            `awaitly: ctx.set('${key}', ...) is deprecated for static analysis. ` +
            `Use step('id', fn, { out: '${key}' }) instead.`
          );
        }
        workflowData[key] = value;
      },
      get: <K extends string>(key: K) => {
        if (devWarnings && !ctxGetWarned.has(key)) {
          ctxGetWarned.add(key);
          console.warn(
            `awaitly: ctx.get('${key}') is deprecated for static analysis. ` +
            `Use ctx.ref('${key}') instead for tracked dependencies.`
          );
        }
        return workflowData[key] as never;
      },
    };

    // Helper to emit workflow events
    const emitEvent = (event: WorkflowEvent<E | U, C>) => {
      // Add context to event only if:
      // 1. Event doesn't already have context (preserves replayed events or per-step overrides)
      // 2. Workflow actually has a context (don't add context: undefined property)
      const eventWithContext =
        event.context !== undefined || context === undefined
          ? event
          : ({ ...event, context: context as C } as WorkflowEvent<E | U, C>);
      const eventWithName =
        eventWithContext.workflowName === undefined
          ? ({ ...eventWithContext, workflowName } as WorkflowEvent<E | U, C>)
          : eventWithContext;
      onEventHandler?.(eventWithName, context);
    };

    // Helper to create cancellation result (always map through catchUnexpected)
    const createCancelledResult = (reason?: string, lastStepKey?: string): Result<T, E | U, unknown> => {
      const cancelledError: WorkflowCancelledError = {
        type: "WORKFLOW_CANCELLED",
        reason,
        lastStepKey,
      };
      return err(catchUnexpected(cancelledError), { cause: cancelledError }) as Result<T, E | U, unknown>;
    };

    // Check if signal is already aborted before starting
    if (workflowSignal?.aborted) {
      const reason = typeof workflowSignal.reason === "string"
        ? workflowSignal.reason
        : workflowSignal.reason instanceof Error
          ? workflowSignal.reason.message
          : undefined;
      emitEvent({
        type: "workflow_cancelled",
        workflowId,
        ts: Date.now(),
        durationMs: 0,
        reason,
      });
      return createCancelledResult(reason);
    }

    if (shouldRunHook) {
      const hookStartTime = performance.now();
      try {
        const shouldRunResult = await shouldRunHook(workflowId, context);
        const hookDuration = performance.now() - hookStartTime;
        // Emit hook event
        emitEvent({
          type: "hook_should_run",
          workflowId,
          ts: Date.now(),
          durationMs: hookDuration,
          result: shouldRunResult,
          skipped: !shouldRunResult,
        });
        if (!shouldRunResult) {
          const skipCause = new Error("Workflow skipped by shouldRun hook");
          return err(catchUnexpected(skipCause), { cause: skipCause }) as Result<T, E | U, unknown>;
        }
      } catch (thrown) {
        const hookDuration = performance.now() - hookStartTime;
        // Emit hook error event
        emitEvent({
          type: "hook_should_run_error",
          workflowId,
          ts: Date.now(),
          durationMs: hookDuration,
          error: thrown as E,
        });
        // Hook threw - map through catchUnexpected
        return err(catchUnexpected(thrown), { cause: thrown }) as Result<T, E | U, unknown>;
      }
    }

    if (onBeforeStartHook) {
      const hookStartTime = performance.now();
      try {
        const beforeStartResult = await onBeforeStartHook(workflowId, context);
        const hookDuration = performance.now() - hookStartTime;
        // Emit hook event
        emitEvent({
          type: "hook_before_start",
          workflowId,
          ts: Date.now(),
          durationMs: hookDuration,
          result: beforeStartResult,
          skipped: !beforeStartResult,
        });
        if (!beforeStartResult) {
          const skipCause = new Error("Workflow skipped by onBeforeStart hook");
          return err(catchUnexpected(skipCause), { cause: skipCause }) as Result<T, E | U, unknown>;
        }
      } catch (thrown) {
        const hookDuration = performance.now() - hookStartTime;
        // Emit hook error event
        emitEvent({
          type: "hook_before_start_error",
          workflowId,
          ts: Date.now(),
          durationMs: hookDuration,
          error: thrown as E,
        });
        return err(catchUnexpected(thrown), { cause: thrown }) as Result<T, E | U, unknown>;
      }
    }

    // Emit workflow_start
    const startTs = Date.now();
    const startTime = performance.now();
    emitEvent({
      type: "workflow_start",
      workflowId,
      ts: startTs,
    });

    // Get cache from config (overrides creation-time options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cache = (config?.cache ?? (optionsActual as any)?.cache) as StepCache | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streamStore = (config?.streamStore ?? (optionsActual as any)?.streamStore) as StreamStore | undefined;

    // If resumeState is provided but cache isn't, auto-create an in-memory cache
    if (resumeStateOption && !cache) {
      cache = new Map<string, Result<unknown, unknown, unknown>>();
    }

    // Pre-populate cache from resumeState (lazily evaluated)
    if (resumeStateOption && cache) {
      const resumeState =
        typeof resumeStateOption === "function"
          ? await resumeStateOption()
          : resumeStateOption;

      // Validate resumeState.steps is a Map (common mistake: JSON serialization loses Map)
      if (!(resumeState.steps instanceof Map)) {
        console.warn(
          `awaitly: resumeState.steps is not a Map (got ${typeof resumeState.steps}). ` +
            `This usually happens when state is serialized with JSON.stringify() directly.\n` +
            `Use stringifyState() and parseState() from 'awaitly/persistence' instead:\n` +
            `  import { stringifyState, parseState } from 'awaitly/persistence';\n` +
            `  const json = stringifyState(state);  // Save this\n` +
            `  const restored = parseState(json);   // Load this`
        );
        // Try to recover by converting plain object to Map
        if (typeof resumeState.steps === "object" && resumeState.steps !== null) {
          resumeState.steps = new Map(Object.entries(resumeState.steps));
        }
      }

      for (const [key, entry] of resumeState.steps) {
        const { result, meta } = entry;
        if (result.ok) {
          cache.set(key, result);
        } else {
          // Encode error results with metadata for proper replay
          // Use provided meta if available, otherwise default to origin:"result"
          const effectiveMeta = meta ?? { origin: "result" as const, resultCause: result.cause };
          // Preserve original cause alongside metadata
          cache.set(key, encodeCachedError(result.error, effectiveMeta, result.cause));
        }
      }
    }

    // Pre-populate cache from snapshot if provided via config (new API)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snapshotOption = config?.snapshot ?? (optionsActual as any)?.snapshot as WorkflowSnapshot | null | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snapshotSerialization = (optionsActual as any)?.serialization as { decode?: (value: JSONValue) => unknown } | undefined;
    if (snapshotOption && !resumeStateOption) {
      // Auto-create cache if needed
      if (!cache) {
        cache = new Map<string, Result<unknown, unknown, unknown>>();
      }

      const snapshot = snapshotOption;
      const decode = snapshotSerialization?.decode;

      for (const [stepId, stepResult] of Object.entries(snapshot.steps)) {
        if (!Object.prototype.hasOwnProperty.call(snapshot.steps, stepId)) {
          continue;
        }

        try {
          if (stepResult.ok) {
            // Decode value if decoder provided
            const value = decode ? decode(stepResult.value) : stepResult.value;
            cache.set(stepId, ok(value));
          } else {
            // Restore the original error value (decode if decoder provided)
            const errorValue = decode ? decode(stepResult.error) : stepResult.error;
            // Deserialize the cause (Error or thrown value)
            const deserializedCause = deserializeCauseNew(stepResult.cause);
            // Construct proper StepFailureMeta from snapshot
            const meta: StepFailureMeta = stepResult.meta?.origin === "throw"
              ? { origin: "throw", thrown: deserializedCause }
              : { origin: "result", resultCause: deserializedCause };
            cache.set(stepId, encodeCachedError(errorValue, meta, deserializedCause));
          }
        } catch (e) {
          throw new SnapshotDecodeError(
            `Failed to decode step "${stepId}": ${e instanceof Error ? e.message : String(e)}`,
            stepId,
            e instanceof Error ? e : undefined
          );
        }
      }
    }


    // Track abort state and last step key for mid-execution cancellation
    let abortedDuringExecution = false;
    let abortReason: string | undefined;
    let lastStepKey: string | undefined;

    // Set up abort listener if signal is provided
    const abortHandler = () => {
      abortedDuringExecution = true;
      abortReason = typeof workflowSignal?.reason === "string"
        ? workflowSignal.reason
        : workflowSignal?.reason instanceof Error
          ? workflowSignal.reason.message
          : undefined;
    };

    if (workflowSignal && !workflowSignal.aborted) {
      workflowSignal.addEventListener("abort", abortHandler, { once: true });
    }

    // Helper to check for mid-execution cancellation and throw if aborted
    // lastStepKey = the last successfully completed keyed step (for resume purposes)
    const checkCancellation = (): void => {
      // Check both the flag and the signal directly (in case abort happened synchronously)
      if (abortedDuringExecution || workflowSignal?.aborted) {
        const reason = abortReason ?? (
          typeof workflowSignal?.reason === "string"
            ? workflowSignal.reason
            : workflowSignal?.reason instanceof Error
              ? workflowSignal.reason.message
              : undefined
        );
        const cancelledError: WorkflowCancelledError = {
          type: "WORKFLOW_CANCELLED",
          reason,
          lastStepKey,
        };
        // Throw to abort the workflow - will be caught by run() error handling
        throw cancelledError;
      }
    };

    // Helper to call onAfterStep hook with event emission
    const callOnAfterStepHook = async (
      stepKey: string,
      result: Result<unknown, unknown, unknown>,
      _meta?: StepFailureMeta
    ): Promise<void> => {
      if (!onAfterStepHook) return;
      const hookStartTime = performance.now();
      try {
        await onAfterStepHook(stepKey, result, workflowId, context);
        const hookDuration = performance.now() - hookStartTime;
        emitEvent({
          type: "hook_after_step",
          workflowId,
          stepKey,
          ts: Date.now(),
          durationMs: hookDuration,
        });
      } catch (thrown) {
        const hookDuration = performance.now() - hookStartTime;
        emitEvent({
          type: "hook_after_step_error",
          workflowId,
          stepKey,
          ts: Date.now(),
          durationMs: hookDuration,
          error: thrown as E,
        });
        // Re-throw to maintain original behavior
        throw thrown;
      }
    };

    // Create a cached step wrapper
    const createCachedStep = (realStep: RunStep<E>): RunStep<E> => {
      // NOTE: We always create the wrapper because streaming methods (streamForEach, getWritable,
      // getReadable) are defined on cachedStepFn, not realStep. Even without cache/hooks/signal/
      // streamStore, the workflow may use step.streamForEach with async iterables.

      // Wrap the main step function with backward-compatible signature
      // Supports: step('id', fn, opts), step(fn, opts?), step(result, opts?)
      const cachedStepFn = async <StepT, StepE extends E, StepC = unknown>(
        idOrOperationOrResult: string | (() => Result<StepT, StepE, StepC> | AsyncResult<StepT, StepE, StepC>) | Result<StepT, StepE, StepC> | AsyncResult<StepT, StepE, StepC>,
        operationOrOptions?: (() => Result<StepT, StepE, StepC> | AsyncResult<StepT, StepE, StepC>) | StepOptions | string,
        stepOptions?: StepOptions
      ): Promise<StepT> => {
        // Validate required string ID as first argument
        if (typeof idOrOperationOrResult !== 'string') {
          throw new Error(
            '[awaitly] step() requires a string ID as the first argument. ' +
            'Example: step("fetchUser", () => fetchUser(id))'
          );
        }

        // Parse arguments: step('id', fn, opts)
        const id = idOrOperationOrResult;
        const opts = stepOptions ?? {};

        // Name is always derived from ID
        const name = id;
        // Use cache by id when key is omitted; when key is explicitly set (including undefined) use that (undefined = don't cache)
        const key = Object.prototype.hasOwnProperty.call(opts, "key")
          ? opts.key
          : id;
        const { ttl, out } = opts;

        // Check for cancellation before starting step
        // Use lastStepKey (last completed step) for reporting, not the step about to run
        checkCancellation();

        // Update lastStepKey AFTER the step completes (moved to success/error handlers below)
        // This ensures lastStepKey always means "last successfully completed keyed step"

        // Only use cache if key is provided and cache exists
        if (key && cache && cache.has(key)) {
          emitEvent({
            type: "step_cache_hit",
            workflowId,
            stepKey: key,
            name,
            ts: Date.now(),
          });

          const cached = cache.get(key)!;
          if (cached.ok) {
            // Update lastStepKey for cache hits too (step effectively completed)
            lastStepKey = key;
            // Store result in workflow data if 'out' is specified (even for cache hits)
            if (out) {
              workflowData[out] = cached.value;
            }
            return cached.value as StepT;
          }
          // Cached error - throw early exit with preserved metadata (origin + cause)
          // This bypasses realStep to avoid replaying step_start/step_error events
          const meta = decodeCachedMeta(cached.cause);
          throw createEarlyExit(cached.error as StepE, meta);
        }

        // Cache miss - emit event only if caching is enabled
        if (key && cache) {
          emitEvent({
            type: "step_cache_miss",
            workflowId,
            stepKey: key,
            name,
            ts: Date.now(),
          });
        }

        try {
          // Pass arguments to realStep: step('id', fn, opts)
          const value = await (realStep as CallableFunction)(
            id,
            operationOrOptions,
            opts
          );
          // Store result in workflow data if 'out' is specified
          if (out) {
            workflowData[out] = value;
          }
          // Cache successful result if key provided
          if (key) {
            // Update lastStepKey on successful completion (for cancellation reporting)
            lastStepKey = key;
            if (cache) {
              cache.set(key, ok(value), ttl ? { ttl } : undefined);
            }
            // Call onAfterStep hook for checkpointing (even without cache)
            await callOnAfterStepHook(key, ok(value));
          }
          return value;
        } catch (thrown) {
          // Cache error results with full metadata if key provided and this is an early exit
          if (key && isEarlyExit(thrown)) {
            const exit = thrown as EarlyExit<StepE>;
            // Extract original cause from metadata for preservation
            const originalCause =
              exit.meta.origin === "result"
                ? exit.meta.resultCause
                : exit.meta.thrown;
            const errorResult = encodeCachedError(exit.error, exit.meta, originalCause);
            if (cache) {
              cache.set(key, errorResult, ttl ? { ttl } : undefined);
            }
            // Call onAfterStep hook for checkpointing (even on error, even without cache)
            await callOnAfterStepHook(key, errorResult, exit.meta);
          }
          throw thrown;
        }
      };

      // Wrap step.try
      cachedStepFn.try = async <StepT, Err extends E>(
        id: string,
        operation: () => StepT | Promise<StepT>,
        opts:
          | { error: Err; key?: string; ttl?: number }
          | { onError: (cause: unknown) => Err; key?: string; ttl?: number }
      ): Promise<StepT> => {
        const { ttl } = opts;
        const key = opts.key ?? id; // step.try caches by id when key omitted (for resume)
        const name = id;

        if (cache && cache.has(key)) {
          emitEvent({
            type: "step_cache_hit",
            workflowId,
            stepKey: key,
            name,
            ts: Date.now(),
          });

          const cached = cache.get(key)!;
          if (cached.ok) {
            return cached.value as StepT;
          }
          const meta = decodeCachedMeta(cached.cause);
          throw createEarlyExit(cached.error as Err, meta);
        }

        if (cache) {
          emitEvent({
            type: "step_cache_miss",
            workflowId,
            stepKey: key,
            name,
            ts: Date.now(),
          });
        }

        try {
          const value = await realStep.try(id, operation, { ...opts, key });
          if (cache) {
            cache.set(key, ok(value), ttl ? { ttl } : undefined);
          }
          await callOnAfterStepHook(key, ok(value));
          return value;
        } catch (thrown) {
          if (isEarlyExit(thrown)) {
            const exit = thrown as EarlyExit<Err>;
            const originalCause =
              exit.meta.origin === "result"
                ? exit.meta.resultCause
                : exit.meta.thrown;
            const errorResult = encodeCachedError(exit.error, exit.meta, originalCause);
            if (cache) {
              cache.set(key, errorResult, ttl ? { ttl } : undefined);
            }
            await callOnAfterStepHook(key, errorResult, exit.meta);
          }
          throw thrown;
        }
      };

      // Wrap step.fromResult - delegate to real step (caching handled by key in opts)
      cachedStepFn.fromResult = async <StepT, ResultE, Err extends E>(
        id: string,
        operation: () => Result<StepT, ResultE, unknown> | AsyncResult<StepT, ResultE, unknown>,
        opts:
          | { error: Err; key?: string; ttl?: number }
          | { onError: (resultError: ResultE) => Err; key?: string; ttl?: number }
      ): Promise<StepT> => {
        const { ttl } = opts;
        const key = opts.key ?? id; // step.fromResult caches by id when key omitted (for resume)
        const name = id;

        if (cache && cache.has(key)) {
          emitEvent({
            type: "step_cache_hit",
            workflowId,
            stepKey: key,
            name,
            ts: Date.now(),
          });

          const cached = cache.get(key)!;
          if (cached.ok) {
            return cached.value as StepT;
          }
          const meta = decodeCachedMeta(cached.cause);
          throw createEarlyExit(cached.error as Err, meta);
        }

        if (cache) {
          emitEvent({
            type: "step_cache_miss",
            workflowId,
            stepKey: key,
            name,
            ts: Date.now(),
          });
        }

        try {
          const value = await realStep.fromResult(id, operation, { ...opts, key });
          if (cache) {
            cache.set(key, ok(value), ttl ? { ttl } : undefined);
          }
          await callOnAfterStepHook(key, ok(value));
          return value;
        } catch (thrown) {
          if (isEarlyExit(thrown)) {
            const exit = thrown as EarlyExit<Err>;
            const originalCause =
              exit.meta.origin === "result"
                ? exit.meta.resultCause
                : exit.meta.thrown;
            const errorResult = encodeCachedError(exit.error, exit.meta, originalCause);
            if (cache) {
              cache.set(key, errorResult, ttl ? { ttl } : undefined);
            }
            await callOnAfterStepHook(key, errorResult, exit.meta);
          }
          throw thrown;
        }
      };

      // Wrap step.parallel - delegate to real step (no caching for scope wrappers)
      cachedStepFn.parallel = realStep.parallel;

      // Wrap step.race - delegate to real step (no caching for scope wrappers)
      cachedStepFn.race = realStep.race;

      // Wrap step.allSettled - delegate to real step (no caching for scope wrappers)
      cachedStepFn.allSettled = realStep.allSettled;

      // Wrap step.retry - pass key explicitly so "no key" means don't cache (cachedStepFn treats key: undefined as no cache)
      cachedStepFn.retry = <StepT, StepE extends E, StepC = unknown>(
        id: string,
        operation: () => Result<StepT, StepE, StepC> | AsyncResult<StepT, StepE, StepC>,
        options: RetryOptions & { key?: string; timeout?: TimeoutOptions; ttl?: number }
      ): Promise<StepT> => {
        const stepOptions = {
          key: options.key, // explicitly pass so undefined = don't cache
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
          ttl: options.ttl,
        };

        return cachedStepFn(id, operation, stepOptions);
      };

      // Wrap step.withTimeout - pass key explicitly so "no key" means don't cache
      cachedStepFn.withTimeout = <StepT, StepE extends E, StepC = unknown>(
        id: string,
        operation:
          | (() => Result<StepT, StepE, StepC> | AsyncResult<StepT, StepE, StepC>)
          | ((signal: AbortSignal) => Result<StepT, StepE, StepC> | AsyncResult<StepT, StepE, StepC>),
        options: TimeoutOptions & { key?: string; ttl?: number }
      ): Promise<StepT> => {
        const stepOptions = {
          key: options.key,
          timeout: options,
          ttl: options.ttl,
        };

        return cachedStepFn(
          id,
          operation as () => Result<StepT, StepE, StepC> | AsyncResult<StepT, StepE, StepC>,
          stepOptions
        );
      };

      // Wrap step.sleep - only use cache when explicit key is provided
      cachedStepFn.sleep = (
        id: string,
        duration: string | DurationType,
        options?: { key?: string; ttl?: number; description?: string; signal?: AbortSignal }
      ): Promise<void> => {
        if (typeof id !== "string" || id.length === 0) {
          throw new Error(
            "[awaitly] step.sleep() requires an explicit string ID as the first argument. " +
              'Example: step.sleep("delay", "5s")'
          );
        }
        const d = typeof duration === "string" ? parseDuration(duration) : duration;
        if (!d) {
          throw new Error(`step.sleep: invalid duration '${duration}'`);
        }
        const ms = toMillis(d);

        const userSignal = options?.signal;

        const sleepOperation = async (): AsyncResult<void, never> => {
          // Check if already aborted (workflow or user signal)
          if (workflowSignal?.aborted || userSignal?.aborted) {
            const e = new Error("Sleep aborted");
            e.name = "AbortError";
            throw e;
          }

          return new Promise<Result<void, never>>((resolve, reject) => {
            const state = {
              timeoutId: undefined as ReturnType<typeof setTimeout> | undefined,
            };

            const onAbort = () => {
              if (state.timeoutId) clearTimeout(state.timeoutId);
              const e = new Error("Sleep aborted");
              e.name = "AbortError";
              reject(e);
            };

            workflowSignal?.addEventListener("abort", onAbort, { once: true });
            userSignal?.addEventListener("abort", onAbort, { once: true });

            state.timeoutId = setTimeout(() => {
              workflowSignal?.removeEventListener("abort", onAbort);
              userSignal?.removeEventListener("abort", onAbort);
              resolve(ok(undefined));
            }, ms);
          });
        };

        return cachedStepFn(id, sleepOperation, {
          key: options?.key,
          ttl: options?.ttl,
          description: options?.description,
        });
      };

      // ===========================================================================
      // Streaming Methods
      // ===========================================================================

      // Store active writers and their backpressure controllers
      const activeWriters = new Map<string, {
        writer: StreamWriter<unknown>;
        backpressure: BackpressureController;
        aborted: boolean;
        closed: boolean;
      }>();

      // Store active readers
      const activeReaders = new Map<string, {
        reader: StreamReader<unknown>;
        position: number;
        closed: boolean;
      }>();

      cachedStepFn.getWritable = <T>(
        options?: StreamWritableOptions
      ): StreamWriterInterface<T> => {
        const namespace = options?.namespace ?? "default";
        const highWaterMark = options?.highWaterMark ?? 16;

        if (!streamStore) {
          throw new Error(
            "streamStore is required to use getWritable(). " +
            "Pass a streamStore to createWorkflow options."
          );
        }

        // Check if writer already exists for this namespace
        const existingKey = `${workflowId}:${namespace}`;
        const existing = activeWriters.get(existingKey);
        if (existing && !existing.closed && !existing.aborted) {
          return existing.writer as StreamWriter<T>;
        }

        // Create backpressure controller
        const backpressure = createBackpressureController({
          highWaterMark,
          onStateChange: (state) => {
            emitEvent({
              type: "stream_backpressure",
              workflowId,
              namespace,
              bufferedCount: backpressure.bufferedCount,
              state,
              ts: Date.now(),
            });
          },
        });

        let position = 0;
        let writable = true;
        let aborted = false;
        let closed = false;

        // Emit stream_created event
        emitEvent({
          type: "stream_created",
          workflowId,
          namespace,
          ts: Date.now(),
        });

        const writer: StreamWriter<T> = {
          async write(value: T): AsyncResult<void, StreamWriteError> {
            if (closed) {
              return err(streamWriteError("closed", "Stream is closed"));
            }
            if (aborted) {
              return err(streamWriteError("aborted", "Stream was aborted"));
            }

            // Check backpressure
            if (backpressure.state === "paused") {
              await backpressure.waitForDrain();
            }

            // Write to store
            const item: StreamItem<T> = {
              value,
              position,
              ts: Date.now(),
            };

            const result = await streamStore.append<T>(workflowId, namespace, item);
            if (!result.ok) {
              emitEvent({
                type: "stream_error",
                workflowId,
                namespace,
                error: result.error,
                position,
                ts: Date.now(),
              });
              return err(streamWriteError("store_error", result.error.message, result.error));
            }

            // Emit write event
            emitEvent({
              type: "stream_write",
              workflowId,
              namespace,
              position,
              ts: Date.now(),
            });

            position++;
            backpressure.increment();

            return ok(undefined);
          },

          async close(): AsyncResult<void, StreamCloseError> {
            if (closed) {
              return err(streamCloseError("already_closed", "Stream is already closed"));
            }

            const result = await streamStore.closeStream(workflowId, namespace);
            if (!result.ok) {
              return err(streamCloseError("store_error", result.error.message, result.error));
            }

            closed = true;
            writable = false;

            // Emit close event
            emitEvent({
              type: "stream_close",
              workflowId,
              namespace,
              finalPosition: position,
              ts: Date.now(),
            });

            // Clean up
            activeWriters.delete(existingKey);

            return ok(undefined);
          },

          abort(reason: unknown): void {
            aborted = true;
            writable = false;
            closed = true;

            emitEvent({
              type: "stream_error",
              workflowId,
              namespace,
              error: reason,
              position,
              ts: Date.now(),
            });

            // Clean up
            activeWriters.delete(existingKey);
          },

          get writable() {
            return writable;
          },

          get position() {
            return position;
          },

          get namespace() {
            return namespace;
          },
        };

        activeWriters.set(existingKey, {
          writer: writer as StreamWriter<unknown>,
          backpressure,
          aborted,
          closed,
        });

        return writer;
      };

      cachedStepFn.getReadable = <T>(
        options?: StreamReadableOptions
      ): StreamReaderInterface<T> => {
        const namespace = options?.namespace ?? "default";
        const startIndex = options?.startIndex ?? 0;
        const pollInterval = options?.pollInterval ?? 10;
        const pollTimeout = options?.pollTimeout ?? 30000;

        if (!streamStore) {
          throw new Error(
            "streamStore is required to use getReadable(). " +
            "Pass a streamStore to createWorkflow options."
          );
        }

        const existingKey = `${workflowId}:${namespace}:${startIndex}`;
        const existing = activeReaders.get(existingKey);
        if (existing && !existing.closed) {
          return existing.reader as StreamReader<T>;
        }

        // Helper to decrement backpressure when items are consumed
        const decrementBackpressure = () => {
          const writerKey = `${workflowId}:${namespace}`;
          const activeWriter = activeWriters.get(writerKey);
          if (activeWriter) {
            activeWriter.backpressure.decrement();
          }
        };

        let position = startIndex;
        let readable = true;
        let closed = false;
        let bufferedItems: StreamItem<T>[] = [];
        let bufferIndex = 0;

        const reader: StreamReader<T> = {
          async read(): AsyncResult<T, StreamReadError | StreamEndedMarker> {
            if (closed) {
              return err(streamReadError("closed", "Reader is closed"));
            }

            // Check if we have buffered items
            if (bufferIndex < bufferedItems.length) {
              const item = bufferedItems[bufferIndex++];
              position = item.position + 1;

              // Release backpressure for consumed item
              decrementBackpressure();

              emitEvent({
                type: "stream_read",
                workflowId,
                namespace,
                position: item.position,
                ts: Date.now(),
              });

              return ok(item.value);
            }

            // Poll for items from store with timeout
            // We poll even if there's no active writer yet, as one may appear
            const writerKey = `${workflowId}:${namespace}`;
            const pollStart = Date.now();
            let hasSeenWriter = activeWriters.has(writerKey);

            // Check initial state
            const initialMetaResult = await streamStore.getMetadata(workflowId, namespace);
            let hasSeenMetadata = initialMetaResult.ok && initialMetaResult.value !== undefined;

            while (Date.now() - pollStart < pollTimeout) {
              const result = await streamStore.read<T>(workflowId, namespace, position, 100);
              if (!result.ok) {
                return err(streamReadError("store_error", result.error.message, result.error));
              }

              const items = result.value;
              if (items.length > 0) {
                // Buffer items and return first
                bufferedItems = items;
                bufferIndex = 1;
                const item = items[0];
                position = item.position + 1;

                // Release backpressure for consumed item
                decrementBackpressure();

                emitEvent({
                  type: "stream_read",
                  workflowId,
                  namespace,
                  position: item.position,
                  ts: Date.now(),
                });

                return ok(item.value);
              }

              // Check current state
              const writerActive = activeWriters.has(writerKey);
              const metaResult = await streamStore.getMetadata(workflowId, namespace);
              const metadataExists = metaResult.ok && metaResult.value !== undefined;

              // Track if we've ever seen a writer or metadata
              if (writerActive) hasSeenWriter = true;
              if (metadataExists) hasSeenMetadata = true;

              // Stream is closed - no more items coming
              if (metaResult.ok && metaResult.value?.closed) {
                readable = false;
                return err(streamEnded(position));
              }

              // If we've seen a writer or metadata but now it's gone and empty,
              // the stream has ended without more items
              if (hasSeenWriter && !writerActive && !metadataExists) {
                // Writer was created and removed without writing anything
                readable = false;
                return err(streamEnded(position));
              }

              if (hasSeenMetadata && !writerActive && metaResult.ok && !metaResult.value?.closed) {
                // Stream exists, writer is gone, but stream not closed
                // This means writer finished - wait a bit more for any pending writes
                // then give up
              }

              // Stream is still open or writer may still appear - wait and poll again
              await new Promise((resolve) => setTimeout(resolve, pollInterval));
            }

            // Poll timeout - treat as stream ended
            readable = false;
            return err(streamEnded(position));
          },

          close(): void {
            closed = true;
            readable = false;
            bufferedItems = [];
            activeReaders.delete(existingKey);
          },

          get readable() {
            return readable;
          },

          get position() {
            return position;
          },

          get namespace() {
            return namespace;
          },
        };

        activeReaders.set(existingKey, {
          reader: reader as StreamReader<unknown>,
          position,
          closed,
        });

        return reader;
      };

      cachedStepFn.streamForEach = async <T, R, StepE extends E>(
        source: StreamReaderInterface<T> | AsyncIterable<T>,
        processor: (item: T, index: number) => AsyncResult<R, StepE>,
        options?: StreamForEachStepOptions
      ): Promise<StreamForEachResultType<R>> => {
        const checkpointInterval = options?.checkpointInterval ?? 1;
        const concurrency = options?.concurrency ?? 1;
        const results: R[] = [];
        let processedCount = 0;
        let lastPosition = -1;

        // Helper to check if source is a StreamReader
        const isStreamReader = (s: unknown): s is StreamReaderInterface<T> => {
          return (
            typeof s === "object" &&
            s !== null &&
            "read" in s &&
            typeof (s as StreamReaderInterface<T>).read === "function"
          );
        };

        // Helper to process a single item with step()
        const processItem = async (
          item: T,
          itemIndex: number,
          itemPosition: number,
          namespace: string
        ): Promise<{ index: number; position: number; result: R }> => {
          const shouldCheckpoint = checkpointInterval > 0 && itemIndex % checkpointInterval === 0;
          const stepKey = shouldCheckpoint
            ? `stream-foreach:${namespace}:pos-${itemPosition}`
            : undefined;

          const stepId = stepKey ?? `stream-item-${itemPosition}`;
          const stepResult = await cachedStepFn(
            stepId,
            () => processor(item, itemIndex),
            { key: stepKey }
          );

          return { index: itemIndex, position: itemPosition, result: stepResult };
        };

        if (isStreamReader(source)) {
          if (concurrency <= 1) {
            // Sequential processing (original behavior)
            let itemPosition = source.position;
            let readResult = await source.read();
            while (readResult.ok) {
              const item = readResult.value;
              const { result } = await processItem(item, processedCount, itemPosition, source.namespace);
              results.push(result);
              lastPosition = itemPosition;
              processedCount++;
              itemPosition = source.position;
              readResult = await source.read();
            }
          } else {
            // Concurrent processing - interleave reading and processing
            const resultsMap = new Map<number, { position: number; result: R }>();
            let itemIndex = 0;
            let totalItems = 0;

            // Track slots with wrapped promises that include slot index
            type SlotResult = { slotIndex: number; index: number; position: number; result: R };
            const slots: (Promise<SlotResult> | null)[] = new Array(concurrency).fill(null);

            // Helper to find an empty slot, waiting if necessary
            const getSlot = async (): Promise<number> => {
              // First, check for empty slots
              for (let i = 0; i < slots.length; i++) {
                if (slots[i] === null) return i;
              }
              // No empty slots - wait for one to complete
              const activePromises = slots.filter((s): s is Promise<SlotResult> => s !== null);
              const completed = await Promise.race(activePromises);
              resultsMap.set(completed.index, { position: completed.position, result: completed.result });
              // Clear the slot that completed (we know which one from slotIndex)
              slots[completed.slotIndex] = null;
              return completed.slotIndex;
            };

            // Read and process items concurrently
            let itemPosition = source.position;
            let readResult = await source.read();

            while (readResult.ok) {
              const slotIndex = await getSlot();

              // Capture current values for closure
              const currentIndex = itemIndex;
              const currentPosition = itemPosition;
              const currentItem = readResult.value;
              const currentSlot = slotIndex;

              // Start processing in this slot, wrapping to include slot index
              slots[slotIndex] = processItem(currentItem, currentIndex, currentPosition, source.namespace)
                .then(r => ({ slotIndex: currentSlot, ...r }));
              totalItems++;
              itemIndex++;

              // Read next item
              itemPosition = source.position;
              readResult = await source.read();
            }

            // Wait for all remaining slots to complete
            for (let i = 0; i < slots.length; i++) {
              if (slots[i] !== null) {
                const result = await slots[i]!;
                resultsMap.set(result.index, { position: result.position, result: result.result });
              }
            }

            // Collect results in order
            for (let i = 0; i < totalItems; i++) {
              const entry = resultsMap.get(i);
              if (entry) {
                results.push(entry.result);
                lastPosition = entry.position;
                processedCount++;
              }
            }
          }
        } else {
          // Process from AsyncIterable
          if (concurrency <= 1) {
            // Sequential processing
            let index = 0;
            for await (const item of source) {
              const { result } = await processItem(item, index, index, "async-iterable");
              results.push(result);
              lastPosition = index;
              processedCount++;
              index++;
            }
          } else {
            // Concurrent processing - interleave iteration and processing
            const resultsMap = new Map<number, R>();
            let itemIndex = 0;
            let totalItems = 0;

            // Track slots with wrapped promises that include slot index
            type SlotResult = { slotIndex: number; index: number; position: number; result: R };
            const slots: (Promise<SlotResult> | null)[] = new Array(concurrency).fill(null);

            // Helper to find an empty slot, waiting if necessary
            const getSlot = async (): Promise<number> => {
              // First, check for empty slots
              for (let i = 0; i < slots.length; i++) {
                if (slots[i] === null) return i;
              }
              // No empty slots - wait for one to complete
              const activePromises = slots.filter((s): s is Promise<SlotResult> => s !== null);
              const completed = await Promise.race(activePromises);
              resultsMap.set(completed.index, completed.result);
              // Clear the slot that completed (we know which one from slotIndex)
              slots[completed.slotIndex] = null;
              return completed.slotIndex;
            };

            // Iterate and process items concurrently
            for await (const item of source) {
              const slotIndex = await getSlot();

              // Capture current values for closure
              const currentIndex = itemIndex;
              const currentSlot = slotIndex;

              // Start processing in this slot, wrapping to include slot index
              slots[slotIndex] = processItem(item, currentIndex, currentIndex, "async-iterable")
                .then(r => ({ slotIndex: currentSlot, ...r }));
              totalItems++;
              itemIndex++;
            }

            // Wait for all remaining slots to complete
            for (let i = 0; i < slots.length; i++) {
              if (slots[i] !== null) {
                const result = await slots[i]!;
                resultsMap.set(result.index, result.result);
              }
            }

            // Collect results in order
            for (let i = 0; i < totalItems; i++) {
              // Use has() instead of checking result !== undefined because
              // the processor may legitimately return ok(undefined)
              if (resultsMap.has(i)) {
                results.push(resultsMap.get(i) as R);
                lastPosition = i;
                processedCount++;
              }
            }
          }
        }

        return {
          results,
          processedCount,
          lastPosition,
        };
      };

      // step.if: Delegate to real step (no caching needed - just returns condition result)
      cachedStepFn.if = realStep.if;

      // step.label: Alias for step.if - delegate to real step
      cachedStepFn.label = realStep.label;

      // step.branch: Delegate to real step (evaluates condition and executes arm)
      cachedStepFn.branch = realStep.branch;

      // step.arm: Delegate to real step (returns arm definition)
      cachedStepFn.arm = realStep.arm;

      // step.forEach: Delegate to real step (executes loop)
      cachedStepFn.forEach = realStep.forEach;

      // step.item: Delegate to real step (returns item handler)
      cachedStepFn.item = realStep.item;

      // step.dep: Delegate to real step (no caching needed - just returns function unchanged)
      cachedStepFn.dep = realStep.dep;

      // Effect-style ergonomics: Route through cached step so cache/onAfterStep apply.
      // Accept either AsyncResult or () => AsyncResult (getter) so cache hits never run the getter.
      cachedStepFn.run = (
        id: string,
        resultOrGetter: AsyncResult<unknown, E, unknown> | (() => AsyncResult<unknown, E, unknown>),
        options?: StepOptions
      ) => {
        const op =
          typeof resultOrGetter === "function"
            ? (resultOrGetter as () => AsyncResult<unknown, E, unknown>)
            : () => resultOrGetter as AsyncResult<unknown, E, unknown>;
        return cachedStepFn(id, op, options) as Promise<unknown>;
      };
      cachedStepFn.andThen = (
        id: string,
        value: unknown,
        fn: (value: unknown) => AsyncResult<unknown, E, unknown>,
        options?: StepOptions
      ) => cachedStepFn(id, () => fn(value) as AsyncResult<unknown, E, unknown>, options) as Promise<unknown>;
      cachedStepFn.match = (
        id: string,
        result: Result<unknown, E, unknown> | AsyncResult<unknown, E, unknown>,
        handlers: {
          ok: (value: unknown) => unknown | Promise<unknown>;
          err: (error: E, cause?: unknown) => unknown | Promise<unknown>;
        },
        options?: StepOptions
      ) =>
        cachedStepFn(
          id,
          async () => {
            const resolved = await result;
            if (resolved.ok) {
              return ok(await handlers.ok(resolved.value));
            }
            return ok(await handlers.err(resolved.error, resolved.cause));
          },
          options
        ) as Promise<unknown>;
      // Match core: all() with no key = no cache (core parallel doesn't pass key, so no cache by id)
      cachedStepFn.all = (id: string, shape: Parameters<RunStep<E>["all"]>[1], options?: StepOptions) => {
        const opts =
          options !== undefined && Object.prototype.hasOwnProperty.call(options, "key")
            ? options
            : { ...options, key: undefined as string | undefined };
        return cachedStepFn(id, async () => ok(await realStep.all(id, shape)), opts) as Promise<unknown>;
      };
      // Match core: step.map() passes { key: options?.key }, so omitted key = no cache (core never caches by id for map)
      cachedStepFn.map = (
        id: string,
        items: unknown[],
        mapper: (item: unknown, index: number) => AsyncResult<unknown, E, unknown>,
        options?: { concurrency?: number; key?: string }
      ) => {
        const opts =
          options !== undefined && Object.prototype.hasOwnProperty.call(options, "key")
            ? options
            : { ...options, key: undefined as string | undefined };
        return cachedStepFn(id, async () => ok(await realStep.map(id, items, mapper, options)), opts) as Promise<unknown>;
      };

      return cachedStepFn as RunStep<E>;
    };

    // Wrap the user's callback to pass cached step, deps, and workflow context
    const wrappedFn = ({ step }: { step: RunStep<E> }) =>
      userFn({ step: createCachedStep(step), deps: effectiveDeps, ctx: workflowContext });

    // Always use run() with catchUnexpected (default or user-provided). Closed error union E | U.
    let result: Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>;

    try {
      result = await run<T, E | U, C>(wrappedFn as (context: { step: RunStep<E | U> }) => Promise<T> | T, {
        onError: onErrorHandler as ((error: E | U, stepName?: string, ctx?: C) => void) | undefined,
        onEvent: onEventHandler as ((event: WorkflowEvent<E | U | UnexpectedError, C>, ctx: C) => void) | undefined,
        catchUnexpected: catchUnexpected as (cause: unknown) => U,
        workflowId,
        workflowName,
        context,
        _workflowSignal: workflowSignal,
      });
    } finally {
      // Clean up abort listener
      if (workflowSignal) {
        workflowSignal.removeEventListener("abort", abortHandler);
      }
    }

    const durationMs = performance.now() - startTime;

    // Check if the error is a wrapped WorkflowCancelledError
    // There are two paths:
    // 1. result.cause is WorkflowCancelledError (both default and custom catchUnexpected)
    // 2. AbortError thrown during abort - synthesize WorkflowCancelledError
    if (!result.ok) {
      let cancelledError: WorkflowCancelledError | undefined;

      // Path 1: result.cause is WorkflowCancelledError (both default and custom catchUnexpected)
      if (isWorkflowCancelled(result.cause)) {
        cancelledError = result.cause as WorkflowCancelledError;
      }

      // Path 2: AbortError thrown during abort (e.g. step.sleep) - treat as cancellation
      // The thrown AbortError is in result.cause
      if (
        !cancelledError &&
        abortedDuringExecution &&
        isUnexpectedError(result.error)
      ) {
        const thrown = result.cause;
        const isAbortError =
          thrown != null &&
          typeof thrown === "object" &&
          "name" in thrown &&
          (thrown as { name: string }).name === "AbortError";
        if (isAbortError) {
          const reason =
            abortReason ??
            (typeof workflowSignal?.reason === "string"
              ? workflowSignal.reason
              : workflowSignal?.reason instanceof Error
                ? workflowSignal.reason.message
                : undefined);
          cancelledError = {
            type: "WORKFLOW_CANCELLED",
            reason,
            lastStepKey,
          };
        }
      }

      if (cancelledError) {
        emitEvent({
          type: "workflow_cancelled",
          workflowId,
          ts: Date.now(),
          durationMs,
          reason: cancelledError.reason,
          lastStepKey: cancelledError.lastStepKey,
        });
        // Path 2: We synthesized cancelledError from AbortError - ensure result.cause is WorkflowCancelledError
        if (cancelledError && !isWorkflowCancelled(result.cause)) {
          return err(result.error, { cause: cancelledError }) as Result<T, E | U, unknown>;
        }
        return result as Result<T, E | U, unknown>;
      }
    }

    // Check for late cancellation: workflow completed successfully but signal was aborted
    // This handles the case where abort happens during the last step but the operation doesn't throw
    // Only check abortedDuringExecution, not workflowSignal?.aborted, to avoid race condition
    // where a pre-aborted signal (aborted before workflow started) incorrectly cancels a successful workflow
    if (result.ok && abortedDuringExecution) {
      const reason = abortReason ?? (
        typeof workflowSignal?.reason === "string"
          ? workflowSignal.reason
          : workflowSignal?.reason instanceof Error
            ? workflowSignal.reason.message
            : undefined
      );
      emitEvent({
        type: "workflow_cancelled",
        workflowId,
        ts: Date.now(),
        durationMs,
        reason,
        lastStepKey,
      });
      const cancelledError: WorkflowCancelledError = {
        type: "WORKFLOW_CANCELLED",
        reason,
        lastStepKey,
      };
      return err(catchUnexpected(cancelledError), { cause: cancelledError }) as Result<T, E | U, unknown>;
    }

    // Emit workflow_success or workflow_error
    if (result.ok) {
      emitEvent({
        type: "workflow_success",
        workflowId,
        ts: Date.now(),
        durationMs,
      });
    } else {
      // At this point, WorkflowCancelledError has already been handled and returned above,
      // so result.error is not WorkflowCancelledError
      emitEvent({
        type: "workflow_error",
        workflowId,
        ts: Date.now(),
        durationMs,
        error: result.error as E | U,
      });
    }

    // NOTE: We intentionally do NOT check for unknown steps after workflow completes.
    // This is because workflows can have conditional branches - a step from a skipped branch
    // would appear "unused" but is still a valid step. We can't distinguish between:
    // 1. Steps that are truly unknown (from a different workflow)
    // 2. Steps that are defined but not executed in this particular run
    // Use workflowId matching in snapshot metadata to detect wrong snapshots instead.

    return result as Result<T, E | U, unknown>;
  }

  // ==========================================================================
  // workflow.run() - public method
  // ==========================================================================
  function runMethod<T>(
    fnOrName: string | WorkflowFn<T, E, Deps, C>,
    maybeFnOrConfig?: WorkflowFn<T, E, Deps, C> | RunConfig<E, U, C, Deps>,
    maybeConfig?: RunConfig<E, U, C, Deps>
  ): Promise<Result<T, E | U, unknown>> {
    let runName: string | undefined;
    let fn: WorkflowFn<T, E, Deps, C>;
    let config: RunConfig<E, U, C, Deps> | undefined;

    if (typeof fnOrName === "string") {
      runName = fnOrName;
      fn = maybeFnOrConfig as WorkflowFn<T, E, Deps, C>;
      config = maybeConfig;
    } else {
      fn = fnOrName;
      config = maybeFnOrConfig as RunConfig<E, U, C, Deps> | undefined;
    }

    return internalExecute(runName, fn, config);
  }

  // ==========================================================================
  // workflow.runWithState() - run and return result + resume state for persistence
  // ==========================================================================
  async function runWithStateMethod<T>(
    fnOrName: string | WorkflowFn<T, E, Deps, C>,
    maybeFnOrConfig?: WorkflowFn<T, E, Deps, C> | RunConfig<E, U, C, Deps>,
    maybeConfig?: RunConfig<E, U, C, Deps>
  ): Promise<{ result: Result<T, E | U, unknown>; resumeState: ResumeState }> {
    let runName: string | undefined;
    let fn: WorkflowFn<T, E, Deps, C>;
    let config: RunConfig<E, U, C, Deps> | undefined;

    if (typeof fnOrName === "string") {
      runName = fnOrName;
      fn = maybeFnOrConfig as WorkflowFn<T, E, Deps, C>;
      config = maybeConfig;
    } else {
      fn = fnOrName;
      config = maybeFnOrConfig as RunConfig<E, U, C, Deps> | undefined;
    }

    const collector = createResumeStateCollector();
    const userOnEvent = config?.onEvent;
    const mergedOnEvent = (event: WorkflowEvent<E | U, C>, ctx: C) => {
      collector.handleEvent(event);
      try {
        userOnEvent?.(event, ctx);
      } catch {
        // Observability shouldn't crash runs
      }
    };
    const mergedConfig: RunConfig<E, U, C, Deps> = { ...config, onEvent: mergedOnEvent };

    let result: Result<T, E | U, unknown>;
    let resumeState: ResumeState;
    try {
      result = await internalExecute(runName, fn, mergedConfig);
    } catch (thrown) {
      // runWithState follows "never throw, always Result"; map thrown to Result
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const catchUnexpected = (optionsActual as any)?.catchUnexpected ?? defaultCatchUnexpected;
      result = err(catchUnexpected(thrown), { cause: thrown }) as Result<T, E | U, unknown>;
    } finally {
      resumeState = collector.getResumeState();
    }
    return { result, resumeState };
  }

  const workflow: Workflow<E, U, Deps, C> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: runMethod as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runWithState: runWithStateMethod as any,
  };

  return workflow;
}
