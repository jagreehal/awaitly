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

  // Type guards
  isVersionMismatch,
  isConcurrentExecution,
  isPersistenceError,

  // Re-exports from workflow
  isWorkflowCancelled,
  type WorkflowCancelledError,

  // Re-exports from persistence
  type StatePersistence,
} from "./durable";

// Also export persistence helpers for convenience
export {
  createMemoryStatePersistence,
  createFileStatePersistence,
  type MemoryStatePersistenceOptions,
  type FileStatePersistenceOptions,
  type FileSystemInterface,
} from "./persistence";
