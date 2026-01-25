/**
 * awaitly/cache
 *
 * Caching utilities for memoization and deduplication.
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
 * // Execute exactly once
 * const initDb = once(() => connectToDatabase());
 * ```
 */

export {
  // Types
  type DurationInput,
  type CacheEntry,
  type CacheOptions,
  type CachedFunctionOptions,
  type CacheStats,
  type MemoizedFunction,
  type OnceFunction,
  type Cache,
  type CacheConfig,

  // Functions
  cached,
  cachedWithTTL,
  cachedFunction,
  once,
  createCache,
} from "./cache";
