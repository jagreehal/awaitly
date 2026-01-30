/**
 * awaitly/persistence
 *
 * State persistence and workflow versioning: save workflow state,
 * resume from checkpoints, and migrate between schema versions.
 */

// =============================================================================
// Persistence
// =============================================================================
export {
  type SerializedResult,
  type SerializedCause,
  type SerializedMeta,
  type SerializedEntry,
  type SerializedState,
  serializeCause,
  deserializeCause,
  serializeResult,
  deserializeResult,
  serializeMeta,
  deserializeMeta,
  serializeEntry,
  deserializeEntry,
  serializeState,
  deserializeState,
  stringifyState,
  parseState,
  type MemoryCacheOptions,
  createMemoryCache,
  type FileCacheOptions,
  type FileSystemInterface,
  createFileCache,
  type KeyValueStore,
  type KVCacheOptions,
  createKVCache,
  type ListPageOptions,
  type ListPageResult,
  type StatePersistence,
  createStatePersistence,
  createHydratingCache,
} from "./persistence";

// =============================================================================
// Versioning
// =============================================================================
export {
  type Version,
  type MigrationFn,
  type Migrations,
  type VersionedState,
  type VersionedWorkflowConfig,
  type MigrationError,
  type VersionIncompatibleError,
  isMigrationError,
  isVersionIncompatibleError,
  migrateState,
  createVersionedStateLoader,
  createVersionedState,
  parseVersionedState,
  stringifyVersionedState,
  createKeyRenameMigration,
  createKeyRemoveMigration,
  createValueTransformMigration,
  composeMigrations,
} from "./versioning";
