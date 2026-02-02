/**
 * awaitly/persistence
 *
 * Simplified Persistence API for workflow snapshots.
 * Provides JSON-serializable snapshot format and store adapters.
 */

import type { Result } from "./core";
import type { StepCache } from "./workflow";

// =============================================================================
// JSON-Safe Type Enforcement
// =============================================================================

/**
 * Enforce JSON-safety at type level.
 * Only allows values that can be safely serialized with JSON.stringify.
 */
export type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [k: string]: JSONValue };

// =============================================================================
// WorkflowSnapshot Types (Simplified API)
// =============================================================================

/**
 * Canonical error wire format - handles both Error instances and thrown non-Errors.
 * This is the single source of truth for serialized errors in snapshots.
 */
export type SerializedCause =
  | { type: "error"; name: string; message: string; stack?: string; cause?: SerializedCause }
  | { type: "thrown"; originalType?: string; value?: JSONValue; stringRepresentation: string; truncated?: true };

/**
 * Single source of truth for step outcome (no error/cause confusion).
 * Uses discriminated union with `ok` field.
 */
export type StepResult =
  | { ok: true; value: JSONValue }
  | { ok: false; error: JSONValue; cause: SerializedCause; meta?: { origin: "result" | "throw" } };

/**
 * JSON-serializable workflow snapshot.
 * Designed to be passed directly to JSON.stringify without special handling.
 *
 * @example
 * ```typescript
 * // Persist
 * localStorage.setItem('wf-123', JSON.stringify(wf.getSnapshot()));
 *
 * // Restore (safe pattern - storage can be empty/corrupt)
 * const raw = localStorage.getItem('wf-123');
 * const snapshot = raw ? JSON.parse(raw) : null;
 * createWorkflow(deps, { snapshot });  // null = fresh start
 * ```
 */
export interface WorkflowSnapshot {
  /** Snapshot format version (literal type - bump when shape changes) */
  formatVersion: 1;
  /** Step results keyed by step ID. Uses Object.create(null) internally. */
  steps: Record<string, StepResult>;
  /** Execution state metadata */
  execution: {
    status: "running" | "completed" | "failed";
    /** ISO timestamp (UTC toISOString()) */
    lastUpdated: string;
    /** ISO timestamp if finished */
    completedAt?: string;
    /** For paused workflows */
    currentStepId?: string;
  };
  /** Optional metadata for workflow identification and replay */
  metadata?: {
    /** Detect wrong snapshot for wrong workflow */
    workflowId?: string;
    /** Optional: detect definition changes (user-supplied, advisory only) */
    definitionHash?: string;
    /** Original input for replay */
    input?: JSONValue;
    [key: string]: JSONValue | undefined;
  };
  /** Warnings for lossy serialization (keeps step results pure) */
  warnings?: Array<{
    type: "lossy_value";
    stepId: string;
    path: string;
    reason: "non-json" | "circular" | "encode-failed";
  }>;
}

/**
 * Warning entry for lossy value serialization.
 */
export type SnapshotWarning = NonNullable<WorkflowSnapshot["warnings"]>[number];

// =============================================================================
// Snapshot Validation
// =============================================================================

/**
 * Error thrown when snapshot structure is invalid.
 */
export class SnapshotFormatError extends Error {
  constructor(
    message: string,
    public readonly errors: string[] = []
  ) {
    super(message);
    this.name = "SnapshotFormatError";
  }
}

/**
 * Error thrown when snapshot doesn't match workflow (unknown steps, workflowId mismatch).
 */
export class SnapshotMismatchError extends Error {
  constructor(
    message: string,
    public readonly mismatchType: "unknown_steps" | "workflow_id" | "definition_hash",
    public readonly details?: {
      unknownSteps?: string[];
      snapshotWorkflowId?: string;
      expectedWorkflowId?: string;
      snapshotHash?: string;
      expectedHash?: string;
    }
  ) {
    super(message);
    this.name = "SnapshotMismatchError";
  }
}

/**
 * Error thrown when decode fails during restore.
 */
export class SnapshotDecodeError extends Error {
  constructor(
    message: string,
    public readonly stepId: string,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = "SnapshotDecodeError";
  }
}

/**
 * Light check to see if an object looks like a WorkflowSnapshot.
 * Cheap check for basic structure - use validateSnapshot() for full validation.
 *
 * @example
 * ```typescript
 * const raw = JSON.parse(localStorage.getItem('wf-123') || 'null');
 * if (looksLikeWorkflowSnapshot(raw)) {
 *   createWorkflow(deps, { snapshot: raw });
 * }
 * ```
 */
export function looksLikeWorkflowSnapshot(obj: unknown): obj is WorkflowSnapshot {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "formatVersion" in obj &&
    (obj as { formatVersion: unknown }).formatVersion === 1 &&
    "steps" in obj &&
    typeof (obj as { steps: unknown }).steps === "object" &&
    (obj as { steps: unknown }).steps !== null &&
    "execution" in obj &&
    typeof (obj as { execution: unknown }).execution === "object"
  );
}

/**
 * Full validation with detailed errors.
 * Returns either a validated snapshot or an array of validation errors.
 */
export function validateSnapshot(obj: unknown): { valid: true; snapshot: WorkflowSnapshot } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (typeof obj !== "object" || obj === null) {
    return { valid: false, errors: ["Snapshot must be an object"] };
  }

  const snapshot = obj as Record<string, unknown>;

  // Check formatVersion
  if (!("formatVersion" in snapshot)) {
    errors.push("Missing required field: formatVersion");
  } else if (snapshot.formatVersion !== 1) {
    errors.push(`Invalid formatVersion: expected 1, got ${snapshot.formatVersion}`);
  }

  // Check steps
  if (!("steps" in snapshot)) {
    errors.push("Missing required field: steps");
  } else if (typeof snapshot.steps !== "object" || snapshot.steps === null) {
    errors.push("steps must be an object");
  } else {
    // Validate each step result
    const steps = snapshot.steps as Record<string, unknown>;
    for (const [stepId, stepResult] of Object.entries(steps)) {
      if (typeof stepResult !== "object" || stepResult === null) {
        errors.push(`steps["${stepId}"] must be an object`);
        continue;
      }

      const step = stepResult as Record<string, unknown>;
      if (!("ok" in step)) {
        errors.push(`steps["${stepId}"] missing required field: ok`);
      } else if (typeof step.ok !== "boolean") {
        errors.push(`steps["${stepId}"].ok must be a boolean`);
      } else if (step.ok === false) {
        if (!("error" in step)) {
          errors.push(`steps["${stepId}"] is error result but missing error field`);
        }
        if (!("cause" in step)) {
          errors.push(`steps["${stepId}"] is error result but missing cause field`);
        }
      }
    }
  }

  // Check execution
  if (!("execution" in snapshot)) {
    errors.push("Missing required field: execution");
  } else if (typeof snapshot.execution !== "object" || snapshot.execution === null) {
    errors.push("execution must be an object");
  } else {
    const execution = snapshot.execution as Record<string, unknown>;
    if (!("status" in execution)) {
      errors.push("execution missing required field: status");
    } else if (!["running", "completed", "failed"].includes(execution.status as string)) {
      errors.push(`execution.status must be one of: running, completed, failed`);
    }
    if (!("lastUpdated" in execution)) {
      errors.push("execution missing required field: lastUpdated");
    } else if (typeof execution.lastUpdated !== "string") {
      errors.push("execution.lastUpdated must be a string (ISO timestamp)");
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, snapshot: obj as WorkflowSnapshot };
}

/**
 * Throwing helper for cleaner code.
 * Validates a snapshot and throws SnapshotFormatError if invalid.
 *
 * @throws {SnapshotFormatError} If snapshot is invalid
 */
export function assertValidSnapshot(obj: unknown): WorkflowSnapshot {
  const result = validateSnapshot(obj);
  if (!result.valid) {
    throw new SnapshotFormatError(`Invalid snapshot format: ${result.errors[0]}`, result.errors);
  }
  return result.snapshot;
}

// =============================================================================
// Snapshot Merge Helper
// =============================================================================

/**
 * Merge two snapshots (for incremental updates).
 * Delta steps overwrite base steps; execution from delta; metadata shallow merge.
 */
export function mergeSnapshots(base: WorkflowSnapshot, delta: WorkflowSnapshot): WorkflowSnapshot {
  // Create new steps object using Object.create(null) for prototype safety
  const mergedSteps = Object.create(null) as Record<string, StepResult>;

  // Copy base steps (use Object.prototype.hasOwnProperty for ES2020 compat)
  for (const [key, value] of Object.entries(base.steps)) {
    if (Object.prototype.hasOwnProperty.call(base.steps, key)) {
      mergedSteps[key] = value;
    }
  }

  // Overlay delta steps
  for (const [key, value] of Object.entries(delta.steps)) {
    if (Object.prototype.hasOwnProperty.call(delta.steps, key)) {
      mergedSteps[key] = value;
    }
  }

  // Merge metadata (delta wins for conflicts)
  const mergedMetadata = base.metadata || delta.metadata
    ? { ...base.metadata, ...delta.metadata }
    : undefined;

  // Merge warnings: only keep base warnings for steps not re-executed in delta.
  // If a step was re-executed and serialized cleanly, its old warning should disappear.
  const baseWarnings = (base.warnings || []).filter(
    (w) => !Object.prototype.hasOwnProperty.call(delta.steps, w.stepId)
  );
  const mergedWarnings = [...baseWarnings, ...(delta.warnings || [])];

  return {
    formatVersion: 1,
    steps: mergedSteps,
    execution: { ...delta.execution },
    metadata: mergedMetadata,
    warnings: mergedWarnings.length > 0 ? mergedWarnings : undefined,
  };
}

// =============================================================================
// Serialization Helpers
// =============================================================================

/**
 * Maximum length for string representation in thrown non-Error values.
 */
const MAX_STRING_REPRESENTATION_LENGTH = 1000;

/**
 * Serialize an Error object to SerializedCause format.
 * Preserves Error.cause recursively.
 */
export function serializeError(error: Error): SerializedCause {
  const serialized: SerializedCause = {
    type: "error",
    name: error.name,
    message: error.message,
  };

  if (error.stack) {
    serialized.stack = error.stack;
  }

  // Recursively serialize Error.cause if present (ES2022 feature, but commonly available)
  const errorWithCause = error as Error & { cause?: unknown };
  if (errorWithCause.cause !== undefined) {
    if (errorWithCause.cause instanceof Error) {
      serialized.cause = serializeError(errorWithCause.cause);
    } else {
      // cause is not an Error, serialize as thrown value
      serialized.cause = serializeThrown(errorWithCause.cause);
    }
  }

  return serialized;
}

/**
 * Serialize a non-Error thrown value to SerializedCause format.
 */
export function serializeThrown(value: unknown): SerializedCause {
  // Get string representation
  let stringRepresentation: string;
  let truncated = false;

  try {
    stringRepresentation = String(value);
    if (stringRepresentation.length > MAX_STRING_REPRESENTATION_LENGTH) {
      stringRepresentation = stringRepresentation.slice(0, MAX_STRING_REPRESENTATION_LENGTH);
      truncated = true;
    }
  } catch {
    stringRepresentation = "[unable to convert to string]";
  }

  // Try to get the original type
  const originalType = value === null
    ? "null"
    : typeof value === "object"
      ? (value.constructor?.name ?? "Object")
      : typeof value;

  // Try to serialize the value as JSON
  let jsonValue: JSONValue | undefined;
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) {
      jsonValue = JSON.parse(serialized) as JSONValue;
    }
  } catch {
    // Non-JSON-serializable, will only use stringRepresentation
  }

  const result: SerializedCause = {
    type: "thrown",
    originalType,
    stringRepresentation,
  };

  if (jsonValue !== undefined) {
    result.value = jsonValue;
  }

  if (truncated) {
    result.truncated = true;
  }

  return result;
}

/**
 * Deserialize a SerializedCause back to its original form.
 */
export function deserializeCauseNew(serialized: SerializedCause): unknown {
  if (serialized.type === "error") {
    const error = new Error(serialized.message);
    error.name = serialized.name;
    if (serialized.stack) {
      error.stack = serialized.stack;
    }
    if (serialized.cause) {
      (error as Error & { cause: unknown }).cause = deserializeCauseNew(serialized.cause);
    }
    return error;
  }

  // type === "thrown"
  // Return the JSON value if available, otherwise the string representation
  return serialized.value !== undefined ? serialized.value : serialized.stringRepresentation;
}

// =============================================================================
// SnapshotStore Interface (New Simplified API)
// =============================================================================

/**
 * Simplified store interface for workflow snapshot persistence.
 * Works directly with WorkflowSnapshot objects.
 *
 * @example
 * ```typescript
 * import { postgres } from 'awaitly-postgres';
 *
 * // One-liner setup
 * const store = postgres('postgresql://localhost/mydb');
 *
 * // Execute + persist
 * const wf = createWorkflow(deps);
 * await wf(myWorkflowFn);
 * await store.save('wf-123', wf.getSnapshot());
 *
 * // Restore
 * const snapshot = await store.load('wf-123');
 * const wf2 = createWorkflow(deps, { snapshot });
 * await wf2(myWorkflowFn);
 * ```
 */
export interface SnapshotStore {
  /** Save a workflow snapshot (upsert - insert or update). */
  save(id: string, snapshot: WorkflowSnapshot): Promise<void>;
  /** Load a workflow snapshot. Returns null if not found. */
  load(id: string): Promise<WorkflowSnapshot | null>;
  /** Delete a workflow snapshot. */
  delete(id: string): Promise<void>;
  /** List workflow IDs with their last update time. */
  list(options?: { prefix?: string; limit?: number }): Promise<Array<{ id: string; updatedAt: string }>>;
  /** Clean shutdown for tests/graceful exit. */
  close(): Promise<void>;
}

// =============================================================================
// In-Memory Cache Adapter
// =============================================================================

/**
 * Options for the in-memory cache adapter.
 */
export interface MemoryCacheOptions {
  /**
   * Maximum number of entries to store.
   * Oldest entries are evicted when limit is reached.
   */
  maxSize?: number;

  /**
   * Time-to-live in milliseconds.
   * Entries are automatically removed after this duration.
   */
  ttl?: number;
}

/**
 * Create an in-memory StepCache with optional LRU eviction and TTL.
 *
 * @param options - Cache options
 * @returns StepCache implementation
 *
 * @example
 * ```typescript
 * const cache = createMemoryCache({ maxSize: 1000, ttl: 60000 });
 * const workflow = createWorkflow(deps, { cache });
 * ```
 */
export function createMemoryCache(options: MemoryCacheOptions = {}): StepCache {
  const { maxSize, ttl } = options;
  const cache = new Map<string, {
    result: Result<unknown, unknown, unknown>;
    timestamp: number;
    entryTtl?: number;
  }>();

  const isExpired = (entry: { timestamp: number; entryTtl?: number }): boolean => {
    const effectiveTtl = entry.entryTtl ?? ttl;
    if (!effectiveTtl) return false;
    return Date.now() - entry.timestamp > effectiveTtl;
  };

  const evictExpired = (): void => {
    for (const [key, entry] of cache) {
      if (isExpired(entry)) {
        cache.delete(key);
      }
    }
  };

  const evictOldest = (): void => {
    if (!maxSize || cache.size < maxSize) return;

    // Find oldest entry
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      cache.delete(oldestKey);
    }
  };

  return {
    get(key: string): Result<unknown, unknown, unknown> | undefined {
      evictExpired();
      const entry = cache.get(key);
      if (!entry) return undefined;
      if (isExpired(entry)) {
        cache.delete(key);
        return undefined;
      }
      return entry.result;
    },

    set(key: string, result: Result<unknown, unknown, unknown>, options?: { ttl?: number }): void {
      evictExpired();
      evictOldest();
      cache.set(key, { result, timestamp: Date.now(), entryTtl: options?.ttl });
    },

    has(key: string): boolean {
      evictExpired();
      const entry = cache.get(key);
      if (!entry) return false;
      if (isExpired(entry)) {
        cache.delete(key);
        return false;
      }
      return true;
    },

    delete(key: string): boolean {
      return cache.delete(key);
    },

    clear(): void {
      cache.clear();
    },
  };
}
