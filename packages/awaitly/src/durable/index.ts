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
import { createWorkflow } from "../workflow/execute";
import type {
  AnyResultFn,
  ErrorsOfDeps,
  WorkflowOptions,
  WorkflowContext,
  WorkflowCancelledError,
  WorkflowCallable,
} from "../workflow";
import {
  type SnapshotStore,
  type WorkflowSnapshot,
  type JSONValue,
  mergeSnapshots,
  SnapshotFormatError,
} from "../persistence";

// Re-export for convenience
export { type SnapshotStore } from "../persistence";
export { isWorkflowCancelled, type WorkflowCancelledError } from "../workflow";

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
   * @param fn - Workflow function receiving (step, deps, ctx)
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
   *   async (step, { fetchUser, createOrder, sendEmail }) => {
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
      step: RunStep<ErrorsOfDeps<Deps>>,
      deps: Deps,
      ctx: WorkflowContext<C>
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
      | PersistenceError,
      unknown
    >
  > {
    const {
      id,
      store: storeOption,
      version = 1,
      allowConcurrent = false,
      lockTtlMs = 60_000,
      metadata,
      signal,
      createContext,
      onEvent,
      onError,
      onVersionMismatch,
    } = options;

    const effectiveStore = storeOption ?? getDefaultStore();

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

    // Mark as active (in-process)
    activeWorkflows.add(id);

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
        return err(error);
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
            return err(error);
          }
          const resolution = await Promise.resolve(
            onVersionMismatch({ id, storedVersion, requestedVersion: version })
          );
          if (resolution === "throw") {
            return err(error);
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

      // Reference to the workflow instance (populated after creation)
      let workflowInstance: WorkflowCallable<E, UnexpectedError, Deps, C> | null = null;

      // Build workflow options with proper types (U = UnexpectedError by default)
      const workflowOptions: WorkflowOptions<E, UnexpectedError, C> = {
        // Restore from existing snapshot
        snapshot: existingSnapshot,

        // Persist after each keyed step
        onAfterStep: async (stepKey, _result, wfId, ctx) => {
          try {
            if (!workflowInstance) {
              throw new Error("Workflow instance not available");
            }

            // Get current snapshot from workflow
            const currentSnapshot = workflowInstance.getSnapshot({
              metadata: {
                ...(existingSnapshot?.metadata ?? {}),
                ...metadata,
                version,
                lastStepKey: stepKey,
              } as Record<string, JSONValue>,
            });

            // If we have an existing snapshot, merge it with the current one
            // This preserves steps from previous runs
            const snapshotToSave = existingSnapshot
              ? mergeSnapshots(existingSnapshot, currentSnapshot)
              : currentSnapshot;

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

        // Forward events
        onEvent: (event, ctx) => {
          emitDurableEvent(event as DurableWorkflowEvent<E, C>, ctx as C);
        },

        onError: onError as (error: E | UnexpectedError, stepName?: string, ctx?: C) => void,
        signal,
        createContext,
      };

      // Create workflow instance (U = UnexpectedError by default)
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
          return err(error);
        }
        throw createError;
      }

      // Execute workflow
      const result = await workflowInstance!(fn);

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
          return err(error);
        }
      }
      // On error/cancellation: state remains for resume

      // Workflow result is structurally compatible with our return type
      // (workflow returns E | UnexpectedError, we return that plus our durable-specific errors)
      return result;
    } finally {
      // Always remove from active set
      activeWorkflows.delete(id);
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
