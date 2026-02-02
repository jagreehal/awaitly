/**
 * awaitly/persistence
 *
 * Simplified Persistence API for workflow snapshots.
 */

// =============================================================================
// Snapshot API (JSON-serializable workflow state)
// =============================================================================
export {
  // Types
  type JSONValue,
  type WorkflowSnapshot,
  type StepResult,
  type SerializedCause,
  type SnapshotWarning,

  // Store interface
  type SnapshotStore,

  // Validation
  looksLikeWorkflowSnapshot,
  validateSnapshot,
  assertValidSnapshot,
  mergeSnapshots,

  // Error classes
  SnapshotFormatError,
  SnapshotMismatchError,
  SnapshotDecodeError,

  // Serialization helpers (for custom implementations)
  serializeError,
  serializeThrown,
  deserializeCauseNew,

  // Cache adapter
  type MemoryCacheOptions,
  createMemoryCache,
} from "./persistence";
