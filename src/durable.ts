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
  serializeState,
} from "./persistence";

// Re-export for convenience
export { type StatePersistence } from "./persistence";
export { isWorkflowCancelled, type WorkflowCancelledError } from "./workflow";

// =============================================================================
// Durable Execution Types
// =============================================================================

/**
 * Error returned when workflow cannot resume due to version mismatch.
 * Indicates the stored state was created with a different workflow version.
 */
export type VersionMismatchError = {
  type: "VERSION_MISMATCH";
  /** Version stored in persisted state */
  storedVersion: number;
  /** Version expected by current workflow */
  currentVersion: number;
  /** Guidance message */
  message: string;
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
   * State persistence store.
   * Use `createMemoryStatePersistence()` for testing or `createFileStatePersistence()` for local dev.
   *
   * @example
   * ```typescript
   * import { createMemoryStatePersistence } from 'awaitly/persistence';
   * const store = createMemoryStatePersistence();
   * ```
   */
  store: StatePersistence;

  /**
   * Workflow logic version.
   * If stored state has a different version, workflow will reject resume with VersionMismatchError.
   *
   * Increment this when making breaking changes to workflow logic (adding/removing/reordering steps).
   *
   * @default 1
   */
  version?: number;

  /**
   * Allow concurrent executions with the same workflow ID.
   * When `false` (default), a second run with the same ID will be rejected while one is active.
   *
   * @default false
   */
  allowConcurrent?: boolean;

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
   * import { createMemoryStatePersistence } from 'awaitly/persistence';
   *
   * const store = createMemoryStatePersistence();
   *
   * const result = await durable.run(
   *   { fetchUser, createOrder, sendEmail },
   *   async (step, { fetchUser, createOrder, sendEmail }) => {
   *     // Each keyed step is automatically checkpointed
   *     const user = await step(() => fetchUser('123'), { key: 'fetch-user' });
   *     const order = await step(() => createOrder(user), { key: 'create-order' });
   *     await step(() => sendEmail(order), { key: 'send-email' });
   *     return order;
   *   },
   *   {
   *     id: 'checkout-123',
   *     store,
   *   }
   * );
   *
   * if (result.ok) {
   *   console.log('Order completed:', result.value);
   * } else if (isWorkflowCancelled(result.error)) {
   *   console.log('Workflow cancelled at:', result.error.lastStepKey);
   *   // State is persisted, can resume later
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
      store,
      version = 1,
      allowConcurrent = false,
      metadata,
      signal,
      createContext,
      onEvent,
      onError,
    } = options;

    // Concurrency check
    if (!allowConcurrent && activeWorkflows.has(id)) {
      const error: ConcurrentExecutionError = {
        type: "CONCURRENT_EXECUTION",
        workflowId: id,
        message: `Workflow '${id}' is already running. Set allowConcurrent: true to allow parallel executions.`,
      };
      return err(error);
    }

    // Mark as active
    activeWorkflows.add(id);

    try {
      // Load existing state (wrap in try-catch to return Result on store errors)
      let existingState: ResumeState | undefined;
      try {
        existingState = await store.load(id);
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
          rawData = await loadRawState(store, id);
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
            storedVersion,
            currentVersion: version,
            message: `Cannot resume workflow '${id}': stored version (${storedVersion}) differs from current version (${version}). Complete or delete the stored workflow before running with a new version.`,
          };
          return err(error);
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
            await store.save(id, mergedState, {
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
          await store.delete(id);
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
   * List all workflow IDs with persisted state.
   *
   * @param store - State persistence store
   * @returns Array of workflow IDs (empty array on store errors)
   */
  async listPending(store: StatePersistence): Promise<string[]> {
    try {
      return await store.list();
    } catch {
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
