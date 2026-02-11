/**
 * Workflow type definitions.
 * Pure types and interfaces; no runtime code.
 */

import type {
  Result,
  StepFailureMeta,
  WorkflowEvent,
  UnexpectedError,
  ErrorOf,
  CauseOf,
  RunStep,
  AsyncResult,
} from "../core";
import type { JSONValue, WorkflowSnapshot } from "../persistence";
import type { StreamStore } from "../streaming/types";

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
export type ExecutionOptions<E, U = UnexpectedError, C = void> = {
  /**
   * Event handler for workflow and step lifecycle events.
   * Overrides `onEvent` from creation-time options.
   */
  onEvent?: (event: WorkflowEvent<E | U, C>, ctx: C) => void;
  /**
   * Error handler called when a step fails.
   * Overrides `onError` from creation-time options.
   */
  onError?: (error: E | U, stepName?: string, ctx?: C) => void;
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
  /**
   * Enable strict mode for this specific run (analyzer validation only).
   */
  strict?: boolean;
  /**
   * Enable development warnings for this run.
   * Only active when NODE_ENV !== 'production'.
   */
  devWarnings?: boolean;
};

/**
 * Workflow options. Error union is always closed: E | U.
 * When catchUnexpected is omitted, U defaults to UnexpectedError (legacy shape).
 */
export type WorkflowOptions<E, U = UnexpectedError, C = void, Errs extends readonly string[] = readonly string[]> = {
  /** Short description for labels/tooltips (static analysis) */
  description?: string;
  /** Full markdown documentation (static analysis) */
  markdown?: string;
  /**
   * Map uncaught exceptions (and cancellation) to your error type U.
   * When omitted, U = UnexpectedError and the default mapper returns the legacy UnexpectedError object.
   */
  catchUnexpected?: (cause: unknown) => U;
  /**
   * Declared errors for the workflow (strict validation).
   * When provided, the analyzer validates that computed errors match declared errors.
   */
  errors?: Errs;
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
  /** Pre-populate cache from saved state for workflow resume. Prefer `snapshot` option. */
  resumeState?: ResumeState | (() => ResumeState | Promise<ResumeState>);
  /**
   * Restore workflow from a previously saved snapshot.
   * Pass `null` for fresh start (e.g., when store.load() returns nothing).
   */
  snapshot?: WorkflowSnapshot | null;
  /**
   * Custom serialization for encoding/decoding values during snapshot operations.
   */
  serialization?: {
    encode?: (value: unknown) => JSONValue;
    decode?: (value: JSONValue) => unknown;
  };
  snapshotSerialization?: {
    strict?: boolean;
  };
  onUnknownSteps?: "warn" | "error" | "ignore";
  onDefinitionChange?: "warn" | "error" | "ignore";
  /**
   * External AbortSignal for workflow-level cancellation.
   * Cancellation is mapped through catchUnexpected (default: UnexpectedError with cause.thrown = WorkflowCancelledError).
   */
  signal?: AbortSignal;
  onBeforeStart?: (workflowId: string, context: C) => boolean | Promise<boolean>;
  onAfterStep?: (
    stepKey: string,
    result: Result<unknown, unknown, unknown>,
    workflowId: string,
    context: C
  ) => void | Promise<void>;
  shouldRun?: (workflowId: string, context: C) => boolean | Promise<boolean>;
  streamStore?: StreamStore;
  /**
   * Enable development warnings.
   * Only active when NODE_ENV !== 'production'.
   */
  devWarnings?: boolean;
};

/**
 * Workflow context provided to callbacks, containing workflow metadata
 * and data store for step outputs.
 * This allows conditional helpers and other utilities to access workflowId, onEvent, and context.
 */
export type WorkflowContext<C = void, Input = Record<string, unknown>, Data = Record<string, unknown>> = {
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

  // ==========================================================================
  // Data Store (for static analysis)
  // ==========================================================================

  /**
   * Input data passed to the workflow.
   * Access via `ctx.input.key` for static analysis tracking.
   *
   * @example
   * ```typescript
   * await step('getCart', () => getCart(ctx.input.cartId), {
   *   errors: ['CART_NOT_FOUND'],
   * });
   * ```
   */
  input: Input;

  /**
   * Get a value from the workflow data store by key.
   * Preferred over `ctx.get()` for static analysis as it's easier to trace.
   *
   * @param key - The key to retrieve
   * @returns The value at that key
   *
   * @example
   * ```typescript
   * // Use ctx.ref() inside step callbacks for tracked dependencies
   * await step('charge', () => chargeCard(ctx.ref('cart').total), {
   *   errors: ['CARD_DECLINED'],
   * });
   * ```
   */
  ref: <K extends keyof Data>(key: K) => Data[K];

  /**
   * Set a value in the workflow data store.
   * Prefer using `out` option on steps instead for better static analysis.
   *
   * @param key - The key to set
   * @param value - The value to store
   *
   * @example
   * ```typescript
   * // Prefer out option:
   * await step('getCart', () => getCart(id), { out: 'cart' });
   *
   * // Escape hatch (less analyzable):
   * const cart = await step('getCart', () => getCart(id));
   * ctx.set('cart', cart);
   * ```
   */
  set: <K extends string>(key: K, value: unknown) => void;

  /**
   * Get a value from the workflow data store.
   * Prefer `ctx.ref()` for better static analysis.
   *
   * @param key - The key to retrieve
   * @returns The value at that key (or undefined)
   */
  get: <K extends keyof Data>(key: K) => Data[K] | undefined;
};

/** Workflow function type (no args) */
export type WorkflowFn<T, E, Deps, C = void> = (step: RunStep<E>, deps: Deps, ctx: WorkflowContext<C>) => T | Promise<T>;

/** Workflow function type (with args) */
export type WorkflowFnWithArgs<T, Args, E, Deps, C = void> = (step: RunStep<E>, deps: Deps, args: Args, ctx: WorkflowContext<C>) => T | Promise<T>;

// =============================================================================
// Snapshot API Types
// =============================================================================

/**
 * Options for getSnapshot().
 */
export interface GetSnapshotOptions {
  /** Additional metadata to include in the snapshot */
  metadata?: Record<string, JSONValue>;
  /** Which steps to include: 'all', 'completed', or 'failed'. Default: 'all' */
  include?: "all" | "completed" | "failed";
  /** Maximum number of steps to include (undefined = no limit) */
  limit?: number;
  /** For incremental snapshots: only include steps after this step ID */
  sinceStepId?: string;
  /** Override workflow-level strict mode for this snapshot. Default: workflow setting */
  strict?: boolean;
}

/**
 * Event emitted by subscribe().
 */
export interface SubscribeEvent {
  type: "step_complete" | "workflow_complete" | "workflow_error";
  stepId?: string;
  snapshot: WorkflowSnapshot;
}

/**
 * Options for subscribe().
 */
export interface SubscribeOptions {
  /** Execution mode: 'sync' blocks workflow, 'async' uses microtask queue. Default: 'sync' */
  mode?: "sync" | "async";
  /** Coalesce behavior for async mode: 'none' keeps all events, 'latest' keeps only latest. Default: 'none' */
  coalesce?: "none" | "latest";
}

/**
 * Workflow return type. Error union is always closed: E | U (default U = UnexpectedError).
 * Supports both argument-less and argument-passing call patterns.
 *
 * Cause type is `unknown` because step.try/catchUnexpected receive thrown values.
 */
export interface Workflow<E, U = UnexpectedError, Deps = unknown, C = void> {
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
   * @param fn - Callback receives (step, deps, ctx)
   * @param exec - Execution-time options that override creation-time options
   */
  run<T>(fn: WorkflowFn<T, E, Deps, C>, exec?: ExecutionOptions<E, U, C>): AsyncResult<T, E | U, unknown>;

  /**
   * Execute workflow with execution-time options (with args).
   * @param args - Typed arguments passed to the callback
   * @param fn - Callback receives (step, deps, args, ctx)
   * @param exec - Execution-time options that override creation-time options
   */
  run<T, Args>(args: Args, fn: WorkflowFnWithArgs<T, Args, E, Deps, C>, exec?: ExecutionOptions<E, U, C>): AsyncResult<T, E | U, unknown>;

  /**
   * Create a new workflow with pre-bound execution options.
   * Options can be further overridden by `.run()`.
   */
  with(exec: ExecutionOptions<E, U, C>): Workflow<E, U, Deps, C>;

  /** Workflow name (from createWorkflow first argument). */
  readonly name: string;
  /** Dependencies passed to createWorkflow. */
  readonly deps: Deps;
  /** Options passed to createWorkflow. */
  readonly options?: WorkflowOptions<E, U, C>;

  /**
   * Get a JSON-serializable snapshot of the workflow state.
   * Returns a deep copy (via structuredClone) of the current state.
   */
  getSnapshot(options?: GetSnapshotOptions): WorkflowSnapshot;

  /** Current workflow snapshot (read-only). Alias for getSnapshot(); creates a new copy on each access. */
  readonly snapshot: WorkflowSnapshot;

  /**
   * Subscribe to workflow events for auto-persistence.
   * Returns an unsubscribe function.
   */
  subscribe(
    listener: (event: SubscribeEvent) => void,
    options?: SubscribeOptions
  ): () => void;
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

// =============================================================================
// Human-in-the-Loop (HITL) Types
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
 * Standard error type for steps awaiting an HTTP callback (webhook).
 * Use with injectHook() to resume when the app receives the callback.
 * stepKey is always "hook:" + hookId for resume state.
 */
export type PendingHook = {
  type: "PENDING_HOOK";
  hookId: string;
  /** Step key used in resume state; always "hook:" + hookId */
  stepKey: string;
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
