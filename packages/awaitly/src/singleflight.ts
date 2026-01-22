/**
 * awaitly/singleflight
 *
 * Request coalescing - dedupe concurrent identical requests.
 * Multiple concurrent calls with the same key share one in-flight request.
 *
 * @example
 * ```typescript
 * import { singleflight } from 'awaitly/singleflight';
 *
 * const fetchUserOnce = singleflight(
 *   (id: string) => fetchUser(id),
 *   { key: (id) => `user:${id}` }
 * );
 *
 * // All concurrent calls share one request
 * const [user1, user2] = await Promise.all([
 *   fetchUserOnce('1'),
 *   fetchUserOnce('1'),  // Same key - shares request
 * ]);
 * ```
 */

import { type Result, type AsyncResult } from "./core";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the singleflight wrapper.
 */
export type SingleflightOptions<Args extends unknown[]> = {
  /**
   * Extract cache key from arguments.
   * Calls with the same key will share one in-flight request.
   */
  key: (...args: Args) => string;

  /**
   * Optional TTL in milliseconds to cache successful results.
   * After TTL expires, next call will trigger a fresh request.
   * @default 0 (no caching after completion - only dedupes in-flight requests)
   */
  ttl?: number;
};

/**
 * Internal cache entry for TTL-based caching.
 */
interface CacheEntry<T, E, C> {
  result: Result<T, E, C>;
  expiresAt: number;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a singleflight-wrapped function.
 * Concurrent calls with the same key share one in-flight request.
 *
 * ## How It Works
 *
 * 1. First caller with a key starts the operation
 * 2. Subsequent callers with the same key get the same Promise
 * 3. When operation completes, all callers receive the same Result
 * 4. Key is removed from in-flight tracking (unless TTL is set)
 *
 * ## Use Cases
 *
 * - **Prevent thundering herd**: Multiple requests for the same user
 * - **API deduplication**: Avoid duplicate network calls
 * - **Expensive operations**: Share computation across callers
 *
 * @param operation - The async operation that returns an AsyncResult
 * @param options - Configuration with key extraction function
 * @returns A wrapped function that deduplicates concurrent calls
 *
 * @example
 * ```typescript
 * import { singleflight } from 'awaitly/singleflight';
 * import { ok, err, type AsyncResult } from 'awaitly';
 *
 * const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
 *   id !== '0' ? ok({ id, name: `User ${id}` }) : err('NOT_FOUND');
 *
 * const fetchUserOnce = singleflight(fetchUser, {
 *   key: (id) => `user:${id}`,
 * });
 *
 * // Concurrent calls share one request
 * const [a, b, c] = await Promise.all([
 *   fetchUserOnce('1'),  // Triggers fetch
 *   fetchUserOnce('1'),  // Joins existing fetch
 *   fetchUserOnce('2'),  // Different key - new fetch
 * ]);
 * ```
 *
 * @example
 * ```typescript
 * // With TTL for result caching
 * const fetchUserCached = singleflight(fetchUser, {
 *   key: (id) => `user:${id}`,
 *   ttl: 5000,  // Cache successful results for 5 seconds
 * });
 *
 * const user1 = await fetchUserCached('1');  // Fetches
 * const user2 = await fetchUserCached('1');  // Returns cached (within TTL)
 * // After 5 seconds...
 * const user3 = await fetchUserCached('1');  // Fetches again
 * ```
 */
export function singleflight<Args extends unknown[], T, E, C = unknown>(
  operation: (...args: Args) => AsyncResult<T, E, C>,
  options: SingleflightOptions<Args>
): (...args: Args) => AsyncResult<T, E, C> {
  // In-flight requests by key
  const inflight = new Map<string, Promise<Result<T, E, C>>>();

  // Cached results by key (only if TTL is set)
  const cache = options.ttl ? new Map<string, CacheEntry<T, E, C>>() : null;

  return async (...args: Args): AsyncResult<T, E, C> => {
    const key = options.key(...args);

    // Check TTL cache first (if enabled)
    if (cache) {
      const cached = cache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
      }
      // Expired - remove from cache
      if (cached) {
        cache.delete(key);
      }
    }

    // Check for existing in-flight request
    const existing = inflight.get(key);
    if (existing) {
      return existing;
    }

    // Start new request
    // Use .finally() to ensure cleanup happens even if operation throws
    const promise = operation(...args)
      .then((result) => {
        // Cache successful results if TTL is set
        if (cache && options.ttl && result.ok) {
          cache.set(key, {
            result,
            expiresAt: Date.now() + options.ttl,
          });
        }
        return result;
      })
      .finally(() => {
        // Always remove from in-flight tracking, success or failure
        inflight.delete(key);
      });

    inflight.set(key, promise);
    return promise;
  };
}

/**
 * Create a singleflight group with manual key management.
 * More flexible but lower-level API than the `singleflight` wrapper.
 *
 * @returns A group object with execute, isInflight, and clear methods
 *
 * @example
 * ```typescript
 * import { createSingleflightGroup } from 'awaitly/singleflight';
 *
 * const group = createSingleflightGroup<User, 'NOT_FOUND'>();
 *
 * // Execute with manual key
 * const user1 = await group.execute('user:1', () => fetchUser('1'));
 * const user2 = await group.execute('user:1', () => fetchUser('1')); // Shares request
 *
 * // Check if request is in-flight
 * if (group.isInflight('user:1')) {
 *   console.log('Request pending');
 * }
 *
 * // Clear all in-flight requests
 * group.clear();
 * ```
 */
export function createSingleflightGroup<T, E, C = unknown>(): {
  /**
   * Execute or join an in-flight request for the given key.
   */
  execute: (
    key: string,
    operation: () => AsyncResult<T, E, C>
  ) => AsyncResult<T, E, C>;

  /**
   * Check if a request is currently in-flight for the key.
   */
  isInflight: (key: string) => boolean;

  /**
   * Get the number of in-flight requests.
   */
  size: () => number;

  /**
   * Clear all in-flight tracking (does not cancel operations).
   */
  clear: () => void;
} {
  const inflight = new Map<string, Promise<Result<T, E, C>>>();

  return {
    execute: async (
      key: string,
      operation: () => AsyncResult<T, E, C>
    ): AsyncResult<T, E, C> => {
      // Return existing in-flight promise if present
      const existing = inflight.get(key);
      if (existing) {
        return existing;
      }

      // Start new request
      // Use .finally() to ensure cleanup happens even if operation throws
      const promise = operation()
        .then((result) => result)
        .finally(() => {
          inflight.delete(key);
        });

      inflight.set(key, promise);
      return promise;
    },

    isInflight: (key: string) => inflight.has(key),

    size: () => inflight.size,

    clear: () => inflight.clear(),
  };
}
