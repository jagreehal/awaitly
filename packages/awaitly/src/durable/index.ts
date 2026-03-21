/**
 * awaitly/durable
 *
 * Durable execution with automatic state persistence.
 * Workflows automatically checkpoint after each keyed step and can resume from any point.
 */

import {
  err,
  type Result,
  type WorkflowEvent,
  type RunStep,
  type UnexpectedError,
} from "../core";
import {
  createWorkflow,
  createResumeStateCollector,
} from "../workflow";
import type {
  AnyResultFn,
  ErrorsOfDeps,
  WorkflowOptions,
  WorkflowContext,
  WorkflowCancelledError,
  Workflow,
} from "../workflow/types";
import {
  type SnapshotStore,
  type WorkflowSnapshot,
  type StepResult,
  type JSONValue,
  mergeSnapshots,
  assertValidSnapshot,
  SnapshotFormatError,
  SnapshotDecodeError,
  serializeError,
  serializeThrown,
} from "../persistence";

// Re-export for convenience
export { type SnapshotStore } from "../persistence";
export { isWorkflowCancelled } from "../workflow";
export type { WorkflowCancelledError } from "../workflow/types";

// In-memory store for zero-config usage
let defaultStore: SnapshotStore | undefined;

function createMemorySnapshotStore(): SnapshotStore {
  const store = new Map<string, { snapshot: WorkflowSnapshot; updatedAt: Date }>();

  return {
    async save(id: string, snapshot: WorkflowSnapshot): Promise<void> {
      store.set(id, { snapshot, updatedAt: new Date() });
    },

    async load(id: string): Promise<WorkflowSnapshot | null> {
      const entry = store.get(id);
      return entry?.snapshot ?? null;
    },

    async delete(id: string): Promise<void> {
      store.delete(id);
    },

    async list(options?: { prefix?: string; limit?: number }): Promise<Array<{ id: string; updatedAt: string }>> {
      const prefix = options?.prefix ?? "";
      const limit = options?.limit ?? 100;
      const results: Array<{ id: string; updatedAt: string }> = [];

      for (const [id, entry] of store.entries()) {
        if (prefix && !id.startsWith(prefix)) continue;
        results.push({ id, updatedAt: entry.updatedAt.toISOString() });
        if (results.length >= limit) break;
      }

      // Sort by updatedAt descending
      results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return results;
    },

    async close(): Promise<void> {
      // No-op for memory store
    },
  };
}

function getDefaultStore(): SnapshotStore {
  if (defaultStore === undefined) {
    defaultStore = createMemorySnapshotStore();
  }
  return defaultStore;
}

// =============================================================================
// Durable Execution Types
// =============================================================================

/**
 * Error returned when workflow cannot resume due to version mismatch.
 * Indicates the stored state was created with a different workflow version.
 * Fail-fast contract: bump version when you change step keys, order, or outputs.
 */
export type VersionMismatchError = {
  type: "VERSION_MISMATCH";
  /** Workflow execution ID */
  workflowId: string;
  /** Version stored in persisted state */
  storedVersion: number;
  /** Version requested by this run */
  requestedVersion: number;
  /** Guidance message with suggested actions */
  message: string;
  /** Use requestedVersion. */
  currentVersion?: number;
};

/**
 * Error returned when workflow execution is rejected due to concurrent run.
 */
export type ConcurrentExecutionError = {
  type: "CONCURRENT_EXECUTION";
  /** The workflow ID that is already running */
  workflowId: string;
  /** Guidance message */
  message: string;
  /**
   * Distinguishes in-process (activeWorkflows) from cross-process (lock held).
   * Enables debuggability and branching without parsing the message.
   */
  reason?: "in-process" | "cross-process";
};

/**
 * Error returned when a persistence store operation fails.
 */
export type PersistenceError = {
  type: "PERSISTENCE_ERROR";
  /** The operation that failed */
  operation: "load" | "save" | "delete";
  /** The workflow ID */
  workflowId: string;
  /** The underlying error */
  cause: unknown;
  /** Guidance message */
  message: string;
};

/**
 * Type guard to check if an error is a VersionMismatchError.
 */
export function isVersionMismatch(error: unknown): error is VersionMismatchError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as VersionMismatchError).type === "VERSION_MISMATCH"
  );
}

/**
 * Type guard to check if an error is a ConcurrentExecutionError.
 */
export function isConcurrentExecution(error: unknown): error is ConcurrentExecutionError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as ConcurrentExecutionError).type === "CONCURRENT_EXECUTION"
  );
}

/**
 * Type guard to check if an error is a PersistenceError.
 */
export function isPersistenceError(error: unknown): error is PersistenceError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as PersistenceError).type === "PERSISTENCE_ERROR"
  );
}

/**
 * Error returned when a workflow's lease expires mid-execution.
 * Indicates the lock was lost and another process may have reclaimed the workflow.
 */
export type LeaseExpiredError = {
  type: "LEASE_EXPIRED";
  /** The workflow ID whose lease expired */
  workflowId: string;
  /** Guidance message */
  message: string;
};

/**
 * Type guard to check if an error is a LeaseExpiredError.
 */
export function isLeaseExpired(error: unknown): error is LeaseExpiredError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as LeaseExpiredError).type === "LEASE_EXPIRED"
  );
}

/**
 * Error returned when an idempotency key is reused with different input.
 */
export type IdempotencyConflictError = {
  type: "IDEMPOTENCY_CONFLICT";
  idempotencyKey: string;
  workflowId: string;
  message: string;
};

export function isIdempotencyConflict(error: unknown): error is IdempotencyConflictError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as IdempotencyConflictError).type === "IDEMPOTENCY_CONFLICT"
  );
}

/**
 * Optional cross-process lock interface.
 * When a store implements this, durable.run uses it to ensure only one process
 * runs a given workflow ID at a time (when allowConcurrent is false).
 *
 * Uses a lease (TTL) + owner token so a crashed worker does not wedge a workflow
 * indefinitely. Release must verify the owner token so one process never
 * unlocks another's lease.
 *
 * Mid-run lock loss (e.g. lease expires during a long workflow) is handled
 * adapter-side; core assumes the lock is held until release in finally.
 * Adapters may implement heartbeats/renewal.
 */
export interface WorkflowLock {
  /**
   * Try to acquire a lease for the workflow ID.
   * @param id - Workflow execution ID
   * @param options - Optional TTL for the lease (adapter default if omitted)
   * @returns Owner token if acquired, null if already held by another
   */
  tryAcquire(
    id: string,
    options?: { ttlMs?: number }
  ): Promise<{ ownerToken: string } | null>;

  /**
   * Release the lease. Must verify owner token; no-op or ignore if token
   * does not match (e.g. lease already expired or taken by another).
   */
  release(id: string, ownerToken: string): Promise<void>;

  /**
   * Extend the lease for an already-held lock.
   * Returns true if renewed, false if lost.
   * Optional — when not implemented, no heartbeat runs.
   */
  renew?(id: string, ownerToken: string, options?: { ttlMs?: number }): Promise<boolean>;
}

/**
 * Check if a store implements the optional WorkflowLock interface.
 */
function hasWorkflowLock(
  store: SnapshotStore
): store is SnapshotStore & WorkflowLock {
  return (
    typeof (store as SnapshotStore & WorkflowLock).tryAcquire === "function" &&
    typeof (store as SnapshotStore & WorkflowLock).release === "function"
  );
}

/**
 * Options for durable workflow execution.
 */
export interface DurableOptions<C = void> {
  /**
   * Unique workflow execution ID.
   * Used as the key for state persistence.
   *
   * @example 'order-checkout-123', 'user-onboarding-abc'
   */
  id: string;

  /**
   * Snapshot store for persistence. Optional. When omitted, an in-memory store is used (per process).
   * Same-process resume/retry works; state is lost on restart. Override with postgres/mongo/libsql for persistence.
   *
   * @example
   * ```typescript
   * // Zero-config: uses in-memory store (per process)
   * await durable.run(deps, fn, { id: 'my-id' });
   *
   * // Override: pass a store for persistence across restarts
   * import { postgres } from 'awaitly-postgres';
   * const store = postgres('postgresql://localhost/mydb');
   * await durable.run(deps, fn, { id: 'my-id', store });
   * ```
   */
  store?: SnapshotStore;

  /**
   * Workflow logic version.
   * If stored state has a different version, workflow will reject resume with VersionMismatchError
   * unless onVersionMismatch is used to clear or migrate.
   *
   * Bump when you change step keys, reorder steps, or change step outputs in a way old checkpoints can't satisfy.
   *
   * @default 1
   */
  version?: number;

  /**
   * When stored state version differs from requested version, either throw (default), clear state and run from scratch, or supply migrated snapshot.
   * Use for migration or one-off clear without wrapping durable.run.
   *
   * @default 'throw'
   */
  onVersionMismatch?: (ctx: {
    id: string;
    storedVersion: number;
    requestedVersion: number;
  }) => "throw" | "clear" | { migratedSnapshot: WorkflowSnapshot } | Promise<"throw" | "clear" | { migratedSnapshot: WorkflowSnapshot }>;

  /**
   * Allow concurrent executions with the same workflow ID.
   * When `false` (default), a second run with the same ID will be rejected while one is active.
   *
   * @default false
   */
  allowConcurrent?: boolean;

  /**
   * Lease TTL in milliseconds for cross-process locking.
   * Only used when the store implements WorkflowLock and allowConcurrent is false.
   * A crashed worker's lease expires after this duration so the workflow can be picked up again.
   *
   * @default 60000 (1 minute)
   */
  lockTtlMs?: number;

  /**
   * Heartbeat interval for lease renewal (ms).
   * Only active when store implements WorkflowLock with renew().
   * @default lockTtlMs / 3
   */
  heartbeatIntervalMs?: number;

  /**
   * Whether to abort the workflow when lease is lost mid-execution.
   * @default true
   */
  abortOnLeaseLoss?: boolean;

  /**
   * Metadata to store alongside workflow state.
   * Useful for debugging, auditing, or filtering workflows.
   *
   * @example { userId: 'user-123', source: 'api' }
   */
  metadata?: Record<string, unknown>;

  /**
   * External AbortSignal for workflow-level cancellation.
   * Cancellation persists state up to the last completed step.
   */
  signal?: AbortSignal;

  /**
   * Create per-run context for event correlation.
   */
  createContext?: () => C;

  /**
   * Unified event stream for workflow and step lifecycle.
   * Includes durable-specific events: `persist_success` and `persist_error`.
   */
  onEvent?: (event: DurableWorkflowEvent<unknown, C>, ctx: C) => void;

  /**
   * Handler for expected and unexpected errors.
   */
  onError?: (error: unknown, stepName?: string, ctx?: C) => void;

  /**
   * Idempotency key for deduplication.
   * If provided and a completed workflow with this key exists in the store,
   * the stored result is returned without re-execution.
   * If the stored input differs, an IdempotencyConflictError is returned.
   */
  idempotencyKey?: string;

  /**
   * Workflow input for idempotency conflict detection.
   * When idempotencyKey is set, this is compared against stored input.
   * Must be JSON-serializable.
   */
  input?: unknown;
}

/**
 * Extended workflow event type that includes durable-specific events.
 * E is the deps error type - the full error type includes E | UnexpectedError.
 */
export type DurableWorkflowEvent<E, C = void> =
  | WorkflowEvent<E | UnexpectedError, C>
  | {
      type: "persist_success";
      workflowId: string;
      stepKey: string;
      ts: number;
      context?: C;
    }
  | {
      type: "persist_error";
      workflowId: string;
      stepKey: string;
      error: unknown;
      ts: number;
      context?: C;
    };

/**
 * Options for bulk delete of workflow state.
 */
export interface DeleteStatesOptions {
  /**
   * Max number of concurrent delete calls when store has no deleteMany.
   * @default 10
   */
  concurrency?: number;
  /**
   * When true, collect errors and return them; when false, throw on first error.
   * @default true
   */
  continueOnError?: boolean;
}

/**
 * Result of bulk delete of workflow state.
 */
export interface DeleteStatesResult {
  /** Number of entries successfully deleted. */
  deleted: number;
  /** Per-id errors when continueOnError was true and some deletes failed. */
  errors?: Array<{ id: string; error: unknown }>;
}

// Track active workflow executions for concurrency control
const activeWorkflows = new Set<string>();
// Track in-flight idempotency key executions so concurrent in-process callers
// can await the first execution's result instead of racing through the store load.
const pendingIdempotencyRuns = new Map<string, Promise<unknown>>();

/**
 * Durable workflow execution namespace.
 */
export const durable = {
  /**
   * Execute a workflow with automatic state persistence.
   *
   * Features:
   * - **Automatic checkpointing**: State is saved after each keyed step
   * - **Crash recovery**: Resume from the last completed step on restart
   * - **Version checking**: Reject resume if workflow logic version changed
   * - **Concurrency control**: Prevent duplicate executions of the same workflow ID
   * - **Cancellation support**: Integrates with AbortSignal for graceful shutdown
   *
   * ## How It Works
   *
   * 1. On start: Load existing state from store (if any)
   * 2. Check version compatibility (reject if mismatch)
   * 3. Pre-populate cache from loaded state (skip completed steps)
   * 4. Execute workflow, persisting state after each keyed step
   * 5. On completion: Delete stored state (clean up)
   * 6. On error/cancellation: State remains for future resume
   *
   * ## Important Notes
   *
   * - **Only keyed steps are durable**: Use `{ key: 'step-name' }` option
   * - **Steps should be idempotent**: They may be retried on resume
   * - **Serialization**: State is JSON-serialized; complex objects may lose fidelity
   *
   * @param deps - Workflow dependencies (Result-returning functions)
   * @param fn - Workflow function receiving ({ step, deps, ctx })
   * @param options - Durable execution options
   * @returns AsyncResult with workflow result or error
   *
   * @example
   * ```typescript
   * import { durable } from 'awaitly/durable';
   *
   * // Zero-config: uses in-memory store (per process)
   * const result = await durable.run(
   *   { fetchUser, createOrder, sendEmail },
   *   async ({ step, deps: { fetchUser, createOrder, sendEmail } }) => {
   *     const user = await step(() => fetchUser('123'), { key: 'fetch-user' });
   *     const order = await step(() => createOrder(user), { key: 'create-order' });
   *     await step(() => sendEmail(order), { key: 'send-email' });
   *     return order;
   *   },
   *   { id: 'checkout-123' }
   * );
   *
   * // Override: pass a store for persistence across restarts
   * import { createMemoryStatePersistence } from 'awaitly/persistence';
   * const store = createMemoryStatePersistence();
   * await durable.run(deps, fn, { id: 'checkout-123', store });
   *
   * if (result.ok) {
   *   console.log('Order completed:', result.value);
   * } else if (isWorkflowCancelled(result.error)) {
   *   console.log('Workflow cancelled at:', result.error.lastStepKey);
   * }
   * ```
   */
  async run<
    const Deps extends Readonly<Record<string, AnyResultFn>>,
    T,
    C = void
  >(
    deps: Deps,
    fn: (
      context: { step: RunStep<ErrorsOfDeps<Deps>>; deps: Deps; ctx: WorkflowContext<C> }
    ) => T | Promise<T>,
    options: DurableOptions<C>
  ): Promise<
    Result<
      T,
      | ErrorsOfDeps<Deps>
      | UnexpectedError
      | WorkflowCancelledError
      | VersionMismatchError
      | ConcurrentExecutionError
      | PersistenceError
      | LeaseExpiredError
      | IdempotencyConflictError,
      unknown
    >
  > {
    const {
      id,
      store: storeOption,
      version = 1,
      allowConcurrent = false,
      lockTtlMs = 60_000,
      heartbeatIntervalMs,
      abortOnLeaseLoss,
      metadata,
      signal,
      createContext,
      onEvent,
      onError,
      onVersionMismatch,
      idempotencyKey,
      input,
    } = options;

    const effectiveStore = storeOption ?? getDefaultStore();

    // Idempotency check — before concurrency and lock
    // resolveIdempotencyRun is set when this caller wins the in-process race
    // and must be resolved in the finally block so waiters get the result.
    let resolveIdempotencyRun: ((v: unknown) => void) | undefined;
    if (idempotencyKey) {
      const idemId = `idem:${idempotencyKey}`;

      // In-process dedup (synchronous check — prevents TOCTOU race between concurrent async loads)
      const pending = pendingIdempotencyRuns.get(idemId);
      if (pending) {
        return (await pending) as Result<T, ErrorsOfDeps<Deps> | UnexpectedError | WorkflowCancelledError | VersionMismatchError | ConcurrentExecutionError | PersistenceError | LeaseExpiredError | IdempotencyConflictError, unknown>;
      }

      // Register ourselves synchronously before any async work
      pendingIdempotencyRuns.set(idemId, new Promise<unknown>((r) => { resolveIdempotencyRun = r; }));

      try {
        const idemSnapshot = await effectiveStore.load(idemId);
        if (idemSnapshot) {
          // Check for input conflict
          if (input !== undefined && idemSnapshot.metadata?.input !== undefined) {
            const storedInput = JSON.stringify(idemSnapshot.metadata.input);
            const currentInput = JSON.stringify(input);
            if (storedInput !== currentInput) {
              const result = err({
                type: "IDEMPOTENCY_CONFLICT" as const,
                idempotencyKey,
                workflowId: id,
                message: `Idempotency key '${idempotencyKey}' already used with different input for workflow '${id}'.`,
              });
              resolveIdempotencyRun!(result);
              pendingIdempotencyRuns.delete(idemId);
              resolveIdempotencyRun = undefined;
              return result;
            }
          }

          // If completed with a stored result, return it
          if (idemSnapshot.execution.status === "completed" && idemSnapshot.metadata?.finalResult !== undefined) {
            // Return the stored result directly
            const result = idemSnapshot.metadata.finalResult as Result<T, ErrorsOfDeps<Deps> | UnexpectedError | WorkflowCancelledError | VersionMismatchError | ConcurrentExecutionError | PersistenceError | LeaseExpiredError | IdempotencyConflictError, unknown>;
            resolveIdempotencyRun!(result);
            pendingIdempotencyRuns.delete(idemId);
            resolveIdempotencyRun = undefined;
            return result;
          }

          // If still running, treat as concurrent
          if (idemSnapshot.execution.status === "running") {
            const result = err({
              type: "CONCURRENT_EXECUTION" as const,
              workflowId: id,
              message: `Workflow '${id}' with idempotency key '${idempotencyKey}' is already running.`,
              reason: "cross-process" as const,
            });
            resolveIdempotencyRun!(result);
            pendingIdempotencyRuns.delete(idemId);
            resolveIdempotencyRun = undefined;
            return result;
          }
        }
      } catch {
        // If we can't check idempotency, continue with normal execution
        // (don't block on idempotency check failure)
      }

      // Save "running" marker for cross-process safety
      try {
        await effectiveStore.save(idemId, {
          formatVersion: 1,
          steps: {},
          execution: {
            status: "running",
            lastUpdated: new Date().toISOString(),
          },
          metadata: {
            workflowId: id,
            idempotencyKey,
            input: input as JSONValue,
          },
        } satisfies WorkflowSnapshot);
      } catch {
        // Non-fatal: best-effort cross-process marker
      }
    }

    // In-process concurrency check
    if (!allowConcurrent && activeWorkflows.has(id)) {
      const error: ConcurrentExecutionError = {
        type: "CONCURRENT_EXECUTION",
        workflowId: id,
        message: `Workflow '${id}' is already running. Set allowConcurrent: true to allow parallel executions.`,
        reason: "in-process",
      };
      return err(error);
    }

    // Cross-process lock (optional): try acquire lease when store implements WorkflowLock
    let leaseOwnerToken: string | null = null;
    if (!allowConcurrent && hasWorkflowLock(effectiveStore)) {
      let lease: { ownerToken: string } | null;
      try {
        lease = await effectiveStore.tryAcquire(id, { ttlMs: lockTtlMs });
      } catch (lockError) {
        const error: PersistenceError = {
          type: "PERSISTENCE_ERROR",
          operation: "load",
          workflowId: id,
          cause: lockError,
          message: `Failed to acquire lock for workflow '${id}': ${lockError instanceof Error ? lockError.message : String(lockError)}`,
        };
        return err(error);
      }
      if (lease === null) {
        const error: ConcurrentExecutionError = {
          type: "CONCURRENT_EXECUTION",
          workflowId: id,
          message: `Workflow '${id}' is already running (lease held by another process). Set allowConcurrent: true to allow parallel executions.`,
          reason: "cross-process",
        };
        return err(error);
      }
      leaseOwnerToken = lease.ownerToken;
    }

    // Start heartbeat if store supports renew
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let leaseAbortController: AbortController | undefined;

    const lockStore = effectiveStore as SnapshotStore & WorkflowLock;
    if (leaseOwnerToken && typeof lockStore.renew === "function") {
      const heartbeatMs = heartbeatIntervalMs ?? Math.floor(lockTtlMs / 3);
      leaseAbortController = new AbortController();

      heartbeatTimer = setInterval(async () => {
        try {
          const renewed = await lockStore.renew!(id, leaseOwnerToken!, { ttlMs: lockTtlMs });
          if (!renewed) {
            leaseAbortController!.abort(new Error("Lease expired"));
          }
        } catch {
          leaseAbortController!.abort(new Error("Lease renewal failed"));
        }
      }, heartbeatMs);
    }

    // Mark as active (in-process)
    activeWorkflows.add(id);

    // Tracks the final result so the idempotency deferred can be resolved in finally.
    let durableResult: unknown;
    try {
      // Load existing snapshot (wrap in try-catch to return Result on store errors)
      let existingSnapshot: WorkflowSnapshot | null = null;
      try {
        existingSnapshot = await effectiveStore.load(id);
      } catch (loadError) {
        const error: PersistenceError = {
          type: "PERSISTENCE_ERROR",
          operation: "load",
          workflowId: id,
          cause: loadError,
          message: `Failed to load state for workflow '${id}': ${loadError instanceof Error ? loadError.message : String(loadError)}`,
        };
        durableResult = err(error); return err(error);
      }

      // Validate snapshot format if it exists
      if (existingSnapshot) {
        try {
          assertValidSnapshot(existingSnapshot);
        } catch (validationError) {
          if (validationError instanceof SnapshotFormatError) {
            const error: PersistenceError = {
              type: "PERSISTENCE_ERROR",
              operation: "load",
              workflowId: id,
              cause: validationError,
              message: `Invalid snapshot format for workflow '${id}': ${validationError.message}`,
            };
            durableResult = err(error); return err(error);
          }
          throw validationError;
        }
      }

      // Version check if snapshot exists
      if (existingSnapshot) {
        // Check metadata.version (workflow logic version)
        // Snapshots without version metadata default to version 1
        const storedVersion =
          typeof existingSnapshot.metadata?.version === "number"
            ? existingSnapshot.metadata.version
            : 1;
        if (storedVersion !== version) {
          const error: VersionMismatchError = {
            type: "VERSION_MISMATCH",
            workflowId: id,
            storedVersion,
            requestedVersion: version,
            currentVersion: version,
            message: `Workflow '${id}' has stored state at version ${storedVersion} but this run requested version ${version}. Migrate the stored state to the new version, or clear state for this id (e.g. durable.deleteState(store, '${id}')) and re-run.`,
          };
          if (!onVersionMismatch) {
            durableResult = err(error); return err(error);
          }
          const resolution = await Promise.resolve(
            onVersionMismatch({ id, storedVersion, requestedVersion: version })
          );
          if (resolution === "throw") {
            durableResult = err(error); return err(error);
          }
          if (resolution === "clear") {
            try {
              await effectiveStore.delete(id);
            } catch {
              // ignore delete errors
            }
            existingSnapshot = null;
          } else {
            existingSnapshot = resolution.migratedSnapshot;
          }
        }
      }

      // Define error type for this workflow
      type E = ErrorsOfDeps<Deps>;

      // Wrapper to emit durable-specific events
      const emitDurableEvent = (event: DurableWorkflowEvent<E, C>, ctx: C): void => {
        if (onEvent) {
          onEvent(event, ctx);
        }
      };

      // Collect step results via onEvent for snapshot building
      const resumeCollector = createResumeStateCollector();

      // Build workflow options with proper types (U = UnexpectedError by default)
      const workflowOptions: WorkflowOptions<E, UnexpectedError, C> = {
        // Restore from existing snapshot
        snapshot: existingSnapshot,

        // Persist after each keyed step
        onAfterStep: async (stepKey, result, wfId, ctx) => {
          try {
            // Build a snapshot from collected step results
            const collectedState = resumeCollector.getResumeState();
            const steps: Record<string, StepResult> = {};
            for (const [key, entry] of collectedState.steps) {
              if (entry.result.ok) {
                steps[key] = { ok: true, value: entry.result.value as JSONValue };
              } else {
                // Serialize cause for proper snapshot format
                const cause = entry.result.cause;
                const serializedCause = cause instanceof Error
                  ? serializeError(cause)
                  : serializeThrown(cause);
                const origin: "result" | "throw" = entry.meta?.origin === "throw" ? "throw" : "result";
                steps[key] = {
                  ok: false,
                  error: entry.result.error as JSONValue,
                  cause: serializedCause,
                  meta: { origin },
                };
              }
            }

            const currentSnapshot: WorkflowSnapshot = {
              formatVersion: 1,
              workflowName: id,
              steps,
              execution: {
                status: "running",
                lastUpdated: new Date().toISOString(),
                currentStepId: stepKey,
              },
              metadata: {
                ...(existingSnapshot?.metadata ?? {}),
                ...metadata,
                version,
                lastStepKey: stepKey,
              } as Record<string, JSONValue>,
            };

            // If we have an existing snapshot, merge it with the current one
            // This preserves steps from previous runs
            let snapshotToSave = existingSnapshot
              ? mergeSnapshots(existingSnapshot, currentSnapshot)
              : currentSnapshot;

            // Clear stale warnings for steps that were re-executed in this run
            if (snapshotToSave.warnings && snapshotToSave.warnings.length > 0) {
              const currentStepKeys = new Set(Object.keys(currentSnapshot.steps));
              const filtered = snapshotToSave.warnings.filter(
                w => !currentStepKeys.has(w.stepId)
              );
              snapshotToSave = {
                ...snapshotToSave,
                warnings: filtered.length > 0 ? filtered : undefined,
              };
            }

            // Persist to store
            await effectiveStore.save(id, snapshotToSave);

            // Emit success event
            emitDurableEvent(
              {
                type: "persist_success",
                workflowId: wfId,
                stepKey,
                ts: Date.now(),
                context: ctx as C,
              },
              ctx as C
            );
          } catch (persistError) {
            // Emit error event but continue workflow (per Temporal/Cloudflare pattern)
            emitDurableEvent(
              {
                type: "persist_error",
                workflowId: wfId,
                stepKey,
                error: persistError,
                ts: Date.now(),
                context: ctx as C,
              },
              ctx as C
            );
          }
        },

        // Forward events and collect step results for snapshot building
        onEvent: (event, ctx) => {
          resumeCollector.handleEvent(event);
          emitDurableEvent(event as DurableWorkflowEvent<E, C>, ctx as C);
        },

        onError: onError as (error: E | UnexpectedError, stepName?: string, ctx?: C) => void,
        signal: leaseAbortController && signal
          ? AbortSignal.any([signal, leaseAbortController.signal])
          : leaseAbortController?.signal ?? signal,
        createContext,
      };

      // Create workflow instance (U = UnexpectedError by default)
      let workflowInstance: Workflow<E, UnexpectedError, Deps, C>;
      try {
        workflowInstance = createWorkflow<Deps, UnexpectedError, C>(id, deps, workflowOptions);
      } catch (createError) {
        if (createError instanceof SnapshotFormatError) {
          const error: PersistenceError = {
            type: "PERSISTENCE_ERROR",
            operation: "load",
            workflowId: id,
            cause: createError,
            message: `Invalid snapshot format for workflow '${id}': ${createError.message}`,
          };
          durableResult = err(error); return err(error);
        }
        throw createError;
      }

      // Execute workflow (snapshot validation may throw SnapshotFormatError at run time)
      let result: Result<T, E | UnexpectedError | PersistenceError, unknown>;
      try {
        result = await workflowInstance!.run(fn);
      } catch (runError) {
        if (runError instanceof SnapshotFormatError || runError instanceof SnapshotDecodeError) {
          const error: PersistenceError = {
            type: "PERSISTENCE_ERROR",
            operation: "load",
            workflowId: id,
            cause: runError,
            message: `Invalid snapshot format for workflow '${id}': ${runError.message}`,
          };
          durableResult = err(error); return err(error);
        }
        throw runError;
      }

      // Check if lease was lost during execution
      if (abortOnLeaseLoss !== false && leaseAbortController?.signal.aborted) {
        const leaseErr = err({
          type: "LEASE_EXPIRED" as const,
          workflowId: id,
          message: `Lease expired for workflow '${id}' during execution. The workflow may have been reclaimed by another process.`,
        });
        durableResult = leaseErr;
        return leaseErr;
      }

      // On success: clean up stored state
      if (result.ok) {
        try {
          await effectiveStore.delete(id);
        } catch (deleteError) {
          const error: PersistenceError = {
            type: "PERSISTENCE_ERROR",
            operation: "delete",
            workflowId: id,
            cause: deleteError,
            message: `Failed to delete state for workflow '${id}': ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`,
          };
          durableResult = err(error); return err(error);
        }

        // Save idempotency record on success
        if (idempotencyKey) {
          const idemId = `idem:${idempotencyKey}`;
          try {
            await effectiveStore.save(idemId, {
              formatVersion: 1,
              steps: {},
              execution: {
                status: "completed",
                lastUpdated: new Date().toISOString(),
                completedAt: new Date().toISOString(),
              },
              metadata: {
                workflowId: id,
                idempotencyKey,
                input: input as JSONValue,
                finalResult: result as JSONValue,
              },
            } satisfies WorkflowSnapshot);
          } catch {
            // Non-fatal: workflow succeeded but idempotency record failed to save
          }
        }
      }
      // On error/cancellation: state remains for resume

      // Workflow result is structurally compatible with our return type
      // (workflow returns E | UnexpectedError, we return that plus our durable-specific errors)
      durableResult = result;
      return result;
    } finally {
      // Always remove from active set
      activeWorkflows.delete(id);
      // Resolve in-process idempotency deferred so concurrent waiters get the result
      if (resolveIdempotencyRun) {
        resolveIdempotencyRun(durableResult);
        pendingIdempotencyRuns.delete(`idem:${idempotencyKey}`);
      }
      // Clear heartbeat timer before releasing lock
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      // Release cross-process lease if we acquired one (verify owner in adapter)
      // Guard the await so a failing release doesn't turn a successful run into a rejection
      if (leaseOwnerToken !== null && hasWorkflowLock(effectiveStore)) {
        try {
          await effectiveStore.release(id, leaseOwnerToken);
        } catch {
          // Swallow release errors - the workflow result is already determined
          // and we don't want to mask it with a lock release failure
        }
      }
    }
  },

  /**
   * Clear all persisted workflow state from the store.
   * Use for admin/testing. If the store implements `clear()`, that is used;
   * otherwise clears by listing and deleting in pages.
   *
   * @param store - Snapshot store
   */
  async clearState(store: SnapshotStore): Promise<void> {
    const storeWithClear = store as SnapshotStore & { clear?(): Promise<void> };
    if (typeof storeWithClear.clear === "function") {
      await storeWithClear.clear();
      return;
    }
    const limit = 100;
    for (;;) {
      const entries = await store.list({ limit });
      if (entries.length === 0) break;
      const ids = entries.map(e => e.id);
      await this.deleteStates(store, ids, { continueOnError: true });
      if (entries.length < limit) break;
    }
  },

  /**
   * Check if a workflow ID has persisted state (can be resumed).
   *
   * @param store - Snapshot store
   * @param id - Workflow execution ID
   * @returns `true` if state exists, `false` otherwise (including on store errors)
   */
  async hasState(store: SnapshotStore, id: string): Promise<boolean> {
    try {
      const snapshot = await store.load(id);
      return snapshot !== null;
    } catch {
      return false;
    }
  },

  /**
   * Delete persisted state for a workflow (cancel resume capability).
   * Deleting is effectively an ack/reset: the workflow can no longer resume from that state.
   * If you delete while a run is in flight, the run continues; on success it may delete again (no-op) or save (recreating state).
   * For multi-worker safety, prefer deleting only when the workflow is not running or when you hold the lock.
   *
   * @param store - Snapshot store
   * @param id - Workflow execution ID
   * @returns `true` on success, `false` on store errors
   */
  async deleteState(store: SnapshotStore, id: string): Promise<boolean> {
    try {
      await store.delete(id);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Bulk delete persisted state for multiple workflow IDs (best-effort).
   * Use for admin/cleanup. Deletes in a loop with optional concurrency.
   *
   * @param store - Snapshot store
   * @param ids - Workflow execution IDs to delete
   * @param options - Optional concurrency and error handling
   * @returns Count of deleted entries and any errors when continueOnError is true
   */
  async deleteStates(
    store: SnapshotStore,
    ids: string[],
    options: DeleteStatesOptions = {}
  ): Promise<DeleteStatesResult> {
    const { concurrency = 10, continueOnError = true } = options;
    if (ids.length === 0) {
      return { deleted: 0 };
    }
    const errors: Array<{ id: string; error: unknown }> = [];
    let deleted = 0;
    const run = async (id: string): Promise<void> => {
      try {
        await store.delete(id);
        deleted++;
      } catch (error) {
        if (continueOnError) errors.push({ id, error });
        else throw error;
      }
    };
    const limit = Math.max(1, concurrency);
    for (let i = 0; i < ids.length; i += limit) {
      const batch = ids.slice(i, i + limit);
      await Promise.all(batch.map((id) => run(id)));
    }
    return errors.length > 0 ? { deleted, errors } : { deleted };
  },

  /**
   * List workflow IDs with persisted state.
   *
   * @param store - Snapshot store
   * @param options - Optional prefix and limit
   * @returns Array of { id, updatedAt } entries
   */
  async listPending(
    store: SnapshotStore,
    options?: { prefix?: string; limit?: number }
  ): Promise<Array<{ id: string; updatedAt: string }>> {
    try {
      return await store.list(options);
    } catch {
      return [];
    }
  },
};
