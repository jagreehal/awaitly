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
} from "./core";
import {
  createWorkflow,
  createResumeStateCollector,
  type AnyResultFn,
  type ErrorsOfDeps,
  type WorkflowOptions,
  type WorkflowContext,
  type WorkflowCancelledError,
  type ResumeState,
} from "./workflow";
import {
  type StatePersistence,
  type SerializedState,
  type ListPageOptions,
  type ListPageResult,
  serializeState,
  createMemoryStatePersistence,
} from "./persistence";

// Re-export for convenience
export {
  type StatePersistence,
  type ListPageOptions,
  type ListPageResult,
} from "./persistence";
export { isWorkflowCancelled, type WorkflowCancelledError } from "./workflow";

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
  /**
   * @deprecated Use requestedVersion
   */
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
  store: StatePersistence
): store is StatePersistence & WorkflowLock {
  return (
    typeof (store as StatePersistence & WorkflowLock).tryAcquire === "function" &&
    typeof (store as StatePersistence & WorkflowLock).release === "function"
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
   * State persistence store. Optional. When omitted, an in-memory store is used (per process).
   * Same-process resume/retry works; state is lost on restart. Override with file/postgres/mongo for persistence.
   *
   * @example
   * ```typescript
   * // Zero-config: uses in-memory store (per process)
   * await durable.run(deps, fn, { id: 'my-id' });
   *
   * // Override: pass a store for persistence across restarts
   * import { createMemoryStatePersistence } from 'awaitly/persistence';
   * const store = createMemoryStatePersistence();
   * await durable.run(deps, fn, { id: 'my-id', store });
   * ```
   */
  store?: StatePersistence;

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
   * When stored state version differs from requested version, either throw (default), clear state and run from scratch, or supply migrated state.
   * Use for migration or one-off clear without wrapping durable.run.
   *
   * @default 'throw'
   */
  onVersionMismatch?: (ctx: {
    id: string;
    storedVersion: number;
    requestedVersion: number;
  }) => "throw" | "clear" | { migratedState: ResumeState } | Promise<"throw" | "clear" | { migratedState: ResumeState }>;

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

let defaultStore: StatePersistence | undefined;

function getDefaultStore(): StatePersistence {
  if (defaultStore === undefined) {
    defaultStore = createMemoryStatePersistence();
  }
  return defaultStore;
}

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
      const lease = await effectiveStore.tryAcquire(id, { ttlMs: lockTtlMs });
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
      // Load existing state (wrap in try-catch to return Result on store errors)
      let existingState: ResumeState | undefined;
      try {
        existingState = await effectiveStore.load(id);
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

      // Load existing metadata to preserve on resume
      let existingMetadata: Record<string, unknown> | undefined;

      // Version check if state exists
      if (existingState) {
        // Load raw data to access metadata.version (workflow logic version)
        let rawData: SerializedState | undefined;
        try {
          rawData = await loadRawState(effectiveStore, id);
        } catch (loadError) {
          const error: PersistenceError = {
            type: "PERSISTENCE_ERROR",
            operation: "load",
            workflowId: id,
            cause: loadError,
            message: `Failed to load raw state for workflow '${id}': ${loadError instanceof Error ? loadError.message : String(loadError)}`,
          };
          return err(error);
        }

        // Preserve existing metadata for merge during persistence
        existingMetadata = rawData?.metadata;

        // Check metadata.version, not serialization format version
        // Legacy states without metadata default to version 1
        const storedVersion =
          typeof existingMetadata?.version === "number"
            ? existingMetadata.version
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
            existingState = undefined;
            existingMetadata = undefined;
          } else {
            existingState = resolution.migratedState;
          }
        }
      }

      // Create collector to track state changes
      const collector = createResumeStateCollector();

      // Define error type for this workflow
      type E = ErrorsOfDeps<Deps>;

      // Wrapper to emit durable-specific events
      const emitDurableEvent = (event: DurableWorkflowEvent<E, C>, ctx: C): void => {
        if (onEvent) {
          onEvent(event, ctx);
        }
      };

      // Build workflow options with proper types
      const workflowOptions: WorkflowOptions<E, C> = {
        // Pre-populate cache from loaded state
        resumeState: existingState,

        // Persist after each keyed step
        onAfterStep: async (stepKey, _result, wfId, ctx) => {
          try {
            // Merge existing state (from previous runs) with collector state (current run)
            // This preserves previously completed steps and includes meta for proper replay
            const collectorState = collector.getResumeState();
            const mergedSteps = new Map(existingState?.steps ?? []);
            for (const [key, entry] of collectorState.steps) {
              mergedSteps.set(key, entry); // Collector entries include { result, meta }
            }
            const mergedState: ResumeState = { steps: mergedSteps };

            // Persist to store (merge existing metadata with new metadata)
            await effectiveStore.save(id, mergedState, {
              ...existingMetadata, // Preserve prior metadata from previous runs
              ...metadata,         // Override with current run's metadata
              version,
              lastStepKey: stepKey,
              updatedAt: new Date().toISOString(),
            });

            // Emit success event
            emitDurableEvent(
              {
                type: "persist_success",
                workflowId: wfId,
                stepKey,
                ts: Date.now(),
                context: ctx,
              },
              ctx
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
                context: ctx,
              },
              ctx
            );
          }
        },

        // Forward events and collect state
        onEvent: (event, ctx) => {
          collector.handleEvent(event);
          // WorkflowEvent<E | UnexpectedError, C> is a subset of DurableWorkflowEvent<E, C>
          emitDurableEvent(event, ctx);
        },

        onError,
        signal,
        createContext,
      };

      // Create and execute workflow
      // Note: createWorkflow<Deps, C> explicitly passes C to ensure context type flows through
      const workflow = createWorkflow<Deps, C>(deps, workflowOptions);
      const result = await workflow(fn);

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
   * otherwise clears in pages (listPage + deleteStates) to avoid loading all IDs.
   *
   * @param store - State persistence store
   */
  async clearState(store: StatePersistence): Promise<void> {
    const storeWithClear = store as StatePersistence & { clear?(): Promise<void> };
    if (typeof storeWithClear.clear === "function") {
      await storeWithClear.clear();
      return;
    }
    const limit = 100;
    for (;;) {
      // Always list from offset 0: after deleting a page, the next "first page" is the next batch.
      // Using nextOffset would skip IDs because deletions shrink the dataset.
      const page = await this.listPending(store, { limit, offset: 0, orderBy: "key", orderDir: "asc" });
      const ids = Array.isArray(page) ? page : page.ids;
      if (ids.length === 0) break;
      await this.deleteStates(store, ids, { continueOnError: true });
      if (ids.length < limit) break;
    }
  },

  /**
   * Check if a workflow ID has persisted state (can be resumed).
   *
   * @param store - State persistence store
   * @param id - Workflow execution ID
   * @returns `true` if state exists, `false` otherwise (including on store errors)
   */
  async hasState(store: StatePersistence, id: string): Promise<boolean> {
    try {
      const state = await store.load(id);
      return state !== undefined;
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
   * @param store - State persistence store
   * @param id - Workflow execution ID
   * @returns `true` if state was deleted, `false` if not found or on store errors
   */
  async deleteState(store: StatePersistence, id: string): Promise<boolean> {
    try {
      return await store.delete(id);
    } catch {
      return false;
    }
  },

  /**
   * Bulk delete persisted state for multiple workflow IDs (best-effort).
   * Use for admin/cleanup. If the store implements `deleteMany(ids)`, that is
   * used for efficiency; otherwise deletes in a loop with optional concurrency.
   *
   * @param store - State persistence store
   * @param ids - Workflow execution IDs to delete
   * @param options - Optional concurrency and error handling
   * @returns Count of deleted entries and any errors when continueOnError is true
   */
  async deleteStates(
    store: StatePersistence,
    ids: string[],
    options: DeleteStatesOptions = {}
  ): Promise<DeleteStatesResult> {
    const { concurrency = 10, continueOnError = true } = options;
    const storeWithMany = store as StatePersistence & {
      deleteMany?(ids: string[]): Promise<number>;
    };
    if (ids.length === 0) {
      return { deleted: 0 };
    }
    if (typeof storeWithMany.deleteMany === "function") {
      try {
        const deleted = await storeWithMany.deleteMany(ids);
        return { deleted };
      } catch (error) {
        if (!continueOnError) throw error;
        return { deleted: 0, errors: ids.map((id) => ({ id, error })) };
      }
    }
    const errors: Array<{ id: string; error: unknown }> = [];
    let deleted = 0;
    const run = async (id: string): Promise<void> => {
      try {
        const ok = await store.delete(id);
        if (ok) deleted++;
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
   * When called with one argument, returns string[] (same as store.list()).
   * When called with options and the store implements listPage (Postgres, Mongo, LibSQL),
   * returns ListPageResult with ids, optional total and nextOffset.
   *
   * **Scale:** Do not load the world into memory. Use `listPending(store, { limit, offset })`
   * (or store.listPage) for pagination; avoid calling listPending(store) with no options
   * when the store can hold many IDs.
   *
   * @param store - State persistence store
   * @param options - Optional pagination, order, and filter options
   * @returns Array of IDs, or ListPageResult when options are provided
   */
  async listPending(
    store: StatePersistence,
    options?: ListPageOptions
  ): Promise<string[] | ListPageResult> {
    try {
      if (options !== undefined) {
        const listPage = (store as StatePersistence & { listPage?(opts: ListPageOptions): Promise<ListPageResult> })
          .listPage;
        if (typeof listPage === "function") {
          return await listPage.call(store, options);
        }
        const ids = await store.list();
        return { ids, nextOffset: undefined };
      }
      return await store.list();
    } catch {
      if (options !== undefined) {
        return { ids: [], nextOffset: undefined };
      }
      return [];
    }
  },
};

/**
 * Helper to load raw serialized state for version checking.
 */
async function loadRawState(
  store: StatePersistence,
  id: string
): Promise<SerializedState | undefined> {
  // StatePersistence interface doesn't expose raw data directly,
  // so we need to work around this by checking if store has a loadRaw method
  // or re-serialize the loaded state (which loses the version info)

  // For now, we'll use a workaround: stores that want version checking
  // should include version in metadata when loading

  // Check if store exposes loadRaw for version checking (memory store provides this)
  // This is duck-typing: we check for the method and use it if available
  type ExtendedStore = StatePersistence & {
    loadRaw?: (id: string) => Promise<SerializedState | undefined>;
  };
  const extendedStore = store as ExtendedStore;
  if (typeof extendedStore.loadRaw === "function") {
    return extendedStore.loadRaw(id);
  }

  // Fallback: assume version 1 if we can't determine
  // (This is a limitation of the current StatePersistence interface)
  const state = await store.load(id);
  if (state) {
    // Re-serialize to get version (not ideal, but works)
    const serialized = serializeState(state);
    return serialized;
  }

  return undefined;
}
