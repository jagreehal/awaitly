/**
 * Workflow Versioning and Migration
 *
 * Handle schema changes when resuming workflows that were persisted
 * with older step shapes.
 *
 * @example
 * ```typescript
 * import { createVersionedWorkflow } from 'awaitly';
 *
 * const workflow = createVersionedWorkflow(
 *   { fetchUser, chargeCard },
 *   {
 *     version: 2,
 *     migrations: {
 *       1: (state) => migrateV1ToV2(state),
 *     },
 *     resumeState: loadState(runId),
 *   }
 * );
 * ```
 */

import type { ResumeState, ResumeStateEntry } from "./workflow";
import { ok, err, type Result } from "./core";

// =============================================================================
// Types
// =============================================================================

/**
 * Version number type.
 */
export type Version = number;

/**
 * Migration function that transforms state from one version to the next.
 */
export type MigrationFn = (state: ResumeState) => ResumeState | Promise<ResumeState>;

/**
 * Map of migrations keyed by the source version.
 * Migration at key N transforms state from version N to version N+1.
 */
export type Migrations = Record<Version, MigrationFn>;

/**
 * Versioned state includes the version number.
 */
export interface VersionedState {
  version: Version;
  state: ResumeState;
}

/**
 * Configuration for versioned workflow.
 */
export interface VersionedWorkflowConfig {
  /**
   * Current workflow version.
   */
  version: Version;

  /**
   * Migrations for upgrading old states.
   * Key is the source version, value transforms to next version.
   */
  migrations?: Migrations;

  /**
   * Strict mode - fail if state version is higher than current.
   * @default true
   */
  strictVersioning?: boolean;
}

/**
 * Error when version migration fails.
 */
export interface MigrationError {
  type: "MIGRATION_ERROR";
  fromVersion: Version;
  toVersion: Version;
  cause: unknown;
}

/**
 * Error when state version is incompatible.
 */
export interface VersionIncompatibleError {
  type: "VERSION_INCOMPATIBLE";
  stateVersion: Version;
  currentVersion: Version;
  reason: string;
}

/**
 * Type guard for MigrationError.
 */
export function isMigrationError(error: unknown): error is MigrationError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as MigrationError).type === "MIGRATION_ERROR"
  );
}

/**
 * Type guard for VersionIncompatibleError.
 */
export function isVersionIncompatibleError(
  error: unknown
): error is VersionIncompatibleError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as VersionIncompatibleError).type === "VERSION_INCOMPATIBLE"
  );
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Migrate state from one version to another.
 *
 * @param state - The versioned state to migrate
 * @param targetVersion - The target version
 * @param migrations - Migration functions
 * @returns The migrated state or an error
 *
 * @example
 * ```typescript
 * const migrated = await migrateState(
 *   { version: 1, state: oldState },
 *   3,
 *   {
 *     1: (s) => transformV1ToV2(s),
 *     2: (s) => transformV2ToV3(s),
 *   }
 * );
 * ```
 */
export async function migrateState(
  state: VersionedState,
  targetVersion: Version,
  migrations: Migrations
): Promise<Result<VersionedState, MigrationError | VersionIncompatibleError>> {
  let currentState = state.state;
  let currentVersion = state.version;

  // Check if state is from the future
  if (currentVersion > targetVersion) {
    return err({
      type: "VERSION_INCOMPATIBLE",
      stateVersion: currentVersion,
      currentVersion: targetVersion,
      reason: "State version is higher than current workflow version. Cannot downgrade.",
    });
  }

  // Already at target version
  if (currentVersion === targetVersion) {
    return ok({ version: currentVersion, state: currentState });
  }

  // Apply migrations sequentially
  while (currentVersion < targetVersion) {
    const migration = migrations[currentVersion];

    if (!migration) {
      return err({
        type: "VERSION_INCOMPATIBLE",
        stateVersion: state.version,
        currentVersion: targetVersion,
        reason: `No migration found for version ${currentVersion} to ${currentVersion + 1}`,
      });
    }

    try {
      currentState = await migration(currentState);
      currentVersion++;
    } catch (cause) {
      return err({
        type: "MIGRATION_ERROR",
        fromVersion: currentVersion,
        toVersion: currentVersion + 1,
        cause,
      });
    }
  }

  return ok({ version: currentVersion, state: currentState });
}

/**
 * Create a versioned resume state loader.
 *
 * This wraps a state loader to automatically apply migrations
 * when loading older state versions.
 *
 * @param config - Versioning configuration
 * @returns A function that loads and migrates state
 *
 * @example
 * ```typescript
 * const loadVersionedState = createVersionedStateLoader({
 *   version: 3,
 *   migrations: {
 *     1: migrateV1ToV2,
 *     2: migrateV2ToV3,
 *   },
 * });
 *
 * // In workflow
 * const workflow = createWorkflow(deps, {
 *   resumeState: () => loadVersionedState(savedState),
 * });
 * ```
 */
export function createVersionedStateLoader(
  config: VersionedWorkflowConfig
): (
  versionedState: VersionedState | null | undefined
) => Promise<Result<ResumeState | undefined, MigrationError | VersionIncompatibleError>> {
  const { version, migrations = {}, strictVersioning = true } = config;

  return async (
    versionedState: VersionedState | null | undefined
  ): Promise<Result<ResumeState | undefined, MigrationError | VersionIncompatibleError>> => {
    // No saved state
    if (!versionedState) {
      return ok(undefined);
    }

    // Check for future version
    if (strictVersioning && versionedState.version > version) {
      return err({
        type: "VERSION_INCOMPATIBLE",
        stateVersion: versionedState.version,
        currentVersion: version,
        reason: "Saved state is from a newer workflow version",
      });
    }

    // Same version - no migration needed
    if (versionedState.version === version) {
      return ok(versionedState.state);
    }

    // Apply migrations
    const result = await migrateState(versionedState, version, migrations);
    if (!result.ok) {
      return result;
    }

    return ok(result.value.state);
  };
}

/**
 * Create versioned state from current resume state.
 *
 * Use this when saving state to storage.
 *
 * @param state - The current resume state
 * @param version - The current workflow version
 * @returns A versioned state object
 *
 * @example
 * ```typescript
 * const collector = createResumeStateCollector();
 * // ... run workflow ...
 *
 * const versionedState = createVersionedState(collector.getResumeState(), 2);
 * await db.saveWorkflowState(workflowId, versionedState);
 * ```
 */
export function createVersionedState(
  state: ResumeState,
  version: Version
): VersionedState {
  return { version, state };
}

/**
 * Parse versioned state from JSON.
 *
 * Handles the serialization/deserialization of ResumeState with Map.
 *
 * @param json - The JSON string or parsed object
 * @returns The versioned state or null if invalid
 *
 * @example
 * ```typescript
 * const json = await db.loadWorkflowState(workflowId);
 * const versionedState = parseVersionedState(json);
 * if (versionedState) {
 *   const loader = createVersionedStateLoader(config);
 *   const state = await loader(versionedState);
 * }
 * ```
 */
interface SerializedVersionedState {
  version: number;
  state: { steps: Array<[string, ResumeStateEntry]> };
}

export function parseVersionedState(
  json: string | SerializedVersionedState | null | undefined
): VersionedState | null {
  if (!json) return null;

  try {
    const parsed: unknown = typeof json === "string" ? JSON.parse(json) : json;

    // Type guard
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      typeof (parsed as SerializedVersionedState).version !== "number" ||
      !("state" in parsed) ||
      !(parsed as SerializedVersionedState).state ||
      !Array.isArray((parsed as SerializedVersionedState).state.steps)
    ) {
      return null;
    }

    const typedParsed = parsed as SerializedVersionedState;

    // Convert steps array back to Map
    const steps = new Map<string, ResumeStateEntry>(typedParsed.state.steps);

    return {
      version: typedParsed.version,
      state: { steps },
    };
  } catch {
    return null;
  }
}

/**
 * Serialize versioned state to JSON.
 *
 * Converts the Map to an array for JSON serialization.
 *
 * @param state - The versioned state
 * @returns JSON string
 *
 * @example
 * ```typescript
 * const json = stringifyVersionedState(versionedState);
 * await db.saveWorkflowState(workflowId, json);
 * ```
 */
export function stringifyVersionedState(state: VersionedState): string {
  return JSON.stringify({
    version: state.version,
    state: {
      steps: Array.from(state.state.steps.entries()),
    },
  });
}

// =============================================================================
// Migration Helpers
// =============================================================================

/**
 * Create a migration that renames step keys.
 *
 * @param renames - Map of old key to new key
 * @returns A migration function
 *
 * @example
 * ```typescript
 * const migrations = {
 *   1: createKeyRenameMigration({
 *     'user:fetch': 'user:load',
 *     'order:create': 'order:submit',
 *   }),
 * };
 * ```
 */
export function createKeyRenameMigration(
  renames: Record<string, string>
): MigrationFn {
  return (state: ResumeState): ResumeState => {
    const newSteps = new Map<string, ResumeStateEntry>();

    for (const [key, entry] of state.steps) {
      const newKey = renames[key] ?? key;
      newSteps.set(newKey, entry);
    }

    return { steps: newSteps };
  };
}

/**
 * Create a migration that removes specific step keys.
 *
 * @param keysToRemove - Array of keys to remove
 * @returns A migration function
 *
 * @example
 * ```typescript
 * const migrations = {
 *   1: createKeyRemoveMigration(['deprecated:step', 'old:cache']),
 * };
 * ```
 */
export function createKeyRemoveMigration(keysToRemove: string[]): MigrationFn {
  const keysSet = new Set(keysToRemove);
  return (state: ResumeState): ResumeState => {
    const newSteps = new Map<string, ResumeStateEntry>();

    for (const [key, entry] of state.steps) {
      if (!keysSet.has(key)) {
        newSteps.set(key, entry);
      }
    }

    return { steps: newSteps };
  };
}

/**
 * Create a migration that transforms step values.
 *
 * @param transforms - Map of key to transform function
 * @returns A migration function
 *
 * @example
 * ```typescript
 * const migrations = {
 *   1: createValueTransformMigration({
 *     'user:fetch': (entry) => ({
 *       ...entry,
 *       result: entry.result.ok
 *         ? ok({ ...entry.result.value, newField: 'default' })
 *         : entry.result,
 *     }),
 *   }),
 * };
 * ```
 */
export function createValueTransformMigration(
  transforms: Record<string, (entry: ResumeStateEntry) => ResumeStateEntry>
): MigrationFn {
  return (state: ResumeState): ResumeState => {
    const newSteps = new Map<string, ResumeStateEntry>();

    for (const [key, entry] of state.steps) {
      const transform = transforms[key];
      newSteps.set(key, transform ? transform(entry) : entry);
    }

    return { steps: newSteps };
  };
}

/**
 * Compose multiple migrations into a single migration.
 *
 * @param migrations - Array of migration functions
 * @returns A single migration function that applies all migrations in order
 *
 * @example
 * ```typescript
 * const migrations = {
 *   1: composeMigrations([
 *     createKeyRenameMigration({ 'old': 'new' }),
 *     createKeyRemoveMigration(['deprecated']),
 *   ]),
 * };
 * ```
 */
export function composeMigrations(migrations: MigrationFn[]): MigrationFn {
  return async (state: ResumeState): Promise<ResumeState> => {
    let currentState = state;
    for (const migration of migrations) {
      currentState = await migration(currentState);
    }
    return currentState;
  };
}
