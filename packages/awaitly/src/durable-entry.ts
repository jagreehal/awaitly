/**
 * awaitly/durable
 *
 * Durable execution with automatic state persistence.
 * Re-exports from the main durable module.
 */

export {
  // Main API
  durable,

  // Types
  type DurableOptions,
  type DurableWorkflowEvent,
  type VersionMismatchError,
  type ConcurrentExecutionError,
  type PersistenceError,
  type WorkflowLock,
  type DeleteStatesOptions,
  type DeleteStatesResult,

  // Type guards
  isVersionMismatch,
  isConcurrentExecution,
  isPersistenceError,

  // Re-exports from workflow
  isWorkflowCancelled,
  type WorkflowCancelledError,

  // Re-exports from persistence (new snapshot API)
  type SnapshotStore,
} from "./durable";
