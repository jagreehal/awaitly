/**
 * awaitly/cache
 *
 * Caching utilities for memoization and deduplication.
 * Inspired by Effect.js caching patterns.
 *
 * @example
 * ```typescript
 * import { cached, cachedWithTTL, cachedFunction, once } from 'awaitly/cache';
 *
 * // Compute once, reuse forever
 * const getConfig = cached(() => loadConfig());
 *
 * // Expire after duration
 * const getUser = cachedWithTTL(() => fetchUser(id), { ttl: '5m' });
 *
 * // Memoize by arguments
 * const fetchUserMemo = cachedFunction((id: string) => fetchUser(id));
 *
 * // Execute exactly once (for initialization)
 * const initDb = once(() => connectToDatabase());
 * ```
 */

import { Duration, parse as parseDuration } from "./duration";

// =============================================================================
// Types
// =============================================================================

/**
 * Duration input type - supports Duration objects or string shorthand.
 */
export type DurationInput = Duration | string;

/**
 * Cache entry with metadata.
 */
export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  expiresAt?: number;
}

/**
 * Cache options.
 */
export interface CacheOptions {
  /**
   * Time-to-live for cached values.
   * Accepts Duration or string shorthand like "5m", "1h", "30s".
   */
  ttl?: DurationInput;
}

/**
 * Cached function options.
 */
export interface CachedFunctionOptions<Args extends unknown[]> {
  /**
   * Custom key generator for arguments.
   * Default: JSON.stringify(args)
   */
  keyFn?: (...args: Args) => string;

  /**
   * Time-to-live for cached values.
   */
  ttl?: DurationInput;

  /**
   * Maximum cache size. When exceeded, oldest entries are evicted.
   * @default Infinity
   */
  maxSize?: number;
}

/**
 * Cache statistics.
 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert DurationInput to milliseconds.
 */
function toMs(duration: DurationInput): number {
  if (typeof duration === "string") {
    const parsed = parseDuration(duration);
    if (!parsed) {
      throw new Error(`Invalid duration string: ${duration}`);
    }
    return parsed.millis;
  }
  return duration.millis;
}

// =============================================================================
// cached() - Compute once, reuse forever
// =============================================================================

/**
 * State for a cached value.
 */
type CachedState<T> =
  | { status: "empty" }
  | { status: "pending"; promise: Promise<T> }
  | { status: "filled"; value: T };

/**
 * Create a cached computation that executes once and reuses the result.
 *
 * The function is called at most once, even with concurrent calls.
 * Subsequent calls return the cached value immediately.
 *
 * @param fn - Function to compute the cached value
 * @returns Function that returns the cached value
 *
 * @example
 * ```typescript
 * const getConfig = cached(async () => {
 *   console.log('Loading config...');
 *   return await loadConfigFromFile();
 * });
 *
 * // First call executes the function
 * const config1 = await getConfig(); // "Loading config..."
 *
 * // Subsequent calls return cached value
 * const config2 = await getConfig(); // No log, instant return
 * const config3 = await getConfig(); // No log, instant return
 * ```
 */
export function cached<T>(fn: () => T | Promise<T>): () => Promise<T> {
  let state: CachedState<T> = { status: "empty" };

  return async () => {
    if (state.status === "filled") {
      return state.value;
    }

    if (state.status === "pending") {
      return state.promise;
    }

    // Compute the value
    const promise = Promise.resolve(fn()).then((value) => {
      state = { status: "filled", value };
      return value;
    });

    state = { status: "pending", promise };
    return promise;
  };
}

// =============================================================================
// cachedWithTTL() - Expire after duration
// =============================================================================

/**
 * State for a TTL-cached value.
 */
type CachedTTLState<T> =
  | { status: "empty" }
  | { status: "pending"; promise: Promise<T> }
  | { status: "filled"; value: T; expiresAt: number };

/**
 * Create a cached computation that expires after a duration.
 *
 * The function is re-executed when the TTL expires.
 * Concurrent calls while computing share the same promise.
 *
 * @param fn - Function to compute the cached value
 * @param options - Cache options including TTL
 * @returns Function that returns the cached value
 *
 * @example
 * ```typescript
 * const getUser = cachedWithTTL(
 *   async () => await fetchUser(userId),
 *   { ttl: '5m' }  // Cache for 5 minutes
 * );
 *
 * const user1 = await getUser(); // Fetches from API
 * const user2 = await getUser(); // Returns cached (within 5 min)
 *
 * // After 5 minutes...
 * const user3 = await getUser(); // Fetches again
 * ```
 */
export function cachedWithTTL<T>(
  fn: () => T | Promise<T>,
  options: { ttl: DurationInput }
): () => Promise<T> {
  const ttlMs = toMs(options.ttl);
  let state: CachedTTLState<T> = { status: "empty" };

  return async () => {
    const now = Date.now();

    // Check if cached value is still valid
    if (state.status === "filled" && now < state.expiresAt) {
      return state.value;
    }

    // Check if already computing
    if (state.status === "pending") {
      return state.promise;
    }

    // Compute the value
    const promise = Promise.resolve(fn()).then((value) => {
      state = {
        status: "filled",
        value,
        expiresAt: Date.now() + ttlMs,
      };
      return value;
    });

    state = { status: "pending", promise };
    return promise;
  };
}

// =============================================================================
// cachedFunction() - Memoize by arguments
// =============================================================================

/**
 * Cache entry for memoized functions.
 */
interface MemoEntry<T> {
  value: T;
  timestamp: number;
  expiresAt?: number;
}

/**
 * Memoized function interface.
 */
export interface MemoizedFunction<Args extends unknown[], T> {
  (...args: Args): Promise<T>;
  /** Clear the entire cache */
  clear(): void;
  /** Clear a specific cache entry */
  delete(...args: Args): boolean;
  /** Check if an entry exists */
  has(...args: Args): boolean;
  /** Get cache statistics */
  getStats(): CacheStats;
}

/**
 * Create a memoized function that caches results by arguments.
 *
 * Each unique set of arguments produces a cached result.
 * Supports TTL and max size limits.
 *
 * @param fn - Function to memoize
 * @param options - Memoization options
 * @returns Memoized function with cache control methods
 *
 * @example
 * ```typescript
 * const fetchUserMemo = cachedFunction(
 *   async (id: string) => await fetchUser(id),
 *   { ttl: '5m', maxSize: 100 }
 * );
 *
 * const user1 = await fetchUserMemo('user-1'); // Fetches
 * const user2 = await fetchUserMemo('user-2'); // Fetches
 * const user1Again = await fetchUserMemo('user-1'); // Cached!
 *
 * // Cache control
 * fetchUserMemo.delete('user-1'); // Remove specific entry
 * fetchUserMemo.clear(); // Clear all
 * console.log(fetchUserMemo.getStats()); // { hits: 1, misses: 2, size: 0 }
 * ```
 */
export function cachedFunction<Args extends unknown[], T>(
  fn: (...args: Args) => T | Promise<T>,
  options: CachedFunctionOptions<Args> = {}
): MemoizedFunction<Args, T> {
  const {
    keyFn = (...args: Args) => JSON.stringify(args),
    maxSize = Infinity,
  } = options;
  const ttlMs = options.ttl ? toMs(options.ttl) : undefined;

  const cache = new Map<string, MemoEntry<T>>();
  const pending = new Map<string, Promise<T>>();
  let hits = 0;
  let misses = 0;

  /**
   * Evict oldest entries if over max size.
   */
  function evictOldest(): void {
    if (cache.size <= maxSize) return;

    // Find oldest entry
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }

  const memoized = async (...args: Args): Promise<T> => {
    const key = keyFn(...args);
    const now = Date.now();

    // Check cache
    const cached = cache.get(key);
    if (cached) {
      // Check if expired
      if (cached.expiresAt && now >= cached.expiresAt) {
        cache.delete(key);
      } else {
        hits++;
        return cached.value;
      }
    }

    // Check if already computing
    const pendingPromise = pending.get(key);
    if (pendingPromise) {
      return pendingPromise;
    }

    // Compute the value
    misses++;
    const promise = Promise.resolve(fn(...args)).then((value) => {
      const entry: MemoEntry<T> = {
        value,
        timestamp: Date.now(),
        expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
      };
      cache.set(key, entry);
      pending.delete(key);
      evictOldest();
      return value;
    });

    pending.set(key, promise);

    try {
      return await promise;
    } catch (error) {
      pending.delete(key);
      throw error;
    }
  };

  memoized.clear = () => {
    cache.clear();
    pending.clear();
  };

  memoized.delete = (...args: Args) => {
    const key = keyFn(...args);
    return cache.delete(key);
  };

  memoized.has = (...args: Args) => {
    const key = keyFn(...args);
    const entry = cache.get(key);
    if (!entry) return false;
    if (entry.expiresAt && Date.now() >= entry.expiresAt) {
      cache.delete(key);
      return false;
    }
    return true;
  };

  memoized.getStats = () => ({
    hits,
    misses,
    size: cache.size,
  });

  return memoized;
}

// =============================================================================
// once() - Execute exactly once
// =============================================================================

/**
 * State for a once-executed function.
 */
type OnceState<T> =
  | { status: "idle" }
  | { status: "running"; promise: Promise<T> }
  | { status: "done"; value: T }
  | { status: "failed"; error: unknown };

/**
 * Once-executed function interface.
 */
export interface OnceFunction<T> {
  (): Promise<T>;
  /** Check if the function has been called */
  called: boolean;
  /** Check if execution completed successfully */
  completed: boolean;
  /** Check if execution failed */
  failed: boolean;
  /** Reset to allow re-execution */
  reset(): void;
}

/**
 * Create a function that executes exactly once.
 *
 * Useful for initialization code that should only run once.
 * Subsequent calls return the same result or re-throw the same error.
 *
 * @param fn - Function to execute once
 * @returns Function that executes once and returns the result
 *
 * @example
 * ```typescript
 * const initDb = once(async () => {
 *   console.log('Connecting to database...');
 *   const conn = await createConnection();
 *   return conn;
 * });
 *
 * // First call executes
 * const db1 = await initDb(); // "Connecting to database..."
 *
 * // Subsequent calls return cached result
 * const db2 = await initDb(); // Instant, same connection
 * const db3 = await initDb(); // Instant, same connection
 *
 * console.log(initDb.called); // true
 * console.log(initDb.completed); // true
 * ```
 */
export function once<T>(fn: () => T | Promise<T>): OnceFunction<T> {
  let state: OnceState<T> = { status: "idle" };

  const onceFn = async (): Promise<T> => {
    if (state.status === "done") {
      return state.value;
    }

    if (state.status === "failed") {
      throw state.error;
    }

    if (state.status === "running") {
      return state.promise;
    }

    // Execute the function
    const promise = Promise.resolve(fn())
      .then((value) => {
        state = { status: "done", value };
        return value;
      })
      .catch((error) => {
        state = { status: "failed", error };
        throw error;
      });

    state = { status: "running", promise };
    return promise;
  };

  Object.defineProperty(onceFn, "called", {
    get: () => state.status !== "idle",
  });

  Object.defineProperty(onceFn, "completed", {
    get: () => state.status === "done",
  });

  Object.defineProperty(onceFn, "failed", {
    get: () => state.status === "failed",
  });

  onceFn.reset = () => {
    state = { status: "idle" };
  };

  return onceFn as OnceFunction<T>;
}

// =============================================================================
// createCache() - General purpose cache
// =============================================================================

/**
 * General purpose cache interface.
 */
export interface Cache<K, V> {
  /** Get a value from the cache */
  get(key: K): V | undefined;
  /** Set a value in the cache */
  set(key: K, value: V, options?: { ttl?: DurationInput }): void;
  /** Check if a key exists */
  has(key: K): boolean;
  /** Delete a key from the cache */
  delete(key: K): boolean;
  /** Clear the entire cache */
  clear(): void;
  /** Get the cache size */
  size: number;
  /** Get cache statistics */
  getStats(): CacheStats;
}

/**
 * Cache configuration.
 */
export interface CacheConfig {
  /**
   * Default TTL for all entries.
   */
  defaultTTL?: DurationInput;

  /**
   * Maximum cache size.
   * @default Infinity
   */
  maxSize?: number;
}

/**
 * Create a general-purpose cache with TTL and size limits.
 *
 * @param config - Cache configuration
 * @returns A Cache instance
 *
 * @example
 * ```typescript
 * const cache = createCache<string, User>({
 *   defaultTTL: '5m',
 *   maxSize: 1000,
 * });
 *
 * cache.set('user:1', user);
 * cache.set('user:2', user2, { ttl: '1h' }); // Override TTL
 *
 * const user = cache.get('user:1');
 * ```
 */
export function createCache<K, V>(config: CacheConfig = {}): Cache<K, V> {
  const { maxSize = Infinity } = config;
  const defaultTTLMs = config.defaultTTL ? toMs(config.defaultTTL) : undefined;

  interface Entry {
    value: V;
    timestamp: number;
    expiresAt?: number;
  }

  const store = new Map<K, Entry>();
  let hits = 0;
  let misses = 0;

  /**
   * Check if an entry is expired.
   */
  function isExpired(entry: Entry): boolean {
    return entry.expiresAt !== undefined && Date.now() >= entry.expiresAt;
  }

  /**
   * Evict oldest entries if over max size.
   */
  function evictOldest(): void {
    if (store.size <= maxSize) return;

    let oldestKey: K | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of store.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      store.delete(oldestKey);
    }
  }

  return {
    get(key: K): V | undefined {
      const entry = store.get(key);
      if (!entry) {
        misses++;
        return undefined;
      }
      if (isExpired(entry)) {
        store.delete(key);
        misses++;
        return undefined;
      }
      hits++;
      return entry.value;
    },

    set(key: K, value: V, options?: { ttl?: DurationInput }): void {
      const ttlMs = options?.ttl ? toMs(options.ttl) : defaultTTLMs;
      const now = Date.now();

      store.set(key, {
        value,
        timestamp: now,
        expiresAt: ttlMs ? now + ttlMs : undefined,
      });

      evictOldest();
    },

    has(key: K): boolean {
      const entry = store.get(key);
      if (!entry) return false;
      if (isExpired(entry)) {
        store.delete(key);
        return false;
      }
      return true;
    },

    delete(key: K): boolean {
      return store.delete(key);
    },

    clear(): void {
      store.clear();
    },

    get size(): number {
      return store.size;
    },

    getStats(): CacheStats {
      return { hits, misses, size: store.size };
    },
  };
}
