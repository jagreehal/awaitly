import { ok, err, type Result, type AsyncResult, UnexpectedError } from "./core";

/**
 * Configuration for createResolver.
 *
 * @typeParam T - The type of items returned by batchFn
 * @typeParam K - The type of keys used to identify items
 * @typeParam E - The error type from batchFn
 */
export interface ResolverConfig<T, K, E extends string> {
  /** Human-readable name for this resolver (used in error messages) */
  name: string;
  /** Batch function that receives unique keys and returns all matching items */
  batchFn: (keys: K[]) => AsyncResult<T[], E>;
  /** Extract a dedup key from an input. Defaults to identity. */
  key?: (input: K) => K;
  /** Match a result item to a requested key */
  find: (item: T, key: K) => boolean;
  /** Enable per-key caching of ok results. No TTL in v1. */
  cache?: boolean;
}

/** Error returned when batchFn succeeds but no item matches the requested key */
export type ResolverNotFoundError = "RESOLVER_NOT_FOUND";

/**
 * A resolver instance created by createResolver.
 *
 * Resolvers should be created per-request/workflow, not as module-level singletons,
 * to avoid accidental cross-request batching.
 */
export interface Resolver<T, K, E extends string> {
  /** Load a single item by key. Batches with other loads in the same microtask. */
  load: (input: K) => Promise<Result<T, E | ResolverNotFoundError | UnexpectedError>>;
  /** Load multiple items by key. Results array matches input order. */
  loadMany: (inputs: K[]) => Promise<Result<T, E | ResolverNotFoundError | UnexpectedError>[]>;
  /** Evict a single key from the cache */
  clear: (input: K) => void;
  /** Evict all cached entries */
  clearAll: () => void;
}

/**
 * Create a DataLoader-style resolver that batches and deduplicates loads
 * within a single microtask tick.
 *
 * @example
 * ```typescript
 * const getUserById = createResolver({
 *   name: "getUserById",
 *   batchFn: async (keys: number[]): AsyncResult<User[], "QUERY_ERROR"> => {
 *     const users = await db.query("SELECT * FROM users WHERE id IN (?)", keys);
 *     return ok(users);
 *   },
 *   find: (user, key) => user.id === key,
 *   cache: true,
 * });
 *
 * // These batch into a single batchFn call
 * const [user1, user2] = await Promise.all([
 *   getUserById.load(1),
 *   getUserById.load(2),
 * ]);
 * ```
 */
export function createResolver<T, K, E extends string>(
  config: ResolverConfig<T, K, E>
): Resolver<T, K, E> {
  const keyFn = config.key ?? ((input: K) => input);

  // In-flight promise dedup: same key in same batch → same promise
  const inFlight = new Map<K, Promise<Result<T, E | ResolverNotFoundError | UnexpectedError>>>();

  // Pending queue: keys waiting to be flushed
  const pendingKeys: K[] = [];
  const pendingResolvers: Array<{
    key: K;
    resolve: (result: Result<T, E | ResolverNotFoundError | UnexpectedError>) => void;
  }> = [];

  let scheduled = false;

  // Cache: only stores ok results
  const cache = new Map<K, T>();

  async function flush(): Promise<void> {
    scheduled = false;

    // Snapshot and clear pending
    const keys = [...pendingKeys];
    const resolvers = [...pendingResolvers];
    pendingKeys.length = 0;
    pendingResolvers.length = 0;

    // Get unique keys (preserving order)
    const seen = new Set<K>();
    const uniqueKeys: K[] = [];
    for (const key of keys) {
      if (!seen.has(key)) {
        seen.add(key);
        uniqueKeys.push(key);
      }
    }

    let batchResult: Result<T[], E>;
    try {
      batchResult = await config.batchFn(uniqueKeys);
    } catch (thrown) {
      // batchFn threw — resolve all as UnexpectedError
      const errorResult = err(new UnexpectedError({ cause: thrown }));
      for (const { key, resolve } of resolvers) {
        resolve(errorResult);
        inFlight.delete(key);
      }
      return;
    }

    if (!batchResult.ok) {
      // batchFn returned err → all pending keys resolve to that error
      const errorResult = err(batchResult.error);
      for (const { key, resolve } of resolvers) {
        resolve(errorResult);
        inFlight.delete(key);
      }
      return;
    }

    // batchFn returned ok(items) → distribute to each pending key
    const items = batchResult.value;
    for (const { key, resolve } of resolvers) {
      const found = items.find((item) => config.find(item, key));
      if (found !== undefined) {
        const result = ok(found);
        if (config.cache) {
          cache.set(key, found);
        }
        resolve(result);
      } else {
        resolve(err("RESOLVER_NOT_FOUND" as ResolverNotFoundError));
      }
      inFlight.delete(key);
    }
  }

  function load(input: K): Promise<Result<T, E | ResolverNotFoundError | UnexpectedError>> {
    const key = keyFn(input);

    // Check cache first
    if (config.cache && cache.has(key)) {
      return Promise.resolve(ok(cache.get(key)!));
    }

    // Check if already in-flight for this batch
    const existing = inFlight.get(key);
    if (existing) {
      return existing;
    }

    // Create new promise for this key
    const promise = new Promise<Result<T, E | ResolverNotFoundError | UnexpectedError>>((resolve) => {
      pendingKeys.push(key);
      pendingResolvers.push({ key, resolve });
    });

    inFlight.set(key, promise);

    // Schedule flush once per tick
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }

    return promise;
  }

  async function loadMany(inputs: K[]): Promise<Result<T, E | ResolverNotFoundError | UnexpectedError>[]> {
    const promises = inputs.map((input) => load(input));
    return Promise.all(promises);
  }

  function clear(input: K): void {
    const key = keyFn(input);
    cache.delete(key);
  }

  function clearAll(): void {
    cache.clear();
  }

  return { load, loadMany, clear, clearAll };
}
