/**
 * awaitly/workflow
 *
 * Workflow orchestration with createWorkflow.
 * Use this for typed async workflows with automatic error inference.
 */

import {
  run,
  ok,
  err,
  createEarlyExit,
  isEarlyExit,
  isUnexpectedError,
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
  type ErrorOf,
  type CauseOf,
  type Err,
  type StreamWritableOptions,
  type StreamReadableOptions,
  type StreamForEachStepOptions,
  type StreamForEachResultType,
  type StreamWriterInterface,
  type StreamReaderInterface,
} from "./core";

import type {
  StreamStore,
  StreamItem,
  StreamWriter,
  StreamReader,
  StreamWriteError,
  StreamCloseError,
  StreamReadError,
  StreamEndedMarker,
} from "./streaming/types";

import {
  streamWriteError,
  streamReadError,
  streamCloseError,
  streamEnded,
} from "./streaming/types";

import {
  createBackpressureController,
  type BackpressureController,
} from "./streaming/backpressure";

import { parse as parseDuration, toMillis, type Duration as DurationType } from "./duration";

// Re-export types and constants that workflow users commonly need
export { UNEXPECTED_ERROR } from "./core";
export type {
  Result,
  AsyncResult,
  UnexpectedError,
  RunStep,
  WorkflowEvent,
  StepOptions,
} from "./core";

// Re-export streaming types for workflow users
export type { StreamStore } from "./streaming/types";

// =============================================================================
// Step Cache Types
// =============================================================================

/**
 * Interface for step result caching.
 * Implement this interface to provide custom caching strategies.
 * A simple Map<string, Result> works for in-memory caching.
 *
 * ## When Cache is Populated
 *
 * The cache `set()` method is called after each step completes (success or error)
 * when the step has a `key` option. Both calling patterns work identically:
 *
 * ```typescript
 * // Function-wrapped pattern - cache is populated
 * await step(() => fetchUser("1"), { key: "user:1" });
 *
 * // Direct AsyncResult pattern - cache is also populated
 * await step(fetchUser("1"), { key: "user:1" });
 * ```
 *
 * Note: Cache stores Result<unknown, unknown, unknown> because different steps
 * have different value/error/cause types. The actual runtime values are preserved;
 * only the static types are widened. For error results, the cause value is encoded
 * in CachedErrorCause to preserve metadata for proper replay.
 *
 * @example
 * // Simple in-memory cache
 * const cache = new Map<string, Result<unknown, unknown, unknown>>();
 *
 * // Or implement custom cache with TTL, LRU, etc.
 * const cache: StepCache = {
 *   get: (key) => myCache.get(key),
 *   set: (key, result) => myCache.set(key, result, { ttl: 60000 }),
 *   has: (key) => myCache.has(key),
 *   delete: (key) => myCache.delete(key),
 *   clear: () => myCache.clear(),
 * };
 */
export interface StepCache {
  get(key: string): Result<unknown, unknown, unknown> | undefined;
  set(key: string, result: Result<unknown, unknown, unknown>, options?: { ttl?: number }): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
}

/**
 * Entry for a saved step result with optional metadata.
 * The meta field preserves origin information for proper replay.
 */
export interface ResumeStateEntry {
  result: Result<unknown, unknown, unknown>;
  /** Optional metadata for error origin (from step_complete event) */
  meta?: StepFailureMeta;
}

/**
 * Resume state for workflow replay.
 * Pre-populate step results to skip execution on resume.
 *
 * Note: When saving to persistent storage, you may need custom serialization
 * for complex cause types. JSON.stringify works for simple values, but Error
 * objects and other non-plain types require special handling.
 *
 * @example
 * // Collect from step_complete events using the helper
 * const collector = createResumeStateCollector();
 * const workflow = createWorkflow({ fetchUser }, {
 *   onEvent: collector.handleEvent,
 * });
 * // Later: collector.getResumeState() returns ResumeState
 *
 * @example
 * // Resume with saved state
 * const workflow = createWorkflow({ fetchUser }, {
 *   resumeState: { steps: savedSteps }
 * });
 */
export interface ResumeState {
  /** Map of step keys to their cached results with optional metadata */
  steps: Map<string, ResumeStateEntry>;
}

/**
 * Create a collector for step results to build resume state.
 *
 * ## When to Use
 *
 * Use `createResumeStateCollector` when you need to:
 * - **Save workflow state** for later replay/resume
 * - **Persist step results** to a database or file system
 * - **Build resume state** from workflow execution
 * - **Enable workflow replay** after application restarts
 *
 * ## Why Use This Instead of Manual Collection
 *
 * - **Automatic filtering**: Only collects `step_complete` events (ignores other events)
 * - **Metadata preservation**: Captures both result and meta for proper error replay
 * - **Type-safe**: Returns properly typed `ResumeState`
 * - **Convenient API**: Simple `handleEvent` → `getResumeState` pattern
 *
 * ## How It Works
 *
 * 1. Create collector and pass `handleEvent` to workflow's `onEvent` option
 * 2. Workflow emits `step_complete` events for keyed steps
 * 3. Collector automatically captures these events
 * 4. Call `getResumeState()` to get the collected `ResumeState`
 * 5. Persist state (e.g., to database) for later resume
 *
 * ## When step_complete Events Are Emitted
 *
 * Events are emitted for ANY step that has a `key` option, regardless of calling pattern:
 *
 * ```typescript
 * // Function-wrapped pattern - emits step_complete
 * await step(() => fetchUser("1"), { key: "user:1" });
 *
 * // Direct AsyncResult pattern - also emits step_complete
 * await step(fetchUser("1"), { key: "user:1" });
 * ```
 *
 * Both patterns above will emit `step_complete` events and be captured by the collector.
 *
 * ## Important Notes
 *
 * - Only steps with a `key` option are collected (unkeyed steps are not saved)
 * - The collector preserves error metadata for proper replay behavior
 * - State can be serialized to JSON (but complex cause types may need custom handling)
 *
 * @returns An object with:
 *   - `handleEvent`: Function to pass to workflow's `onEvent` option
 *   - `getResumeState`: Get collected resume state (call after workflow execution)
 *   - `clear`: Clears the collector's internal recorded entries (does not mutate workflow state)
 *
 * @example
 * ```typescript
 * // Collect state during workflow execution
 * const collector = createResumeStateCollector();
 *
 * const workflow = createWorkflow({ fetchUser, fetchPosts }, {
 *   onEvent: collector.handleEvent, // Pass collector's handler
 * });
 *
 * await workflow(async (step) => {
 *   // Only keyed steps are collected
 *   const user = await step(() => fetchUser("1"), { key: "user:1" });
 *   const posts = await step(() => fetchPosts(user.id), { key: `posts:${user.id}` });
 *   return { user, posts };
 * });
 *
 * // Get collected state for persistence
 * const state = collector.getResumeState();
 * // state.steps contains: 'user:1' and 'posts:1' entries
 *
 * // Save to database
 * await db.saveWorkflowState(workflowId, state);
 * ```
 *
 * @example
 * ```typescript
 * // Resume workflow from saved state
 * const savedState = await db.loadWorkflowState(workflowId);
 * const workflow = createWorkflow({ fetchUser, fetchPosts }, {
 *   resumeState: savedState // Pre-populate cache from saved state
 * });
 *
 * // Cached steps skip execution, new steps run normally
 * await workflow(async (step) => {
 *   const user = await step(() => fetchUser("1"), { key: "user:1" }); // Cache hit
 *   const posts = await step(() => fetchPosts(user.id), { key: `posts:${user.id}` }); // Cache hit
 *   return { user, posts };
 * });
 * ```
 */
export function createResumeStateCollector(): {
  /** Handle workflow events. Pass this to workflow's `onEvent` option. */
  handleEvent: (event: WorkflowEvent<unknown>) => void;
  /** Get the collected resume state. Call after workflow execution. */
  getResumeState: () => ResumeState;
  /** Clears the collector's internal recorded entries (does not mutate workflow state). */
  clear: () => void;
} {
  const steps = new Map<string, ResumeStateEntry>();

  return {
    handleEvent: (event: WorkflowEvent<unknown>) => {
      if (isStepComplete(event)) {
        steps.set(event.stepKey, { result: event.result, meta: event.meta });
      }
    },
    getResumeState: () => ({ steps: new Map(steps) }),
    clear: () => steps.clear(),
  };
}

// =============================================================================
// Cache Entry Encoding (preserves StepFailureMeta for proper replay)
// =============================================================================

/**
 * Marker for cached error entries that include step failure metadata.
 * This allows us to preserve origin:"throw" vs origin:"result" when replaying,
 * while also preserving the original cause value for direct cache access.
 * @internal
 */
interface CachedErrorCause<C = unknown> {
  __cachedMeta: true;
  /** The original cause from the step result (preserved for direct access) */
  originalCause: C;
  /** Metadata for proper replay behavior */
  meta: StepFailureMeta;
}

function isCachedErrorCause(cause: unknown): cause is CachedErrorCause {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as CachedErrorCause).__cachedMeta === true
  );
}

/**
 * Encode an error result for caching, preserving both the original cause
 * and metadata needed for proper replay.
 */
function encodeCachedError<E, C>(
  error: E,
  meta: StepFailureMeta,
  originalCause: C
): Err<E, CachedErrorCause<C>> {
  return err(error, {
    cause: { __cachedMeta: true, originalCause, meta } as CachedErrorCause<C>,
  });
}

function decodeCachedMeta(cause: unknown): StepFailureMeta {
  if (isCachedErrorCause(cause)) {
    return cause.meta;
  }
  // Fallback for any non-encoded cause (shouldn't happen, but safe default)
  return { origin: "result", resultCause: cause };
}

// =============================================================================
// createWorkflow Types
// =============================================================================

/**
 * Constraint for Result-returning functions
 * Used by createWorkflow to ensure only valid functions are passed
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyResultFn = (...args: any[]) => Result<any, any, any> | Promise<Result<any, any, any>>;

/**
 * Extract union of error types from a deps object
 * Example: ErrorsOfDeps<{ fetchUser: typeof fetchUser, fetchPosts: typeof fetchPosts }>
 * yields: 'NOT_FOUND' | 'FETCH_ERROR'
 */
export type ErrorsOfDeps<Deps extends Record<string, AnyResultFn>> = {
  [K in keyof Deps]: ErrorOf<Deps[K]>;
}[keyof Deps];

/**
 * Extract union of cause types from a deps object.
 * Example: CausesOfDeps<{ fetchUser: typeof fetchUser }> where fetchUser returns Result<User, "NOT_FOUND", Error>
 * yields: Error
 *
 * Note: This represents the domain cause types from declared functions.
 * However, workflow results may also have unknown causes from step.try failures
 * or uncaught exceptions, so the actual Result cause type is `unknown`.
 */
export type CausesOfDeps<Deps extends Record<string, AnyResultFn>> =
  CauseOf<Deps[keyof Deps]>;

// =============================================================================
// Execution Options (per-run overrides)
// =============================================================================

/**
 * Execution-time options that can override creation-time options.
 * Pass these to `workflow.run(fn, execOptions)` for per-run configuration.
 *
 * Rule: Use `workflow(...)` for normal runs. Use `workflow.run(...)` when you need per-run hooks/options.
 *
 * @example
 * ```typescript
 * const workflow = createWorkflow(deps, { cache, onEvent: defaultHandler });
 *
 * // Normal run uses creation-time options
 * await workflow(async (step) => { ... });
 *
 * // Per-run options override creation-time options
 * await workflow.run(async (step) => { ... }, { onEvent: viz.handleEvent });
 *
 * // Pre-bind defaults with .with() (overridable by .run())
 * const visualized = workflow.with({ onEvent: viz.handleEvent });
 * await visualized(async (step) => { ... });
 * ```
 */
export type ExecutionOptions<E, C = void> = {
  /**
   * Event handler for workflow and step lifecycle events.
   * Overrides `onEvent` from creation-time options.
   */
  onEvent?: (event: WorkflowEvent<E | UnexpectedError, C>, ctx: C) => void;
  /**
   * Error handler called when a step fails.
   * Overrides `onError` from creation-time options.
   */
  onError?: (error: E | UnexpectedError, stepName?: string, ctx?: C) => void;
  /**
   * AbortSignal for workflow-level cancellation.
   * Overrides `signal` from creation-time options.
   */
  signal?: AbortSignal;
  /**
   * Factory to create per-run context. Can be async.
   * Overrides `createContext` from creation-time options.
   */
  createContext?: () => C | Promise<C>;
  /**
   * Resume state for workflow replay. Can be a factory function (sync or async).
   * Overrides `resumeState` from creation-time options.
   */
  resumeState?: ResumeState | (() => ResumeState | Promise<ResumeState>);
  /**
   * Hook to check if workflow should run (concurrency control).
   * Overrides `shouldRun` from creation-time options.
   */
  shouldRun?: (workflowId: string, context: C) => boolean | Promise<boolean>;
  /**
   * Hook called before workflow execution starts.
   * Overrides `onBeforeStart` from creation-time options.
   */
  onBeforeStart?: (workflowId: string, context: C) => boolean | Promise<boolean>;
  /**
   * Hook called after each step completes (only for steps with a `key`).
   * Overrides `onAfterStep` from creation-time options.
   */
  onAfterStep?: (
    stepKey: string,
    result: Result<unknown, unknown, unknown>,
    workflowId: string,
    context: C
  ) => void | Promise<void>;
};

/**
 * Non-strict workflow options
 * Returns E | UnexpectedError (safe default)
 */
export type WorkflowOptions<E, C = void> = {
  /** Short description for labels/tooltips (static analysis) */
  description?: string;
  /** Full markdown documentation (static analysis) */
  markdown?: string;
  onError?: (error: E | UnexpectedError, stepName?: string, ctx?: C) => void;
  /**
   * Unified event stream for workflow and step lifecycle.
   *
   * Context is automatically included in `event.context` when provided via `createContext`.
   * The separate `ctx` parameter is provided for convenience.
   */
  onEvent?: (event: WorkflowEvent<E | UnexpectedError, C>, ctx: C) => void;
  /** Create per-run context for event correlation */
  createContext?: () => C;
  /** Step result cache - only steps with a `key` option are cached */
  cache?: StepCache;
  /** Pre-populate cache from saved state for workflow resume */
  resumeState?: ResumeState | (() => ResumeState | Promise<ResumeState>);
  /**
   * External AbortSignal for workflow-level cancellation.
   *
   * Returns WorkflowCancelledError when:
   * - Abort is signaled before the workflow starts
   * - Abort occurs between steps
   * - A step throws AbortError (e.g., from fetch respecting the signal)
   * - Abort fires during the last step but the step completes successfully (late cancellation)
   *
   * Typed errors are preserved: if a step returns `err("KNOWN_ERROR")` even while
   * abort is signaled, that typed error is returned (not masked as cancellation).
   *
   * Steps using `step.withTimeout(..., { signal: true })` receive an AbortSignal
   * that fires on EITHER timeout OR workflow cancellation.
   *
   * @example
   * ```typescript
   * const controller = new AbortController();
   * const workflow = createWorkflow(deps, { signal: controller.signal });
   *
   * // Cancel workflow from outside
   * setTimeout(() => controller.abort('timeout'), 5000);
   *
   * // Inside workflow: signal fires on timeout OR workflow cancellation
   * const data = await step.withTimeout(
   *   (signal) => fetch(url, { signal }),
   *   { ms: 3000, signal: true }
   * );
   * ```
   */
  signal?: AbortSignal;
  /**
   * Hook called before workflow execution starts.
   * Return `false` to skip workflow execution (useful for distributed locking, queue checking).
   * @param workflowId - Unique ID for this workflow run
   * @param context - Context object from createContext (or void if not provided)
   * @returns `true` to proceed, `false` to skip workflow execution
   */
  onBeforeStart?: (workflowId: string, context: C) => boolean | Promise<boolean>;
  /**
   * Hook called after each step completes (only for steps with a `key`).
   * Useful for checkpointing to external systems (queues, streams, databases).
   * @param stepKey - The key of the completed step
   * @param result - The step's result (success or error)
   * @param workflowId - Unique ID for this workflow run
   * @param context - Context object from createContext (or void if not provided)
   */
  onAfterStep?: (
    stepKey: string,
    result: Result<unknown, unknown, unknown>,
    workflowId: string,
    context: C
  ) => void | Promise<void>;
  /**
   * Hook to check if workflow should run (concurrency control).
   * Called before onBeforeStart. Return `false` to skip workflow execution.
   * @param workflowId - Unique ID for this workflow run
   * @param context - Context object from createContext (or void if not provided)
   * @returns `true` to proceed, `false` to skip workflow execution
   */
  shouldRun?: (workflowId: string, context: C) => boolean | Promise<boolean>;
  /**
   * Stream store for streaming data within the workflow.
   * Use with step.getWritable() and step.getReadable().
   *
   * @example
   * ```typescript
   * import { createMemoryStreamStore } from 'awaitly/streaming';
   *
   * const workflow = createWorkflow(deps, {
   *   streamStore: createMemoryStreamStore(),
   * });
   * ```
   */
  streamStore?: StreamStore;
  catchUnexpected?: never;  // prevent footgun: can't use without strict: true
  strict?: false;           // default
};

/**
 * Strict workflow options
 * Returns E | U (closed error union)
 */
export type WorkflowOptionsStrict<E, U, C = void> = {
  strict: true;              // discriminator
  catchUnexpected: (cause: unknown) => U;
  /** Short description for labels/tooltips (static analysis) */
  description?: string;
  /** Full markdown documentation (static analysis) */
  markdown?: string;
  onError?: (error: E | U, stepName?: string, ctx?: C) => void;
  /**
   * Unified event stream for workflow and step lifecycle.
   *
   * Context is automatically included in `event.context` when provided via `createContext`.
   * The separate `ctx` parameter is provided for convenience.
   */
  onEvent?: (event: WorkflowEvent<E | U, C>, ctx: C) => void;
  /** Create per-run context for event correlation */
  createContext?: () => C;
  /** Step result cache - only steps with a `key` option are cached */
  cache?: StepCache;
  /** Pre-populate cache from saved state for workflow resume */
  resumeState?: ResumeState | (() => ResumeState | Promise<ResumeState>);
  /**
   * External AbortSignal for workflow-level cancellation.
   *
   * Cancellation behavior:
   * - Non-strict mode: Returns WorkflowCancelledError, emits workflow_cancelled event
   * - Strict mode with catchUnexpected: Returns WorkflowCancelledError mapped through catchUnexpected
   * - Late cancellation: If abort fires during the last step but the step completes successfully,
   *   the workflow still returns WorkflowCancelledError (in both modes)
   *
   * Note: If a step throws AbortError (e.g., from fetch respecting the signal):
   * - Non-strict mode: Recognized as cancellation → WorkflowCancelledError
   * - Strict mode: Treated as regular error mapped by catchUnexpected (no special handling)
   *
   * Steps using `step.withTimeout(..., { signal: true })` receive an AbortSignal
   * that fires on EITHER timeout OR workflow cancellation.
   */
  signal?: AbortSignal;
  /**
   * Hook called before workflow execution starts.
   * Return `false` to skip workflow execution (useful for distributed locking, queue checking).
   * @param workflowId - Unique ID for this workflow run
   * @param context - Context object from createContext (or void if not provided)
   * @returns `true` to proceed, `false` to skip workflow execution
   */
  onBeforeStart?: (workflowId: string, context: C) => boolean | Promise<boolean>;
  /**
   * Hook called after each step completes (only for steps with a `key`).
   * Useful for checkpointing to external systems (queues, streams, databases).
   * @param stepKey - The key of the completed step
   * @param result - The step's result (success or error)
   * @param workflowId - Unique ID for this workflow run
   * @param context - Context object from createContext (or void if not provided)
   */
  onAfterStep?: (
    stepKey: string,
    result: Result<unknown, unknown, unknown>,
    workflowId: string,
    context: C
  ) => void | Promise<void>;
  /**
   * Hook to check if workflow should run (concurrency control).
   * Called before onBeforeStart. Return `false` to skip workflow execution.
   * @param workflowId - Unique ID for this workflow run
   * @param context - Context object from createContext (or void if not provided)
   * @returns `true` to proceed, `false` to skip workflow execution
   */
  shouldRun?: (workflowId: string, context: C) => boolean | Promise<boolean>;
  /**
   * Stream store for streaming data within the workflow.
   * Use with step.getWritable() and step.getReadable().
   */
  streamStore?: StreamStore;
};

/**
 * Workflow context provided to callbacks, containing workflow metadata.
 * This allows conditional helpers and other utilities to access workflowId, onEvent, and context.
 */
export type WorkflowContext<C = void> = {
  /**
   * Unique ID for this workflow run.
   */
  workflowId: string;

  /**
   * Event emitter function for workflow events.
   * Can be used with conditional helpers to emit step_skipped events.
   */
  onEvent?: (event: WorkflowEvent<unknown, C>) => void;

  /**
   * Per-run context created by createContext (or undefined if not provided).
   * Automatically included in all workflow events.
   */
  context?: C;

  /**
   * Workflow-level AbortSignal (if provided in workflow options).
   * Use this to check cancellation or pass to operations that support AbortSignal.
   *
   * @example
   * ```typescript
   * const result = await workflow(async (step, deps, ctx) => {
   *   // Pass signal to fetch
   *   const response = await fetch(url, { signal: ctx.signal });
   *   // Or check manually
   *   if (ctx.signal?.aborted) return early();
   * });
   * ```
   */
  signal?: AbortSignal;
};

/** Workflow function type (no args) */
export type WorkflowFn<T, E, Deps, C = void> = (step: RunStep<E>, deps: Deps, ctx: WorkflowContext<C>) => T | Promise<T>;

/** Workflow function type (with args) */
export type WorkflowFnWithArgs<T, Args, E, Deps, C = void> = (step: RunStep<E>, deps: Deps, args: Args, ctx: WorkflowContext<C>) => T | Promise<T>;

/**
 * Workflow return type (non-strict)
 * Supports both argument-less and argument-passing call patterns
 *
 * Note: Cause type is `unknown` because:
 * - step.try errors have thrown values as cause
 * - Uncaught exceptions produce unknown causes
 * - Different steps may have different cause types
 * The cause IS preserved at runtime; narrow based on error type if needed.
 */
export interface Workflow<E, Deps, C = void> {
  /**
   * Execute workflow without arguments (original API)
   * @param fn - Callback receives (step, deps, ctx) where ctx is workflow context (always provided)
   */
  <T>(fn: WorkflowFn<T, E, Deps, C>): AsyncResult<T, E | UnexpectedError, unknown>;

  /**
   * Execute workflow with typed arguments
   * @param args - Typed arguments passed to the callback (type inferred at call site)
   * @param fn - Callback receives (step, deps, args, ctx) where ctx is workflow context (always provided)
   */
  <T, Args>(
    args: Args,
    fn: WorkflowFnWithArgs<T, Args, E, Deps, C>
  ): AsyncResult<T, E | UnexpectedError, unknown>;

  /**
   * Execute workflow with execution-time options (no args).
   * Use this when you need per-run hooks/options.
   * @param fn - Callback receives (step, deps, ctx)
   * @param exec - Execution-time options that override creation-time options
   */
  run<T>(fn: WorkflowFn<T, E, Deps, C>, exec?: ExecutionOptions<E, C>): AsyncResult<T, E | UnexpectedError, unknown>;

  /**
   * Execute workflow with execution-time options (with args).
   * Use this when you need per-run hooks/options.
   * @param args - Typed arguments passed to the callback
   * @param fn - Callback receives (step, deps, args, ctx)
   * @param exec - Execution-time options that override creation-time options
   */
  run<T, Args>(args: Args, fn: WorkflowFnWithArgs<T, Args, E, Deps, C>, exec?: ExecutionOptions<E, C>): AsyncResult<T, E | UnexpectedError, unknown>;

  /**
   * Create a new workflow with pre-bound execution options.
   * Options can be further overridden by `.run()`.
   * @param exec - Execution-time options to pre-bind
   * @returns A new Workflow with the options pre-bound
   *
   * @example
   * ```typescript
   * const visualized = workflow.with({ onEvent: viz.handleEvent });
   * await visualized(async (step) => { ... }); // Uses viz.handleEvent
   *
   * // Chaining works
   * const w = workflow.with({ onEvent }).with({ signal });
   * await w.run(fn, { onError }); // All three options active
   * ```
   */
  with(exec: ExecutionOptions<E, C>): Workflow<E, Deps, C>;
}

/**
 * Execution-time options for strict mode workflows.
 * Excludes `catchUnexpected` since that's fixed at creation time.
 */
export type ExecutionOptionsStrict<E, U, C = void> = {
  onEvent?: (event: WorkflowEvent<E | U, C>, ctx: C) => void;
  onError?: (error: E | U, stepName?: string, ctx?: C) => void;
  signal?: AbortSignal;
  createContext?: () => C | Promise<C>;
  resumeState?: ResumeState | (() => ResumeState | Promise<ResumeState>);
  shouldRun?: (workflowId: string, context: C) => boolean | Promise<boolean>;
  onBeforeStart?: (workflowId: string, context: C) => boolean | Promise<boolean>;
  onAfterStep?: (
    stepKey: string,
    result: Result<unknown, unknown, unknown>,
    workflowId: string,
    context: C
  ) => void | Promise<void>;
};

/**
 * Workflow return type (strict)
 * Supports both argument-less and argument-passing call patterns
 *
 * Note: Cause type is `unknown` because catchUnexpected receives thrown
 * values which have unknown type.
 */
export interface WorkflowStrict<E, U, Deps, C = void> {
  /**
   * Execute workflow without arguments (original API)
   * @param fn - Callback receives (step, deps, ctx) where ctx is workflow context (always provided)
   */
  <T>(fn: WorkflowFn<T, E, Deps, C>): AsyncResult<T, E | U, unknown>;

  /**
   * Execute workflow with typed arguments
   * @param args - Typed arguments passed to the callback (type inferred at call site)
   * @param fn - Callback receives (step, deps, args, ctx) where ctx is workflow context (always provided)
   */
  <T, Args>(
    args: Args,
    fn: WorkflowFnWithArgs<T, Args, E, Deps, C>
  ): AsyncResult<T, E | U, unknown>;

  /**
   * Execute workflow with execution-time options (no args).
   * Use this when you need per-run hooks/options.
   */
  run<T>(fn: WorkflowFn<T, E, Deps, C>, exec?: ExecutionOptionsStrict<E, U, C>): AsyncResult<T, E | U, unknown>;

  /**
   * Execute workflow with execution-time options (with args).
   * Use this when you need per-run hooks/options.
   */
  run<T, Args>(args: Args, fn: WorkflowFnWithArgs<T, Args, E, Deps, C>, exec?: ExecutionOptionsStrict<E, U, C>): AsyncResult<T, E | U, unknown>;

  /**
   * Create a new workflow with pre-bound execution options.
   * Options can be further overridden by `.run()`.
   */
  with(exec: ExecutionOptionsStrict<E, U, C>): WorkflowStrict<E, U, Deps, C>;
}

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
 * - `UnexpectedError` is added for uncaught exceptions (unless strict mode)
 *
 * ## Strict Mode
 *
 * Use `strict: true` with `catchUnexpected` for closed error unions:
 * - Removes `UnexpectedError` from the union
 * - All errors must be explicitly handled
 * - Useful for production code where you want exhaustive error handling
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
 *   - `strict`: Enable strict mode (requires `catchUnexpected`)
 *   - `catchUnexpected`: Map uncaught exceptions to typed errors (required in strict mode)
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
 * const result = await getPosts(async (step) => {
 *   const user = await step(fetchUser('1'));
 *   const posts = await step(fetchPosts(user.id));
 *   return { user, posts };
 * });
 * // result.error: 'NOT_FOUND' | 'FETCH_ERROR' | UnexpectedError
 * ```
 *
 * @example
 * ```typescript
 * // With destructuring in callback (optional but convenient)
 * const result = await getPosts(async (step, { fetchUser, fetchPosts }) => {
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
 *     strict: true,
 *     catchUnexpected: () => 'UNEXPECTED' as const
 *   }
 * );
 * // result.error: 'NOT_FOUND' | 'FETCH_ERROR' | 'UNEXPECTED' (exactly)
 * ```
 *
 * @example
 * ```typescript
 * // With step caching - both patterns work identically
 * const cache = new Map<string, Result<unknown, unknown>>();
 * const workflow = createWorkflow({ fetchUser }, { cache });
 *
 * const result = await workflow(async (step) => {
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
 * const result = await workflow(async (step) => {
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
 *   async (step, { fetchUser, fetchPosts }, { userId }) => {
 *     const user = await step(fetchUser(userId));
 *     const posts = await step(fetchPosts(user.id));
 *     return { user, posts };
 *   }
 * );
 * ```
 */
export function createWorkflow<
  const Deps extends Readonly<Record<string, AnyResultFn>>,
  C = void
>(
  deps: Deps,
  options?: WorkflowOptions<ErrorsOfDeps<Deps>, C>
): Workflow<ErrorsOfDeps<Deps>, Deps, C>;

export function createWorkflow<
  const Deps extends Readonly<Record<string, AnyResultFn>>,
  U,
  C = void
>(
  deps: Deps,
  options: WorkflowOptionsStrict<ErrorsOfDeps<Deps>, U, C>
): WorkflowStrict<ErrorsOfDeps<Deps>, U, Deps, C>;

// Implementation
export function createWorkflow<
  const Deps extends Readonly<Record<string, AnyResultFn>>,
  U = never,
  C = void
>(
  deps: Deps,
  options?: WorkflowOptions<ErrorsOfDeps<Deps>, C> | WorkflowOptionsStrict<ErrorsOfDeps<Deps>, U, C>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  type E = ErrorsOfDeps<Deps>;
  type ExecOpts = ExecutionOptions<E, C> | ExecutionOptionsStrict<E, U, C>;

  // ===========================================================================
  // Helper: normalizeCall - extract args and fn from call signature
  // ===========================================================================
  type NormalizedCall<T, Args> =
    | { args: undefined; fn: WorkflowFn<T, E, Deps, C> }
    | { args: Args; fn: WorkflowFnWithArgs<T, Args, E, Deps, C> };

  function normalizeCall<T>(
    arg1: WorkflowFn<T, E, Deps, C>
  ): { args: undefined; fn: WorkflowFn<T, E, Deps, C> };
  function normalizeCall<T, Args>(
    arg1: Args,
    arg2: WorkflowFnWithArgs<T, Args, E, Deps, C>
  ): { args: Args; fn: WorkflowFnWithArgs<T, Args, E, Deps, C> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function normalizeCall(arg1: any, arg2?: any): NormalizedCall<any, any> {
    // Runtime guard for misuse
    if (typeof arg1 !== "function" && typeof arg2 !== "function") {
      throw new TypeError("workflow(args?, fn, ...): fn must be a function");
    }
    // If arg2 is a function, we're in the "with args" pattern: workflow(args, fn)
    // This correctly handles functions as args (e.g., workflow(requestFactory, callback))
    return typeof arg2 === "function"
      ? { args: arg1, fn: arg2 }
      : { args: undefined, fn: arg1 };
  }

  // ===========================================================================
  // Helper: pickExec - extract execution options from .run() call signature
  // ===========================================================================
  // For .run(fn, exec) -> exec is a2
  // For .run(args, fn, exec) -> exec is a3
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function pickExec(_a1: any, a2: any, a3: any): ExecOpts | undefined {
    // If a2 is a function, we have .run(args, fn, exec?) pattern -> exec is a3
    // Otherwise, we have .run(fn, exec?) pattern -> exec is a2
    return (typeof a2 === "function" ? a3 : a2) as ExecOpts | undefined;
  }

  // ===========================================================================
  // Internal execute function - core workflow execution logic
  // ===========================================================================
  async function internalExecute<T, Args = undefined>(
    normalized: NormalizedCall<T, Args>,
    exec?: ExecOpts
  ): Promise<Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>> {
    const { args, fn: userFn } = normalized;
    const hasArgs = args !== undefined;

    // Detect common mistake: passing options to executor instead of createWorkflow
    // Only warn if the object contains ONLY option keys (no other properties)
    // This avoids false positives for legitimate args like { cache: true, userId: '123' }
    if (hasArgs && typeof args === "object" && args !== null) {
      const KNOWN_OPTION_KEYS = new Set([
        "cache", "onEvent", "resumeState", "onError", "onBeforeStart",
        "onAfterStep", "shouldRun", "createContext", "signal", "strict",
        "catchUnexpected", "description", "markdown", "streamStore"
      ]);
      const argKeys = Object.keys(args as object);
      const matchedOptions = argKeys.filter(k => KNOWN_OPTION_KEYS.has(k));
      const nonOptionKeys = argKeys.filter(k => !KNOWN_OPTION_KEYS.has(k));

      // Only warn if ALL keys are option keys (pure options object, not args with coincidental names)
      if (matchedOptions.length > 0 && nonOptionKeys.length === 0) {
        console.warn(
          `awaitly: Detected workflow options (${matchedOptions.join(", ")}) ` +
          `passed to workflow executor. Options are ignored here.\n` +
          `Pass options to createWorkflow() instead:\n` +
          `  const workflow = createWorkflow(deps, { ${matchedOptions.join(", ")} });\n` +
          `  await workflow(async (step) => { ... });`
        );
      }
    }

    // Generate workflowId for this run
    const workflowId = crypto.randomUUID();

    // ===========================================================================
    // Resolve hooks: exec?.x ?? options?.x (execution-time overrides creation-time)
    // Note: exec.x = undefined does NOT override (uses creation-time)
    //       exec.x = null DOES override (users asked for it)
    // ===========================================================================

    // Create context for this run (exec overrides options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createContextFn = exec?.createContext ?? (options as any)?.createContext;
    const context = createContextFn ? await createContextFn() : undefined as C;

    // Get workflow-level signal (exec overrides options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workflowSignal = (exec?.signal ?? (options as any)?.signal) as AbortSignal | undefined;

    // Get event handler (exec overrides options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onEventHandler = exec?.onEvent ?? (options as any)?.onEvent;

    // Get error handler (exec overrides options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onErrorHandler = exec?.onError ?? (options as any)?.onError;

    // Get shouldRun hook (exec overrides options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shouldRunHook = (exec?.shouldRun ?? (options as any)?.shouldRun) as
      | ((workflowId: string, context: C) => boolean | Promise<boolean>)
      | undefined;

    // Get onBeforeStart hook (exec overrides options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onBeforeStartHook = (exec?.onBeforeStart ?? (options as any)?.onBeforeStart) as
      | ((workflowId: string, context: C) => boolean | Promise<boolean>)
      | undefined;

    // Get onAfterStep hook (exec overrides options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onAfterStepHook = (exec?.onAfterStep ?? (options as any)?.onAfterStep) as
      | ((
          stepKey: string,
          result: Result<unknown, unknown, unknown>,
          workflowId: string,
          context: C
        ) => void | Promise<void>)
      | undefined;

    // Get resumeState (exec overrides options) - keep lazy, only evaluate when needed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resumeStateOption = (exec?.resumeState ?? (options as any)?.resumeState) as
      | ResumeState
      | (() => ResumeState | Promise<ResumeState>)
      | undefined;

    // Get catchUnexpected for strict mode (only from creation-time options - cannot be overridden)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const catchUnexpected = (options as any)?.catchUnexpected as
      | ((cause: unknown) => U)
      | undefined;

    // Create workflow context object to pass to callback
    const workflowContext: WorkflowContext<C> = {
      workflowId,
      onEvent: onEventHandler as ((event: WorkflowEvent<unknown, C>) => void) | undefined,
      context: context !== undefined ? context : undefined,
      signal: workflowSignal,
    };

    // Helper to emit workflow events
    const emitEvent = (event: WorkflowEvent<E | U | UnexpectedError, C>) => {
      // Add context to event only if:
      // 1. Event doesn't already have context (preserves replayed events or per-step overrides)
      // 2. Workflow actually has a context (don't add context: undefined property)
      const eventWithContext =
        event.context !== undefined || context === undefined
          ? event
          : ({ ...event, context: context as C } as WorkflowEvent<E | U | UnexpectedError, C>);
      onEventHandler?.(eventWithContext, context);
    };

    // Helper to create cancellation result
    const createCancelledResult = (reason?: string, lastStepKey?: string): Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown> => {
      const cancelledError: WorkflowCancelledError = {
        type: "WORKFLOW_CANCELLED",
        reason,
        lastStepKey,
      };
      // In strict mode, map through catchUnexpected
      if (catchUnexpected) {
        return err(catchUnexpected(cancelledError)) as Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>;
      }
      // In non-strict mode, return WorkflowCancelledError directly
      return err(cancelledError) as Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>;
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
          // Workflow skipped - in strict mode, run through catchUnexpected
          const skipCause = new Error("Workflow skipped by shouldRun hook");
          if (catchUnexpected) {
            const mappedError = catchUnexpected(skipCause);
            return err(mappedError) as Result<T, E | U | UnexpectedError, unknown>;
          }
          const skipError: UnexpectedError = {
            type: "UNEXPECTED_ERROR",
            cause: {
              type: "UNCAUGHT_EXCEPTION",
              thrown: skipCause,
            },
          };
          return err(skipError) as Result<T, E | U | UnexpectedError, unknown>;
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
        // Hook threw - wrap in Result to maintain "always returns Result" contract
        if (catchUnexpected) {
          const mappedError = catchUnexpected(thrown);
          return err(mappedError) as Result<T, E | U | UnexpectedError, unknown>;
        }
        const hookError: UnexpectedError = {
          type: "UNEXPECTED_ERROR",
          cause: {
            type: "UNCAUGHT_EXCEPTION",
            thrown,
          },
        };
        return err(hookError) as Result<T, E | U | UnexpectedError, unknown>;
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
          // Workflow skipped - in strict mode, run through catchUnexpected
          const skipCause = new Error("Workflow skipped by onBeforeStart hook");
          if (catchUnexpected) {
            const mappedError = catchUnexpected(skipCause);
            return err(mappedError) as Result<T, E | U | UnexpectedError, unknown>;
          }
          const skipError: UnexpectedError = {
            type: "UNEXPECTED_ERROR",
            cause: {
              type: "UNCAUGHT_EXCEPTION",
              thrown: skipCause,
            },
          };
          return err(skipError) as Result<T, E | U | UnexpectedError, unknown>;
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
        // Hook threw - wrap in Result to maintain "always returns Result" contract
        if (catchUnexpected) {
          const mappedError = catchUnexpected(thrown);
          return err(mappedError) as Result<T, E | U | UnexpectedError, unknown>;
        }
        const hookError: UnexpectedError = {
          type: "UNEXPECTED_ERROR",
          cause: {
            type: "UNCAUGHT_EXCEPTION",
            thrown,
          },
        };
        return err(hookError) as Result<T, E | U | UnexpectedError, unknown>;
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

    // Get cache from options (cache is NOT overridable via exec - only from creation-time)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cache = (options as any)?.cache as StepCache | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streamStore = (options as any)?.streamStore as StreamStore | undefined;

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

    // Helper to parse step options
    const parseStepOptions = (opts?: StepOptions | string): { name?: string; key?: string; ttl?: number } => {
      if (typeof opts === "string") return { name: opts };
      return opts ?? {};
    };

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
      result: Result<unknown, unknown, unknown>
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

      // Wrap the main step function
      const cachedStepFn = async <StepT, StepE extends E, StepC = unknown>(
        operationOrResult:
          | (() => Result<StepT, StepE, StepC> | AsyncResult<StepT, StepE, StepC>)
          | Result<StepT, StepE, StepC>
          | AsyncResult<StepT, StepE, StepC>,
        stepOptions?: StepOptions | string
      ): Promise<StepT> => {
        const { name, key, ttl } = parseStepOptions(stepOptions);

        // Check for cancellation before starting step
        // Use lastStepKey (last completed step) for reporting, not the step about to run
        checkCancellation();

        // Update lastStepKey AFTER the step completes (moved to success/error handlers below)
        // This ensures lastStepKey always means "last successfully completed keyed step"

        // Only use cache if key is provided and cache exists
        if (key && cache && cache.has(key)) {
          // Cache hit
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

        // Execute the real step - wrap in function form to satisfy overload
        const wrappedOp = typeof operationOrResult === "function"
          ? operationOrResult
          : () => operationOrResult;

        try {
          const value = await realStep(wrappedOp, stepOptions);
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
            await callOnAfterStepHook(key, errorResult);
          }
          throw thrown;
        }
      };

      // Wrap step.try
      cachedStepFn.try = async <StepT, Err extends E>(
        operation: () => StepT | Promise<StepT>,
        opts:
          | { error: Err; name?: string; key?: string; ttl?: number }
          | { onError: (cause: unknown) => Err; name?: string; key?: string; ttl?: number }
      ): Promise<StepT> => {
        const { name, key, ttl } = opts;

        // Only use cache if key is provided and cache exists
        if (key && cache && cache.has(key)) {
          // Cache hit
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
          // Cached error - throw early exit with preserved metadata (origin + thrown)
          // This bypasses realStep.try to avoid replaying instrumentation
          const meta = decodeCachedMeta(cached.cause);
          throw createEarlyExit(cached.error as Err, meta);
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

        // Execute the real step.try
        try {
          const value = await realStep.try(operation, opts);
          // Cache successful result if key provided
          if (key) {
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
            const exit = thrown as EarlyExit<Err>;
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
            await callOnAfterStepHook(key, errorResult);
          }
          throw thrown;
        }
      };

      // Wrap step.fromResult - delegate to real step (caching handled by key in opts)
      cachedStepFn.fromResult = async <StepT, ResultE, Err extends E>(
        operation: () => Result<StepT, ResultE, unknown> | AsyncResult<StepT, ResultE, unknown>,
        opts:
          | { error: Err; name?: string; key?: string; ttl?: number }
          | { onError: (resultError: ResultE) => Err; name?: string; key?: string; ttl?: number }
      ): Promise<StepT> => {
        const { name, key, ttl } = opts;

        // Only use cache if key is provided and cache exists
        if (key && cache && cache.has(key)) {
          // Cache hit
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
          // Cached error - throw early exit with preserved metadata
          const meta = decodeCachedMeta(cached.cause);
          throw createEarlyExit(cached.error as Err, meta);
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

        // Execute the real step.fromResult
        try {
          const value = await realStep.fromResult(operation, opts);
          // Cache successful result if key provided
          if (key) {
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
            const exit = thrown as EarlyExit<Err>;
            const originalCause =
              exit.meta.origin === "result"
                ? exit.meta.resultCause
                : exit.meta.thrown;
            const errorResult = encodeCachedError(exit.error, exit.meta, originalCause);
            if (cache) {
              cache.set(key, errorResult, ttl ? { ttl } : undefined);
            }
            // Call onAfterStep hook for checkpointing (even on error, even without cache)
            await callOnAfterStepHook(key, errorResult);
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

      // Wrap step.retry - use cachedStepFn to ensure caching/resume works with keyed steps
      cachedStepFn.retry = <StepT, StepE extends E, StepC = unknown>(
        operation: () => Result<StepT, StepE, StepC> | AsyncResult<StepT, StepE, StepC>,
        options: RetryOptions & { name?: string; key?: string; timeout?: TimeoutOptions; ttl?: number }
      ): Promise<StepT> => {
        // Delegate to cachedStepFn with retry options merged into StepOptions
        // This ensures the cache layer is consulted for keyed steps
        return cachedStepFn(operation, {
          name: options.name,
          key: options.key,
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
        });
      };

      // Wrap step.withTimeout - use cachedStepFn to ensure caching/resume works with keyed steps
      cachedStepFn.withTimeout = <StepT, StepE extends E, StepC = unknown>(
        operation:
          | (() => Result<StepT, StepE, StepC> | AsyncResult<StepT, StepE, StepC>)
          | ((signal: AbortSignal) => Result<StepT, StepE, StepC> | AsyncResult<StepT, StepE, StepC>),
        options: TimeoutOptions & { name?: string; key?: string; ttl?: number }
      ): Promise<StepT> => {
        // Delegate to cachedStepFn with timeout options
        // This ensures the cache layer is consulted for keyed steps
        return cachedStepFn(
          operation as () => Result<StepT, StepE, StepC> | AsyncResult<StepT, StepE, StepC>,
          {
            name: options.name,
            key: options.key,
            timeout: options,
            ttl: options.ttl,
          }
        );
      };

      // Wrap step.sleep - implement caching directly to ensure cache layer is consulted
      cachedStepFn.sleep = (
        duration: string | DurationType,
        options?: { name?: string; key?: string; ttl?: number; description?: string }
      ): Promise<void> => {
        // Parse duration
        const d = typeof duration === "string" ? parseDuration(duration) : duration;
        if (!d) {
          throw new Error(`step.sleep: invalid duration '${duration}'`);
        }
        const ms = toMillis(d);

        // Generate step name
        const stepName =
          options?.name ?? `sleep ${typeof duration === "string" ? duration : `${ms}ms`}`;

        // Delegate to cachedStepFn (not realStep) to ensure caching works
        return cachedStepFn(
          async (): AsyncResult<void, never> => {
            // Check if already aborted
            if (workflowSignal?.aborted) {
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

              state.timeoutId = setTimeout(() => {
                workflowSignal?.removeEventListener("abort", onAbort);
                resolve(ok(undefined));
              }, ms);
            });
          },
          {
            name: stepName,
            key: options?.key,
            ttl: options?.ttl,
            description: options?.description,
          }
        );
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
            let hasSeenMetadata = false;

            // Check initial state
            const initialMetaResult = await streamStore.getMetadata(workflowId, namespace);
            hasSeenMetadata = initialMetaResult.ok && initialMetaResult.value !== undefined;

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
        const name = options?.name;
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
          const stepName = name ? `${name}:item-${itemPosition}` : undefined;

          const stepResult = await cachedStepFn(
            () => processor(item, itemIndex),
            { name: stepName, key: stepKey }
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

      return cachedStepFn as RunStep<E>;
    };

    // Wrap the user's callback to pass cached step, deps, args (when present), and workflow context
    const wrappedFn = hasArgs
      ? (step: RunStep<E>) => (userFn as (step: RunStep<E>, deps: Deps, args: Args, ctx: WorkflowContext<C>) => T | Promise<T>)(createCachedStep(step), deps, args as Args, workflowContext)
      : (step: RunStep<E>) => (userFn as (step: RunStep<E>, deps: Deps, ctx: WorkflowContext<C>) => T | Promise<T>)(createCachedStep(step), deps, workflowContext);

    let result: Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>;

    try {
      if (options?.strict === true) {
        // Strict mode - use run.strict for closed error union
        result = await run.strict<T, E | U, C>(wrappedFn as (step: RunStep<E | U>) => Promise<T> | T, {
          onError: onErrorHandler as ((error: E | U, stepName?: string, ctx?: C) => void) | undefined,
          onEvent: onEventHandler as ((event: WorkflowEvent<E | U | UnexpectedError, C>, ctx: C) => void) | undefined,
          catchUnexpected: catchUnexpected as (cause: unknown) => U,
          workflowId,
          context,
          _workflowSignal: workflowSignal,
        });
      } else {
        // Non-strict mode - use run with onError for typed errors + UnexpectedError
        result = await run<T, E, C>(wrappedFn as (step: RunStep<E | UnexpectedError>) => Promise<T> | T, {
          onError: onErrorHandler ?? (() => {}),
          onEvent: onEventHandler,
          workflowId,
          context,
          _workflowSignal: workflowSignal,
        });
      }
    } finally {
      // Clean up abort listener
      if (workflowSignal) {
        workflowSignal.removeEventListener("abort", abortHandler);
      }
    }

    const durationMs = performance.now() - startTime;

    // Check if the error is a wrapped WorkflowCancelledError
    // There are two paths:
    // 1. Non-strict mode: run() wraps it as UnexpectedError { cause: { type: 'UNCAUGHT_EXCEPTION', thrown: WorkflowCancelledError } }
    // 2. Strict mode with catchUnexpected: run() already mapped it, result.cause is WorkflowCancelledError
    if (!result.ok) {
      let cancelledError: WorkflowCancelledError | undefined;
      let alreadyMapped = false;

      // Path 1: Non-strict mode - check UnexpectedError wrapper
      if (isUnexpectedError(result.error)) {
        const unexpectedCause = result.error.cause;
        if (
          unexpectedCause &&
          typeof unexpectedCause === "object" &&
          "type" in unexpectedCause &&
          unexpectedCause.type === "UNCAUGHT_EXCEPTION" &&
          "thrown" in unexpectedCause &&
          isWorkflowCancelled(unexpectedCause.thrown)
        ) {
          cancelledError = unexpectedCause.thrown as WorkflowCancelledError;
        }
      }

      // Path 2: Strict mode - check result.cause directly
      // In this case, run() already called catchUnexpected, so result.error is already mapped
      if (!cancelledError && isWorkflowCancelled(result.cause)) {
        cancelledError = result.cause as WorkflowCancelledError;
        alreadyMapped = true; // Don't call catchUnexpected again
      }

      // Path 3: AbortError during abort in NON-STRICT mode.
      // In strict mode, the user's catchUnexpected already mapped the error - let that
      // mapping stand and emit workflow_error (not workflow_cancelled) for consistency.
      // In non-strict mode, ONLY treat as cancellation if:
      // 1. Abort was signaled during execution
      // 2. The error is an UnexpectedError (thrown exception)
      // 3. The thrown error is specifically an AbortError (name === "AbortError")
      // Other exceptions are preserved as UnexpectedError to avoid masking real errors.
      if (!cancelledError && abortedDuringExecution && !catchUnexpected && isUnexpectedError(result.error)) {
        // Extract the thrown error from the UnexpectedError wrapper
        const unexpectedCause = result.error.cause;
        let thrownError: unknown;
        if (
          unexpectedCause &&
          typeof unexpectedCause === "object" &&
          "type" in unexpectedCause &&
          unexpectedCause.type === "UNCAUGHT_EXCEPTION" &&
          "thrown" in unexpectedCause
        ) {
          thrownError = unexpectedCause.thrown;
        }

        // Check if it's an AbortError (use duck typing for cross-runtime compatibility)
        const isAbortError = thrownError != null &&
          typeof thrownError === "object" &&
          "name" in thrownError &&
          thrownError.name === "AbortError";

        if (isAbortError) {
          const reason = abortReason ?? (
            typeof workflowSignal?.reason === "string"
              ? workflowSignal.reason
              : workflowSignal?.reason instanceof Error
                ? workflowSignal.reason.message
                : undefined
          );
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
        // Path 1: Non-strict mode - return the original WorkflowCancelledError
        // Path 2: Strict mode - return result as-is (already has mapped error)
        if (alreadyMapped) {
          // result.error is already the mapped error from catchUnexpected
          return result as Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>;
        }
        return err(cancelledError) as Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>;
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
      // Use createCancelledResult pattern for consistent strict mode handling
      const cancelledError: WorkflowCancelledError = {
        type: "WORKFLOW_CANCELLED",
        reason,
        lastStepKey,
      };
      if (catchUnexpected) {
        return err(catchUnexpected(cancelledError)) as Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>;
      }
      return err(cancelledError) as Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>;
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
        error: result.error as E | U | UnexpectedError,
      });
    }

    // Cast is safe because WorkflowCancelledError case was handled above
    return result as Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>;
  }

  // ===========================================================================
  // Create the workflow executor object with callable, run, and with methods
  // ===========================================================================

  // Callable workflow executor function
  // Signature 1: No args (original API)
  function workflowExecutor<T>(
    fn: WorkflowFn<T, E, Deps, C>
  ): Promise<Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>>;
  // Signature 2: With args (new API)
  function workflowExecutor<T, Args>(
    args: Args,
    fn: WorkflowFnWithArgs<T, Args, E, Deps, C>
  ): Promise<Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>>;
  // Implementation
  function workflowExecutor<T, Args = undefined>(
    fnOrArgs: WorkflowFn<T, E, Deps, C> | Args,
    maybeFn?: WorkflowFnWithArgs<T, Args, E, Deps, C>
  ): Promise<Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const normalized = normalizeCall(fnOrArgs as any, maybeFn as any);
    // Cast is safe because T flows through internalExecute
    return internalExecute(normalized) as Promise<Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>>;
  }

  // Add .run() method for execution-time options
  // Signature 1: No args
  function runWithOptions<T>(
    fn: WorkflowFn<T, E, Deps, C>,
    exec?: ExecOpts
  ): Promise<Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>>;
  // Signature 2: With args
  function runWithOptions<T, Args>(
    args: Args,
    fn: WorkflowFnWithArgs<T, Args, E, Deps, C>,
    exec?: ExecOpts
  ): Promise<Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>>;
  // Implementation
  function runWithOptions<T, Args = undefined>(
    fnOrArgs: WorkflowFn<T, E, Deps, C> | Args,
    maybeFnOrExec?: WorkflowFnWithArgs<T, Args, E, Deps, C> | ExecOpts,
    maybeExec?: ExecOpts
  ): Promise<Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const normalized = normalizeCall(fnOrArgs as any, typeof maybeFnOrExec === "function" ? maybeFnOrExec as any : undefined);
    const exec = pickExec(fnOrArgs, maybeFnOrExec, maybeExec);
    // Cast is safe because T flows through internalExecute
    return internalExecute(normalized, exec) as Promise<Result<T, E | U | UnexpectedError | WorkflowCancelledError, unknown>>;
  }

  // Add .with() method for pre-binding execution options
  function withOptions(boundExec: ExecOpts): Workflow<E, Deps, C> | WorkflowStrict<E, U, Deps, C> {
    // Capture early to avoid monkeypatching issues
    const baseRun = runWithOptions;

    // Create callable that uses boundExec
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped: any = <T, Args = undefined>(
      fnOrArgs: WorkflowFn<T, E, Deps, C> | Args,
      maybeFn?: WorkflowFnWithArgs<T, Args, E, Deps, C>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): any => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const normalized = normalizeCall(fnOrArgs as any, maybeFn as any);
      return normalized.args === undefined
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? baseRun(normalized.fn as any, boundExec as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : baseRun(normalized.args as any, normalized.fn as any, boundExec as any);
    };

    // Add .run() that merges boundExec with callerExec
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wrapped.run = (fnOrArgs: any, maybeFnOrExec?: any, maybeExec?: any): any => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const normalized = normalizeCall(fnOrArgs as any, typeof maybeFnOrExec === "function" ? maybeFnOrExec as any : undefined);
      const callerExec = pickExec(fnOrArgs, maybeFnOrExec, maybeExec);
      // Merge: caller exec overrides bound exec
      const merged = { ...boundExec, ...(callerExec ?? {}) };
      return normalized.args === undefined
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? baseRun(normalized.fn as any, merged as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : baseRun(normalized.args as any, normalized.fn as any, merged as any);
    };

    // Add .with() that chains options
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wrapped.with = (more: ExecOpts) => withOptions({ ...boundExec, ...more } as any);

    return wrapped as Workflow<E, Deps, C> | WorkflowStrict<E, U, Deps, C>;
  }

  // Attach methods to workflowExecutor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (workflowExecutor as any).run = runWithOptions;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (workflowExecutor as any).with = withOptions;

  return workflowExecutor as Workflow<E, Deps, C> | WorkflowStrict<E, U, Deps, C>;
}

// =============================================================================
// Type Guard Helpers
// =============================================================================

/**
 * Type guard to check if an event is a step_complete event.
 * Use this to filter events for state persistence.
 *
 * @param event - The workflow event to check
 * @returns `true` if the event is a step_complete event, `false` otherwise
 *
 * @example
 * ```typescript
 * const savedSteps = new Map<string, Result<unknown, unknown>>();
 *
 * const workflow = createWorkflow({ fetchUser }, {
 *   onEvent: (event) => {
 *     if (isStepComplete(event)) {
 *       savedSteps.set(event.stepKey, event.result);
 *     }
 *   }
 * });
 * ```
 */
export function isStepComplete(
  event: WorkflowEvent<unknown>
): event is Extract<WorkflowEvent<unknown>, { type: "step_complete" }> {
  return event.type === "step_complete";
}

// =============================================================================
// Workflow Cancellation
// =============================================================================

/**
 * Error returned when a workflow is cancelled via AbortSignal.
 *
 * @example
 * ```typescript
 * const controller = new AbortController();
 * const workflow = createWorkflow(deps, { signal: controller.signal });
 *
 * // Later:
 * controller.abort('User navigated away');
 *
 * const result = await workflowPromise;
 * if (!result.ok && isWorkflowCancelled(result.error)) {
 *   console.log('Cancelled:', result.error.reason);
 * }
 * ```
 */
export type WorkflowCancelledError = {
  type: "WORKFLOW_CANCELLED";
  /** Reason from AbortSignal.reason (if provided) */
  reason?: string;
  /** Last successfully completed keyed step (for resume purposes) */
  lastStepKey?: string;
};

/**
 * Type guard to check if an error is a WorkflowCancelledError.
 *
 * @param error - The error to check
 * @returns `true` if the error is a WorkflowCancelledError, `false` otherwise
 */
export function isWorkflowCancelled(error: unknown): error is WorkflowCancelledError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as WorkflowCancelledError).type === "WORKFLOW_CANCELLED"
  );
}

// =============================================================================
// Human-in-the-Loop (HITL) Support
// =============================================================================

/**
 * Standard error type for steps awaiting human approval.
 * Use this as the error type for approval-gated steps.
 *
 * @example
 * const requireApproval = async (userId: string): AsyncResult<Approval, PendingApproval> => {
 *   const status = await checkApprovalStatus(userId);
 *   if (status === 'pending') {
 *     return err({ type: 'PENDING_APPROVAL', stepKey: `approval:${userId}` });
 *   }
 *   return ok(status.approval);
 * };
 */
export type PendingApproval = {
  type: "PENDING_APPROVAL";
  /** Step key for correlation when resuming */
  stepKey: string;
  /** Optional reason for the pending state */
  reason?: string;
  /** Optional metadata for the approval request */
  metadata?: Record<string, unknown>;
};

/**
 * Error returned when approval is rejected.
 */
export type ApprovalRejected = {
  type: "APPROVAL_REJECTED";
  /** Step key for correlation */
  stepKey: string;
  /** Reason the approval was rejected */
  reason: string;
};

/**
 * Type guard to check if an error is a PendingApproval.
 *
 * @param error - The error to check
 * @returns `true` if the error is a PendingApproval, `false` otherwise
 *
 * @example
 * ```typescript
 * const result = await workflow(...);
 * if (!result.ok && isPendingApproval(result.error)) {
 *   console.log(`Waiting for approval: ${result.error.stepKey}`);
 * }
 * ```
 */
export function isPendingApproval(error: unknown): error is PendingApproval {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as PendingApproval).type === "PENDING_APPROVAL"
  );
}

/**
 * Type guard to check if an error is an ApprovalRejected.
 *
 * @param error - The error to check
 * @returns `true` if the error is an ApprovalRejected, `false` otherwise
 */
export function isApprovalRejected(error: unknown): error is ApprovalRejected {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as ApprovalRejected).type === "APPROVAL_REJECTED"
  );
}

/**
 * Create a PendingApproval error result.
 * Convenience helper for approval-gated steps.
 *
 * @param stepKey - Stable key for this approval step (used for resume)
 * @param options - Optional reason and metadata for the pending approval
 * @returns A Result with a PendingApproval error
 *
 * @example
 * ```typescript
 * const requireApproval = async (userId: string) => {
 *   const status = await db.getApproval(userId);
 *   if (!status) return pendingApproval(`approval:${userId}`);
 *   return ok(status);
 * };
 * ```
 */
export function pendingApproval(
  stepKey: string,
  options?: { reason?: string; metadata?: Record<string, unknown> }
): Err<PendingApproval> {
  return err({
    type: "PENDING_APPROVAL",
    stepKey,
    reason: options?.reason,
    metadata: options?.metadata,
  });
}

/**
 * Options for creating an approval-gated step.
 */
export interface ApprovalStepOptions<T> {
  /** Stable key for this approval step (used for resume) */
  key: string;
  /** Function to check current approval status from external source */
  checkApproval: () => Promise<
    | { status: "pending" }
    | { status: "approved"; value: T }
    | { status: "rejected"; reason: string }
  >;
  /** Optional reason shown when pending */
  pendingReason?: string;
  /** Optional metadata for the approval request */
  metadata?: Record<string, unknown>;
}

/**
 * Create a Result-returning function that checks external approval status.
 *
 * ## When to Use
 *
 * Use `createApprovalStep` when you need:
 * - **Human-in-the-loop workflows**: Steps that require human approval
 * - **External approval systems**: Integrate with approval databases/APIs
 * - **Workflow pausing**: Workflows that pause and resume after approval
 * - **Approval tracking**: Track who approved what and when
 *
 * ## Why Use This Instead of Manual Approval Checks
 *
 * - **Standardized pattern**: Consistent approval step interface
 * - **Type-safe**: Returns typed `PendingApproval` or `ApprovalRejected` errors
 * - **Resume-friendly**: Works seamlessly with `injectApproval()` and resume state
 * - **Metadata support**: Can include approval reason and metadata
 *
 * ## How It Works
 *
 * 1. Create approval step with `checkApproval` function
 * 2. `checkApproval` returns one of:
 *    - `{ status: 'pending' }` - Approval not yet granted (workflow pauses)
 *    - `{ status: 'approved', value: T }` - Approval granted (workflow continues)
 *    - `{ status: 'rejected', reason: string }` - Approval rejected (workflow fails)
 * 3. Use in workflow with `step()` - workflow pauses if pending
 * 4. When approval granted externally, use `injectApproval()` to resume
 *
 * ## Typical Approval Flow
 *
 * 1. Workflow executes → reaches approval step
 * 2. `checkApproval()` called → returns `{ status: 'pending' }`
 * 3. Workflow returns `PendingApproval` error
 * 4. Save workflow state → persist for later resume
 * 5. Show approval UI → user sees pending approval
 * 6. User grants/rejects → update approval system
 * 7. Inject approval → call `injectApproval()` with approved value
 * 8. Resume workflow → continue from approval step
 *
 * @param options - Configuration for the approval step:
 *   - `key`: Stable key for this approval (must match step key in workflow)
 *   - `checkApproval`: Async function that checks current approval status
 *   - `pendingReason`: Optional reason shown when approval is pending
 *   - `metadata`: Optional metadata attached to the approval request
 *
 * @returns A function that returns an AsyncResult checking approval status.
 *          The function can be used directly with `step()` in workflows.
 *
 * @example
 * ```typescript
 * // Create approval step that checks database
 * const requireManagerApproval = createApprovalStep<{ approvedBy: string }>({
 *   key: 'manager-approval',
 *   checkApproval: async () => {
 *     const approval = await db.getApproval('manager-approval');
 *     if (!approval) {
 *       return { status: 'pending' }; // Workflow pauses here
 *     }
 *     if (approval.rejected) {
 *       return { status: 'rejected', reason: approval.reason };
 *     }
 *     return {
 *       status: 'approved',
 *       value: { approvedBy: approval.approvedBy }
 *     };
 *   },
 *   pendingReason: 'Waiting for manager approval',
 * });
 *
 * // Use in workflow
 * const workflow = createWorkflow({ requireManagerApproval });
 * const result = await workflow(async (step) => {
 *   const approval = await step(requireManagerApproval, { key: 'manager-approval' });
 *   // If pending, workflow exits with PendingApproval error
 *   // If approved, continues with approval value
 *   return approval;
 * });
 *
 * // Handle pending state
 * if (!result.ok && isPendingApproval(result.error)) {
 *   // Workflow paused - show approval UI
 *   showApprovalUI(result.error.stepKey);
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With approval injection for resume
 * const collector = createApprovalStateCollector();
 * const workflow = createWorkflow({ requireApproval }, {
 *   onEvent: collector.handleEvent,
 * });
 *
 * const result = await workflow(async (step) => {
 *   const approval = await step(requireApproval, { key: 'approval:1' });
 *   return approval;
 * });
 *
 * // When approval granted externally
 * if (collector.hasPendingApprovals()) {
 *   const resumeState = collector.injectApproval('approval:1', {
 *     approvedBy: 'admin@example.com'
 *   });
 *
 *   // Resume workflow
 *   const workflow2 = createWorkflow({ requireApproval }, { resumeState });
 *   const result2 = await workflow2(async (step) => {
 *     const approval = await step(requireApproval, { key: 'approval:1' });
 *     return approval; // Now succeeds with injected value
 *   });
 * }
 * ```
 */
export function createApprovalStep<T>(
  options: ApprovalStepOptions<T>
): () => AsyncResult<T, PendingApproval | ApprovalRejected> {
  return async (): AsyncResult<T, PendingApproval | ApprovalRejected> => {
    const result = await options.checkApproval();

    switch (result.status) {
      case "pending":
        return err({
          type: "PENDING_APPROVAL",
          stepKey: options.key,
          reason: options.pendingReason,
          metadata: options.metadata,
        });
      case "rejected":
        return err({
          type: "APPROVAL_REJECTED",
          stepKey: options.key,
          reason: result.reason,
        });
      case "approved":
        return ok(result.value);
    }
  };
}

// =============================================================================
// Pre-Execution Gating (AI SDK / LangChain-style tool confirmation)
// =============================================================================

/**
 * Options for creating a gated (pre-approval) step.
 */
export interface GatedStepOptions<TArgs, T> {
  /** Stable key for this gated step (used for approval tracking) */
  key: string;

  /**
   * Condition to check if approval is required.
   * If returns true, execution pauses for approval.
   * If returns false, operation executes immediately.
   */
  requiresApproval: boolean | ((args: TArgs) => boolean | Promise<boolean>);

  /**
   * Human-readable description of what this operation does.
   * Shown in the approval UI so humans understand what they're approving.
   */
  description: string | ((args: TArgs) => string);

  /**
   * Check if approval has been granted externally.
   * If not provided, the step always returns PendingApproval when gated.
   */
  checkApproval?: () => Promise<
    | { status: "pending" }
    | { status: "approved"; value?: T }
    | { status: "rejected"; reason: string }
  >;

  /**
   * Optional metadata to include in the approval request.
   * The args are automatically included as `pendingArgs`.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Create a gated step that requires approval before execution.
 *
 * This is the AI SDK / LangChain-style pattern where you intercept
 * tool calls *before* they execute, allowing humans to see the args
 * and approve, edit, or reject before the operation runs.
 *
 * ## When to Use
 *
 * Use `gatedStep` when you want to:
 * - **Show args before execution**: Let humans see what the operation will do
 * - **Allow editing args**: Humans can modify args before operation runs
 * - **Conditional gating**: Only require approval for certain conditions
 * - **AI safety**: Gate dangerous AI tool calls (send email, delete file, etc.)
 *
 * ## Difference from createApprovalStep
 *
 * - `createApprovalStep`: Checks external approval status, operation already defined
 * - `gatedStep`: Gates before operation, shows args, allows editing, then executes
 *
 * ## Flow
 *
 * 1. Call gatedStep with args
 * 2. Check if approval is required (based on requiresApproval condition)
 * 3. If required and not approved:
 *    - Return PendingApproval with args visible in metadata
 *    - Human sees: "Send email to external@example.com with subject X"
 *    - Human can approve (run as-is), edit (modify args), or reject
 * 4. If approved or not required:
 *    - Execute the operation with (potentially edited) args
 *
 * @param operation - The operation to gate (a function returning AsyncResult)
 * @param options - Gating configuration
 * @returns A gated function that checks approval before execution
 *
 * @example
 * ```typescript
 * // Gate external email sends
 * const sendEmail = async (to: string, subject: string, body: string) => { ... };
 *
 * const gatedSendEmail = gatedStep(
 *   sendEmail,
 *   {
 *     key: 'email',
 *     requiresApproval: (args) => !args.to.endsWith('@mycompany.com'),
 *     description: (args) => `Send email to ${args.to}: "${args.subject}"`,
 *   }
 * );
 *
 * // In workflow:
 * const result = await step(
 *   () => gatedSendEmail({ to: 'external@other.com', subject: 'Hello', body: '...' }),
 *   { key: 'send-welcome-email' }
 * );
 *
 * // If gated, returns PendingApproval with:
 * // {
 * //   stepKey: 'email',
 * //   reason: 'Send email to external@other.com: "Hello"',
 * //   metadata: { pendingArgs: { to: '...', subject: '...', body: '...' } }
 * // }
 * ```
 *
 * @example
 * ```typescript
 * // Gate file deletion with explicit approval check
 * const gatedDelete = gatedStep(
 *   (path: string) => deleteFile(path),
 *   {
 *     key: 'delete-file',
 *     requiresApproval: true, // Always require approval
 *     description: (args) => `Delete file: ${args.path}`,
 *     checkApproval: () => approvalStore.getApproval('delete-file'),
 *   }
 * );
 * ```
 */
export function gatedStep<TArgs extends Record<string, unknown>, T, E>(
  operation: (args: TArgs) => AsyncResult<T, E>,
  options: GatedStepOptions<TArgs, T>
): (args: TArgs) => AsyncResult<T, E | PendingApproval | ApprovalRejected> {
  return async (args: TArgs): AsyncResult<T, E | PendingApproval | ApprovalRejected> => {
    // Check if approval is required
    const requiresApproval =
      typeof options.requiresApproval === "function"
        ? await options.requiresApproval(args)
        : options.requiresApproval;

    if (!requiresApproval) {
      // No approval needed - execute immediately
      return operation(args);
    }

    // Approval is required - check if already approved
    if (options.checkApproval) {
      const approvalStatus = await options.checkApproval();

      switch (approvalStatus.status) {
        case "approved":
          // Approved - execute the operation
          return operation(args);
        case "rejected":
          return err({
            type: "APPROVAL_REJECTED",
            stepKey: options.key,
            reason: approvalStatus.reason,
          });
        case "pending":
          // Fall through to return pending
          break;
      }
    }

    // Return pending approval with args visible
    const description =
      typeof options.description === "function"
        ? options.description(args)
        : options.description;

    return err({
      type: "PENDING_APPROVAL",
      stepKey: options.key,
      reason: description,
      metadata: {
        ...options.metadata,
        pendingArgs: args,
        gatedOperation: true,
      },
    });
  };
}

// =============================================================================
// Resume State Helpers for HITL
// =============================================================================

/**
 * Inject an approved value into resume state.
 * Use this when an external approval is granted and you want to resume the workflow.
 *
 * @param state - The resume state to update
 * @param options - Object with stepKey and the approved value
 * @returns A new ResumeState with the approval injected
 *
 * @example
 * ```typescript
 * // When approval is granted externally:
 * const updatedState = injectApproval(savedState, {
 *   stepKey: 'deploy:prod',
 *   value: { approvedBy: 'admin', approvedAt: Date.now() }
 * });
 *
 * // Resume workflow with the approval injected
 * const workflow = createWorkflow({ ... }, { resumeState: updatedState });
 * ```
 */
export function injectApproval<T>(
  state: ResumeState,
  options: { stepKey: string; value: T }
): ResumeState {
  const newSteps = new Map(state.steps);
  newSteps.set(options.stepKey, {
    result: ok(options.value),
  });
  return { steps: newSteps };
}

/**
 * Remove a step from resume state (e.g., to force re-execution).
 * This is an immutable operation - returns a new ResumeState without modifying the original.
 *
 * @param state - The resume state to update
 * @param stepKey - The key of the step to remove
 * @returns A new ResumeState with the step removed (original is unchanged)
 *
 * @example
 * ```typescript
 * // Force a step to re-execute on resume
 * const updatedState = clearStep(savedState, 'approval:123');
 * ```
 */
export function clearStep(state: ResumeState, stepKey: string): ResumeState {
  const newSteps = new Map(state.steps);
  newSteps.delete(stepKey);
  return { steps: newSteps };
}

/**
 * Check if a step in resume state has a pending approval error.
 *
 * @param state - The resume state to check
 * @param stepKey - The key of the step to check
 * @returns `true` if the step has a pending approval, `false` otherwise
 *
 * @example
 * ```typescript
 * if (hasPendingApproval(savedState, 'deploy:prod')) {
 *   // Show approval UI
 * }
 * ```
 */
export function hasPendingApproval(
  state: ResumeState,
  stepKey: string
): boolean {
  const entry = state.steps.get(stepKey);
  if (!entry || entry.result.ok) return false;
  return isPendingApproval(entry.result.error);
}

/**
 * Get all pending approval step keys from resume state.
 *
 * @param state - The resume state to check
 * @returns Array of step keys that have pending approvals
 *
 * @example
 * ```typescript
 * const pendingKeys = getPendingApprovals(savedState);
 * // ['deploy:prod', 'deploy:staging']
 * ```
 */
export function getPendingApprovals(state: ResumeState): string[] {
  const pending: string[] = [];
  for (const [key, entry] of state.steps) {
    if (!entry.result.ok && isPendingApproval(entry.result.error)) {
      pending.push(key);
    }
  }
  return pending;
}

// =============================================================================
// Enhanced Collector for HITL
// =============================================================================

/**
 * Extended resume state collector that tracks pending approvals.
 * Use this for human-in-the-loop workflows that need to track approval state.
 *
 * @returns An object with methods to handle events, get state, and manage approvals
 *
 * @example
 * ```typescript
 * const collector = createApprovalStateCollector();
 *
 * const workflow = createWorkflow({ fetchUser, requireApproval }, {
 *   onEvent: collector.handleEvent,
 * });
 *
 * const result = await workflow(async (step) => {
 *   const user = await step(() => fetchUser("1"), { key: "user:1" });
 *   const approval = await step(requireApproval, { key: "approval:1" });
 *   return { user, approval };
 * });
 *
 * // Check for pending approvals
 * if (collector.hasPendingApprovals()) {
 *   const pending = collector.getPendingApprovals();
 *   // pending: [{ stepKey: 'approval:1', error: PendingApproval }]
 *   await saveToDatabase(collector.getResumeState());
 * }
 *
 * // Later, when approved:
 * const resumeState = collector.injectApproval('approval:1', { approvedBy: 'admin' });
 * ```
 */
export function createApprovalStateCollector(): {
  /** Handle workflow events. Pass this to workflow's `onEvent` option. */
  handleEvent: (event: WorkflowEvent<unknown>) => void;
  /** Get the collected resume state. Call after workflow execution. */
  getResumeState: () => ResumeState;
  /** Clears the collector's internal recorded entries (does not mutate workflow state). */
  clear: () => void;
  /** Check if any steps have pending approvals */
  hasPendingApprovals: () => boolean;
  /** Get all pending approval entries with their errors */
  getPendingApprovals: () => Array<{ stepKey: string; error: PendingApproval }>;
  /** Inject an approval result, updating the collector's internal state. Returns a copy for use as resumeState. */
  injectApproval: <T>(stepKey: string, value: T) => ResumeState;
} {
  const steps = new Map<string, ResumeStateEntry>();

  return {
    handleEvent: (event: WorkflowEvent<unknown>) => {
      if (isStepComplete(event)) {
        steps.set(event.stepKey, { result: event.result, meta: event.meta });
      }
    },
    getResumeState: () => ({ steps: new Map(steps) }),
    clear: () => steps.clear(),
    hasPendingApprovals: () => {
      for (const entry of steps.values()) {
        if (!entry.result.ok && isPendingApproval(entry.result.error)) {
          return true;
        }
      }
      return false;
    },
    getPendingApprovals: () => {
      const pending: Array<{ stepKey: string; error: PendingApproval }> = [];
      for (const [key, entry] of steps) {
        if (!entry.result.ok && isPendingApproval(entry.result.error)) {
          pending.push({ stepKey: key, error: entry.result.error as PendingApproval });
        }
      }
      return pending;
    },
    injectApproval: <T>(stepKey: string, value: T): ResumeState => {
      // Mutate internal state so collector reflects the approval
      steps.set(stepKey, { result: ok(value) });
      // Return a copy for use as resumeState
      return { steps: new Map(steps) };
    },
  };
}
