/**
 * awaitly-libsql
 *
 * libSQL / SQLite persistence adapter for awaitly workflows.
 * Provides ready-to-use StatePersistence backed by libSQL.
 */

import { createClient } from "@libsql/client";
import { LibSqlKeyValueStore, type LibSqlKeyValueStoreOptions } from "./libsql-store";
import { createLibSqlLock, type LibSqlLockOptions } from "./libsql-lock";
import {
  createStatePersistence,
  type StatePersistence,
  type SerializedState,
  type ListPageOptions,
  type ListPageResult,
} from "awaitly/persistence";
import type { WorkflowLock } from "awaitly/durable";

/**
 * Options for cross-process locking (lease + owner token).
 * When set, the returned store implements WorkflowLock so only one process
 * runs a given workflow ID at a time (when durable.run allowConcurrent is false).
 */
export type { LibSqlLockOptions } from "./libsql-lock";

/**
 * Options for creating libSQL persistence.
 */
export interface LibSqlPersistenceOptions extends LibSqlKeyValueStoreOptions {
  /**
   * Key prefix for state entries.
   * @default "workflow:state:"
   */
  prefix?: string;

  /**
   * When set, the store implements WorkflowLock for cross-process concurrency control.
   * Uses a lease (TTL) + owner token; release verifies the token.
   */
  lock?: LibSqlLockOptions;
}

/**
 * Create a StatePersistence instance backed by libSQL / SQLite.
 *
 * The table is automatically created on first use.
 *
 * @param options - libSQL connection and configuration options
 * @returns StatePersistence instance ready to use with durable.run()
 *
 * @example
 * ```typescript
 * import { createLibSqlPersistence } from "awaitly-libsql";
 * import { durable } from "awaitly/durable";
 *
 * const store = await createLibSqlPersistence({
 *   url: "file:./awaitly.db",
 * });
 *
 * const result = await durable.run(
 *   { fetchUser, createOrder },
 *   async (step, { fetchUser, createOrder }) => {
 *     const user = await step(() => fetchUser("123"), { key: "fetch-user" });
 *     const order = await step(() => createOrder(user), { key: "create-order" });
 *     return order;
 *   },
 *   {
 *     id: "checkout-123",
 *     store,
 *   }
 * );
 * ```
 *
 * @example
 * ```typescript
 * // Using remote Turso (libSQL) instance
 * const store = await createLibSqlPersistence({
 *   url: process.env.LIBSQL_URL!,
 *   authToken: process.env.LIBSQL_AUTH_TOKEN,
 *   tableName: "awaitly_workflow_state",
 * });
 * ```
 */
export type LibSqlStatePersistence = StatePersistence & {
  loadRaw(runId: string): Promise<SerializedState | undefined>;
  listPage(options?: ListPageOptions): Promise<ListPageResult>;
  deleteMany(ids: string[]): Promise<number>;
  clear(): Promise<void>;
};

export type LibSqlStatePersistenceWithLock = LibSqlStatePersistence & WorkflowLock;

export async function createLibSqlPersistence(
  options: LibSqlPersistenceOptions = {}
): Promise<LibSqlStatePersistence | LibSqlStatePersistenceWithLock> {
  const { prefix, lock: lockOptions, ...storeOptions } = options;

  const effectivePrefix = prefix ?? "workflow:state:";
  const stripPrefix = (key: string): string => key.slice(effectivePrefix.length);
  const prefixKey = (runId: string): string => `${effectivePrefix}${runId}`;

  const addExtensions = (
    base: StatePersistence & { loadRaw(runId: string): Promise<SerializedState | undefined> },
    store: LibSqlKeyValueStore
  ): LibSqlStatePersistence =>
    Object.assign(base, {
      async listPage(options: ListPageOptions = {}): Promise<ListPageResult> {
        const { keys, total } = await store.listKeys(`${effectivePrefix}*`, options);
        const ids = keys.map(stripPrefix);
        const limit = Math.min(Math.max(0, options.limit ?? 100), 10_000);
        const nextOffset =
          ids.length === limit ? (options.offset ?? 0) + ids.length : undefined;
        return { ids, total, nextOffset };
      },
      async deleteMany(ids: string[]): Promise<number> {
        if (ids.length === 0) return 0;
        const keys = ids.map(prefixKey);
        return store.deleteMany(keys);
      },
      async clear(): Promise<void> {
        return store.clear();
      },
    });

  if (lockOptions !== undefined) {
    const client =
      storeOptions.client ??
      createClient({
        url: storeOptions.url ?? "file:./awaitly.db",
        authToken: storeOptions.authToken,
      });
    const store = new LibSqlKeyValueStore({ ...storeOptions, client });
    const base = createStatePersistence(store, prefix) as LibSqlStatePersistence;
    const persistence = addExtensions(
      base as StatePersistence & { loadRaw(runId: string): Promise<SerializedState | undefined> },
      store
    );
    const lock = createLibSqlLock(client, lockOptions);
    return Object.assign(persistence, {
      tryAcquire: lock.tryAcquire.bind(lock),
      release: lock.release.bind(lock),
    });
  }

  const store = new LibSqlKeyValueStore(storeOptions);
  const base = createStatePersistence(store, prefix);
  return addExtensions(
    base as StatePersistence & { loadRaw(runId: string): Promise<SerializedState | undefined> },
    store
  );
}

/**
 * libSQL KeyValueStore implementation.
 * Use this directly if you need more control over the store.
 *
 * @example
 * ```typescript
 * import { LibSqlKeyValueStore } from "awaitly-libsql";
 * import { createStatePersistence } from "awaitly/persistence";
 *
 * const store = new LibSqlKeyValueStore({
 *   url: "file:./awaitly.db",
 * });
 *
 * const persistence = createStatePersistence(store, "custom:prefix:");
 * ```
 */
export { LibSqlKeyValueStore, type LibSqlKeyValueStoreOptions };

