/**
 * awaitly/durable
 *
 * Durable execution with automatic state persistence.
 * Durable execution plus the persistence contracts needed to configure it.
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
  isLeaseExpired,
  isIdempotencyConflict,

  // New error types
  type LeaseExpiredError,
  type IdempotencyConflictError,

  // Re-exports from workflow
  isWorkflowCancelled,
  type WorkflowCancelledError,

  // Re-exports from persistence (new snapshot API)
  type SnapshotStore,
} from "./durable";

// Snapshot stores, validation, serialization, and state migrations are part
// of the durable interface. Adapter authors can import the smaller
// `awaitly/persistence` entry when they do not need the durable runtime.
export * from "./persistence-entry";
