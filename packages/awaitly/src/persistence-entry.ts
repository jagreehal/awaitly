/**
 * awaitly/persistence
 *
 * Store contracts, serialization, snapshots, and resume-state migrations.
 * Persistence adapters should depend on this entry point rather than the
 * workflow runtime.
 */

export {
  type ResumeState,
  type SerializedResumeState,
  type StoreSaveInput,
  type StoreLoadResult,
  type PersistedWorkflowState,
  isResumeState,
  isSerializedResumeState,
  serializeResumeState,
  deserializeResumeState,
  toResumeState,
} from "./workflow";

// The lock is a store capability. It remains defined beside durable execution
// internally, but is type-only here so adapters do not load that runtime.
export type { WorkflowLock } from "./durable";

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
  isWorkflowSnapshot,
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

// =============================================================================
// Resume-state versioning + migrations (evolve persisted state across
// workflow versions)
// =============================================================================
export {
  // Types
  type Version,
  type MigrationFn,
  type Migrations,
  type VersionedState,
  type VersionedWorkflowConfig,
  type MigrationError,
  type VersionIncompatibleError,

  // Guards
  isMigrationError,
  isVersionIncompatibleError,

  // Versioned state (create / parse / serialize / load)
  createVersionedState,
  parseVersionedState,
  stringifyVersionedState,
  createVersionedStateLoader,

  // Migration builders
  createKeyRenameMigration,
  createKeyRemoveMigration,
  createValueTransformMigration,
  composeMigrations,
} from "./versioning";
