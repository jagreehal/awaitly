/**
 * awaitly/persistence
 *
 * Pluggable Persistence Adapters for StepCache and ResumeState.
 * Provides adapters for Redis, file system, and in-memory storage,
 * plus helpers for JSON-safe serialization of causes.
 */

import type { Result, StepFailureMeta } from "./core";
import { ok, err } from "./core";
import type { StepCache, ResumeState, ResumeStateEntry } from "./workflow";

// =============================================================================
// Serialization Types
// =============================================================================

/**
 * JSON-safe representation of a Result.
 */
export interface SerializedResult {
  ok: boolean;
  value?: unknown;
  error?: unknown;
  cause?: SerializedCause;
}

/**
 * JSON-safe representation of a cause value.
 * Handles Error objects and other non-JSON-safe types.
 */
export interface SerializedCause {
  type: "error" | "value" | "undefined";
  errorName?: string;
  errorMessage?: string;
  errorStack?: string;
  value?: unknown;
}

/**
 * JSON-safe representation of StepFailureMeta.
 */
export interface SerializedMeta {
  origin: "result" | "throw";
  resultCause?: SerializedCause;
  thrown?: SerializedCause;
}

/**
 * JSON-safe representation of a ResumeStateEntry.
 */
export interface SerializedEntry {
  result: SerializedResult;
  meta?: SerializedMeta;
}

/**
 * JSON-safe representation of ResumeState.
 */
export interface SerializedState {
  version: number;
  entries: Record<string, SerializedEntry>;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Serialization Helpers
// =============================================================================

/**
 * Serialize a cause value to a JSON-safe format.
 */
export function serializeCause(cause: unknown): SerializedCause {
  if (cause === undefined) {
    return { type: "undefined" };
  }

  if (cause instanceof Error) {
    return {
      type: "error",
      errorName: cause.name,
      errorMessage: cause.message,
      errorStack: cause.stack,
    };
  }

  // Try to serialize as JSON
  try {
    // Test if it's JSON-serializable
    JSON.stringify(cause);
    return { type: "value", value: cause };
  } catch {
    // Fall back to string representation
    return { type: "value", value: String(cause) };
  }
}

/**
 * Deserialize a cause value from JSON-safe format.
 */
export function deserializeCause(serialized: SerializedCause): unknown {
  if (serialized.type === "undefined") {
    return undefined;
  }

  if (serialized.type === "error") {
    const error = new Error(serialized.errorMessage ?? "Unknown error");
    error.name = serialized.errorName ?? "Error";
    if (serialized.errorStack) {
      error.stack = serialized.errorStack;
    }
    return error;
  }

  return serialized.value;
}

/**
 * Serialize a Result to a JSON-safe format.
 */
export function serializeResult(result: Result<unknown, unknown, unknown>): SerializedResult {
  if (result.ok) {
    return { ok: true, value: result.value };
  }

  return {
    ok: false,
    error: result.error,
    cause: result.cause !== undefined ? serializeCause(result.cause) : undefined,
  };
}

/**
 * Deserialize a Result from JSON-safe format.
 */
export function deserializeResult(serialized: SerializedResult): Result<unknown, unknown, unknown> {
  if (serialized.ok) {
    return ok(serialized.value);
  }

  const cause = serialized.cause ? deserializeCause(serialized.cause) : undefined;
  return err(serialized.error, cause !== undefined ? { cause } : undefined);
}

/**
 * Serialize StepFailureMeta to a JSON-safe format.
 */
export function serializeMeta(meta: StepFailureMeta): SerializedMeta {
  if (meta.origin === "result") {
    return {
      origin: "result",
      resultCause: meta.resultCause !== undefined ? serializeCause(meta.resultCause) : undefined,
    };
  }

  return {
    origin: "throw",
    thrown: serializeCause(meta.thrown),
  };
}

/**
 * Deserialize StepFailureMeta from JSON-safe format.
 */
export function deserializeMeta(serialized: SerializedMeta): StepFailureMeta {
  if (serialized.origin === "result") {
    return {
      origin: "result",
      resultCause: serialized.resultCause ? deserializeCause(serialized.resultCause) : undefined,
    };
  }

  return {
    origin: "throw",
    thrown: serialized.thrown ? deserializeCause(serialized.thrown) : undefined,
  };
}

/**
 * Serialize a ResumeStateEntry to a JSON-safe format.
 */
export function serializeEntry(entry: ResumeStateEntry): SerializedEntry {
  return {
    result: serializeResult(entry.result),
    meta: entry.meta ? serializeMeta(entry.meta) : undefined,
  };
}

/**
 * Deserialize a ResumeStateEntry from JSON-safe format.
 */
export function deserializeEntry(serialized: SerializedEntry): ResumeStateEntry {
  return {
    result: deserializeResult(serialized.result),
    meta: serialized.meta ? deserializeMeta(serialized.meta) : undefined,
  };
}

/**
 * Serialize ResumeState to a JSON-safe format.
 */
export function serializeState(state: ResumeState, metadata?: Record<string, unknown>): SerializedState {
  const entries: Record<string, SerializedEntry> = {};

  for (const [key, entry] of state.steps) {
    entries[key] = serializeEntry(entry);
  }

  return {
    version: 1,
    entries,
    metadata,
  };
}

/**
 * Deserialize ResumeState from JSON-safe format.
 */
export function deserializeState(serialized: SerializedState): ResumeState {
  const steps = new Map<string, ResumeStateEntry>();

  for (const [key, entry] of Object.entries(serialized.entries)) {
    steps.set(key, deserializeEntry(entry));
  }

  return { steps };
}

/**
 * Convert ResumeState to a JSON string.
 */
export function stringifyState(state: ResumeState, metadata?: Record<string, unknown>): string {
  return JSON.stringify(serializeState(state, metadata));
}

/**
 * Parse ResumeState from a JSON string.
 */
export function parseState(json: string): ResumeState {
  const serialized = JSON.parse(json) as SerializedState;
  return deserializeState(serialized);
}

// =============================================================================
// In-Memory Adapter
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

// =============================================================================
// File System Adapter
// =============================================================================

/**
 * Options for the file system cache adapter.
 */
export interface FileCacheOptions {
  /**
   * Directory to store cache files.
   */
  directory: string;

  /**
   * File extension for cache files.
   * @default '.json'
   */
  extension?: string;

  /**
   * Custom file system interface (for testing or custom implementations).
   */
  fs?: FileSystemInterface;
}

/**
 * Minimal file system interface for cache operations.
 */
export interface FileSystemInterface {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  unlink(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
}

/**
 * Create a file system-based StepCache.
 * Each step result is stored as a separate JSON file.
 *
 * @param options - Cache options
 * @returns StepCache implementation (async operations wrapped in sync interface)
 *
 * @example
 * ```typescript
 * import * as fs from 'fs/promises';
 *
 * const cache = createFileCache({
 *   directory: './workflow-cache',
 *   fs: {
 *     readFile: (path) => fs.readFile(path, 'utf-8'),
 *     writeFile: (path, data) => fs.writeFile(path, data, 'utf-8'),
 *     unlink: fs.unlink,
 *     exists: async (path) => fs.access(path).then(() => true).catch(() => false),
 *     readdir: fs.readdir,
 *     mkdir: fs.mkdir,
 *   },
 * });
 * ```
 */
export function createFileCache(options: FileCacheOptions): StepCache & {
  /** Initialize the cache directory. Call before using the cache. */
  init(): Promise<void>;
  /** Get a result asynchronously. */
  getAsync(key: string): Promise<Result<unknown, unknown, unknown> | undefined>;
  /** Set a result asynchronously. */
  setAsync(key: string, result: Result<unknown, unknown, unknown>): Promise<void>;
  /** Delete a result asynchronously. */
  deleteAsync(key: string): Promise<boolean>;
  /** Clear all results asynchronously. */
  clearAsync(): Promise<void>;
} {
  const { directory, extension = ".json", fs } = options;

  if (!fs) {
    throw new Error("File system interface is required. Pass fs option with readFile, writeFile, etc.");
  }

  const keyToPath = (key: string): string => {
    // Sanitize key for file system
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `${directory}/${safeKey}${extension}`;
  };

  // In-memory fallback for sync operations
  const memoryCache = new Map<string, Result<unknown, unknown, unknown>>();

  return {
    async init(): Promise<void> {
      await fs.mkdir(directory, { recursive: true });
    },

    get(key: string): Result<unknown, unknown, unknown> | undefined {
      // Sync operation uses memory cache
      return memoryCache.get(key);
    },

    async getAsync(key: string): Promise<Result<unknown, unknown, unknown> | undefined> {
      const path = keyToPath(key);
      try {
        if (!(await fs.exists(path))) return undefined;
        const data = await fs.readFile(path);
        const serialized = JSON.parse(data) as SerializedResult;
        const result = deserializeResult(serialized);
        memoryCache.set(key, result);
        return result;
      } catch {
        return undefined;
      }
    },

    set(key: string, result: Result<unknown, unknown, unknown>): void {
      // Sync operation updates memory cache
      memoryCache.set(key, result);
    },

    async setAsync(key: string, result: Result<unknown, unknown, unknown>): Promise<void> {
      const path = keyToPath(key);
      const serialized = serializeResult(result);
      await fs.writeFile(path, JSON.stringify(serialized, null, 2));
      memoryCache.set(key, result);
    },

    has(key: string): boolean {
      return memoryCache.has(key);
    },

    delete(key: string): boolean {
      return memoryCache.delete(key);
    },

    async deleteAsync(key: string): Promise<boolean> {
      const path = keyToPath(key);
      try {
        await fs.unlink(path);
        memoryCache.delete(key);
        return true;
      } catch {
        return false;
      }
    },

    clear(): void {
      memoryCache.clear();
    },

    async clearAsync(): Promise<void> {
      try {
        const files = await fs.readdir(directory);
        for (const file of files) {
          if (file.endsWith(extension)) {
            await fs.unlink(`${directory}/${file}`);
          }
        }
        memoryCache.clear();
      } catch {
        // Directory may not exist
      }
    },
  };
}

// =============================================================================
// Key-Value Store Adapter
// =============================================================================

/**
 * Generic key-value store interface.
 * Implement this for Redis, DynamoDB, etc.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ttl?: number }): Promise<void>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
}

/**
 * Options for key-value store cache adapter.
 */
export interface KVCacheOptions {
  /**
   * Key-value store implementation.
   */
  store: KeyValueStore;

  /**
   * Key prefix for all cache entries.
   * @default 'workflow:'
   */
  prefix?: string;

  /**
   * Time-to-live in seconds for cache entries.
   */
  ttl?: number;
}

/**
 * Create a StepCache backed by a key-value store (Redis, DynamoDB, etc.).
 *
 * @param options - Cache options
 * @returns StepCache implementation with async methods
 *
 * @example
 * ```typescript
 * // With Redis
 * import { createClient } from 'redis';
 *
 * const redis = createClient();
 * await redis.connect();
 *
 * const cache = createKVCache({
 *   store: {
 *     get: (key) => redis.get(key),
 *     set: (key, value, opts) => redis.set(key, value, { EX: opts?.ttl }),
 *     delete: (key) => redis.del(key).then(n => n > 0),
 *     exists: (key) => redis.exists(key).then(n => n > 0),
 *     keys: (pattern) => redis.keys(pattern),
 *   },
 *   prefix: 'myapp:workflow:',
 *   ttl: 3600, // 1 hour
 * });
 * ```
 */
export function createKVCache(options: KVCacheOptions): StepCache & {
  /** Get a result asynchronously. */
  getAsync(key: string): Promise<Result<unknown, unknown, unknown> | undefined>;
  /** Set a result asynchronously. */
  setAsync(key: string, result: Result<unknown, unknown, unknown>): Promise<void>;
  /** Check if key exists asynchronously. */
  hasAsync(key: string): Promise<boolean>;
  /** Delete a result asynchronously. */
  deleteAsync(key: string): Promise<boolean>;
  /** Clear all results asynchronously. */
  clearAsync(): Promise<void>;
} {
  const { store, prefix = "workflow:", ttl } = options;

  const prefixKey = (key: string): string => `${prefix}${key}`;

  // In-memory fallback for sync operations
  const memoryCache = new Map<string, Result<unknown, unknown, unknown>>();

  return {
    get(key: string): Result<unknown, unknown, unknown> | undefined {
      return memoryCache.get(key);
    },

    async getAsync(key: string): Promise<Result<unknown, unknown, unknown> | undefined> {
      const data = await store.get(prefixKey(key));
      if (!data) return undefined;

      try {
        const serialized = JSON.parse(data) as SerializedResult;
        const result = deserializeResult(serialized);
        memoryCache.set(key, result);
        return result;
      } catch {
        return undefined;
      }
    },

    set(key: string, result: Result<unknown, unknown, unknown>): void {
      memoryCache.set(key, result);
    },

    async setAsync(key: string, result: Result<unknown, unknown, unknown>): Promise<void> {
      const serialized = serializeResult(result);
      await store.set(prefixKey(key), JSON.stringify(serialized), ttl ? { ttl } : undefined);
      memoryCache.set(key, result);
    },

    has(key: string): boolean {
      return memoryCache.has(key);
    },

    async hasAsync(key: string): Promise<boolean> {
      return store.exists(prefixKey(key));
    },

    delete(key: string): boolean {
      return memoryCache.delete(key);
    },

    async deleteAsync(key: string): Promise<boolean> {
      memoryCache.delete(key);
      return store.delete(prefixKey(key));
    },

    clear(): void {
      memoryCache.clear();
    },

    async clearAsync(): Promise<void> {
      const keys = await store.keys(`${prefix}*`);
      for (const key of keys) {
        await store.delete(key);
      }
      memoryCache.clear();
    },
  };
}

// =============================================================================
// State Persistence
// =============================================================================

/**
 * Interface for persisting workflow state.
 */
export interface StatePersistence {
  /**
   * Save workflow state.
   */
  save(runId: string, state: ResumeState, metadata?: Record<string, unknown>): Promise<void>;

  /**
   * Load workflow state.
   */
  load(runId: string): Promise<ResumeState | undefined>;

  /**
   * Delete workflow state.
   */
  delete(runId: string): Promise<boolean>;

  /**
   * List all saved workflow IDs.
   */
  list(): Promise<string[]>;
}

/**
 * Create a state persistence adapter using a key-value store.
 *
 * @param store - Key-value store implementation
 * @param prefix - Key prefix for state entries
 * @returns StatePersistence implementation
 */
export function createStatePersistence(
  store: KeyValueStore,
  prefix = "workflow:state:"
): StatePersistence & {
  /** Load raw serialized state including metadata (for version checking) */
  loadRaw(runId: string): Promise<SerializedState | undefined>;
} {
  const prefixKey = (runId: string): string => `${prefix}${runId}`;

  return {
    async save(runId: string, state: ResumeState, metadata?: Record<string, unknown>): Promise<void> {
      const serialized = serializeState(state, metadata);
      await store.set(prefixKey(runId), JSON.stringify(serialized));
    },

    async load(runId: string): Promise<ResumeState | undefined> {
      const data = await store.get(prefixKey(runId));
      if (!data) return undefined;

      try {
        const serialized = JSON.parse(data) as SerializedState;
        return deserializeState(serialized);
      } catch {
        return undefined;
      }
    },

    async loadRaw(runId: string): Promise<SerializedState | undefined> {
      const data = await store.get(prefixKey(runId));
      if (!data) return undefined;

      try {
        return JSON.parse(data) as SerializedState;
      } catch {
        return undefined;
      }
    },

    async delete(runId: string): Promise<boolean> {
      return store.delete(prefixKey(runId));
    },

    async list(): Promise<string[]> {
      const keys = await store.keys(`${prefix}*`);
      return keys.map((key) => key.slice(prefix.length));
    },
  };
}

// =============================================================================
// Memory State Persistence
// =============================================================================

/**
 * Options for the in-memory state persistence adapter.
 */
export interface MemoryStatePersistenceOptions {
  /**
   * Time-to-live in milliseconds.
   * State entries are automatically removed after this duration.
   */
  ttl?: number;
}

/**
 * Create an in-memory StatePersistence for testing and development.
 *
 * @param options - Persistence options
 * @returns StatePersistence implementation
 *
 * @example
 * ```typescript
 * import { createMemoryStatePersistence } from 'awaitly/persistence';
 *
 * const store = createMemoryStatePersistence();
 *
 * // Use with durable.run()
 * const result = await durable.run(deps, workflow, {
 *   id: 'order-123',
 *   store,
 * });
 * ```
 */
export function createMemoryStatePersistence(
  options: MemoryStatePersistenceOptions = {}
): StatePersistence & {
  /** Load raw serialized state including metadata (for version checking) */
  loadRaw(runId: string): Promise<SerializedState | undefined>;
} {
  const { ttl } = options;
  const store = new Map<string, { state: ResumeState; metadata?: Record<string, unknown>; timestamp: number }>();

  const isExpired = (timestamp: number): boolean => {
    if (!ttl) return false;
    return Date.now() - timestamp > ttl;
  };

  const evictExpired = (): void => {
    if (!ttl) return;
    for (const [key, entry] of store) {
      if (isExpired(entry.timestamp)) {
        store.delete(key);
      }
    }
  };

  return {
    async save(runId: string, state: ResumeState, metadata?: Record<string, unknown>): Promise<void> {
      evictExpired();
      store.set(runId, { state, metadata, timestamp: Date.now() });
    },

    async load(runId: string): Promise<ResumeState | undefined> {
      evictExpired();
      const entry = store.get(runId);
      if (!entry) return undefined;
      if (isExpired(entry.timestamp)) {
        store.delete(runId);
        return undefined;
      }
      return entry.state;
    },

    async loadRaw(runId: string): Promise<SerializedState | undefined> {
      evictExpired();
      const entry = store.get(runId);
      if (!entry) return undefined;
      if (isExpired(entry.timestamp)) {
        store.delete(runId);
        return undefined;
      }
      return serializeState(entry.state, entry.metadata);
    },

    async delete(runId: string): Promise<boolean> {
      return store.delete(runId);
    },

    async list(): Promise<string[]> {
      evictExpired();
      return [...store.keys()];
    },
  };
}

// =============================================================================
// File State Persistence
// =============================================================================

/**
 * Options for the file-based state persistence adapter.
 */
export interface FileStatePersistenceOptions {
  /**
   * Directory to store state files.
   */
  directory: string;

  /**
   * File extension for state files.
   * @default '.json'
   */
  extension?: string;

  /**
   * Custom file system interface (for testing or custom implementations).
   */
  fs: FileSystemInterface;
}

/**
 * Create a file system-based StatePersistence for local development.
 * Each workflow's state is stored as a separate JSON file.
 *
 * @param options - Persistence options
 * @returns StatePersistence implementation with init() method
 *
 * @example
 * ```typescript
 * import * as fs from 'fs/promises';
 * import { createFileStatePersistence } from 'awaitly/persistence';
 *
 * const store = createFileStatePersistence({
 *   directory: './workflow-state',
 *   fs: {
 *     readFile: (path) => fs.readFile(path, 'utf-8'),
 *     writeFile: (path, data) => fs.writeFile(path, data, 'utf-8'),
 *     unlink: fs.unlink,
 *     exists: async (path) => fs.access(path).then(() => true).catch(() => false),
 *     readdir: fs.readdir,
 *     mkdir: fs.mkdir,
 *   },
 * });
 *
 * // Initialize directory before use
 * await store.init();
 *
 * // Use with durable.run()
 * const result = await durable.run(deps, workflow, {
 *   id: 'order-123',
 *   store,
 * });
 * ```
 */
export function createFileStatePersistence(
  options: FileStatePersistenceOptions
): StatePersistence & {
  /** Initialize the state directory. Call before using the persistence. */
  init(): Promise<void>;
  /** Load raw serialized state including metadata (for version checking) */
  loadRaw(runId: string): Promise<SerializedState | undefined>;
} {
  const { directory, extension = ".json", fs } = options;

  const runIdToPath = (runId: string): string => {
    // Sanitize runId for file system
    const safeId = runId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `${directory}/${safeId}${extension}`;
  };

  return {
    async init(): Promise<void> {
      await fs.mkdir(directory, { recursive: true });
    },

    async save(runId: string, state: ResumeState, metadata?: Record<string, unknown>): Promise<void> {
      const path = runIdToPath(runId);
      const serialized = serializeState(state, metadata);
      await fs.writeFile(path, JSON.stringify(serialized, null, 2));
    },

    async load(runId: string): Promise<ResumeState | undefined> {
      const path = runIdToPath(runId);
      try {
        if (!(await fs.exists(path))) return undefined;
        const data = await fs.readFile(path);
        const serialized = JSON.parse(data) as SerializedState;
        return deserializeState(serialized);
      } catch {
        return undefined;
      }
    },

    async loadRaw(runId: string): Promise<SerializedState | undefined> {
      const path = runIdToPath(runId);
      try {
        if (!(await fs.exists(path))) return undefined;
        const data = await fs.readFile(path);
        return JSON.parse(data) as SerializedState;
      } catch {
        return undefined;
      }
    },

    async delete(runId: string): Promise<boolean> {
      const path = runIdToPath(runId);
      try {
        await fs.unlink(path);
        return true;
      } catch {
        return false;
      }
    },

    async list(): Promise<string[]> {
      try {
        const files = await fs.readdir(directory);
        return files
          .filter((file) => file.endsWith(extension))
          .map((file) => file.slice(0, -extension.length));
      } catch {
        return [];
      }
    },
  };
}

// =============================================================================
// Cache Wrapper with Async Hydration
// =============================================================================

/**
 * Create a cache that hydrates from persistent storage on first access.
 *
 * @param memoryCache - In-memory cache for fast access
 * @param persistence - Persistent storage for durability
 * @returns Hydrating cache implementation
 */
export function createHydratingCache(
  memoryCache: StepCache,
  persistence: StatePersistence,
  runId: string
): StepCache & { hydrate(): Promise<void> } {
  let hydrated = false;

  return {
    async hydrate(): Promise<void> {
      if (hydrated) return;

      const state = await persistence.load(runId);
      if (state) {
        for (const [key, entry] of state.steps) {
          memoryCache.set(key, entry.result);
        }
      }
      hydrated = true;
    },

    get(key: string): Result<unknown, unknown, unknown> | undefined {
      return memoryCache.get(key);
    },

    set(key: string, result: Result<unknown, unknown, unknown>): void {
      memoryCache.set(key, result);
    },

    has(key: string): boolean {
      return memoryCache.has(key);
    },

    delete(key: string): boolean {
      return memoryCache.delete(key);
    },

    clear(): void {
      memoryCache.clear();
    },
  };
}
