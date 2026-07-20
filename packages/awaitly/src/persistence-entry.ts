/**
 * Persistence surface (absorbed into `awaitly/workflow`).
 *
 * Snapshot API for JSON-serializable workflow state, plus resume-state
 * versioning/migration helpers.
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
