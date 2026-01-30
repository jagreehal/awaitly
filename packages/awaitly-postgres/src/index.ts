/**
 * awaitly-postgres
 *
 * PostgreSQL persistence adapter for awaitly workflows.
 * Provides ready-to-use StatePersistence backed by PostgreSQL.
 */

import { Pool as PgPool } from "pg";
import { PostgresKeyValueStore, type PostgresKeyValueStoreOptions } from "./postgres-store";
import { createPostgresLock } from "./postgres-lock";
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
export interface PostgresLockOptions {
  /**
   * Table name for workflow locks.
   * @default 'awaitly_workflow_lock'
   */
  lockTableName?: string;
}

/**
 * Options for creating PostgreSQL persistence.
 */
export interface PostgresPersistenceOptions extends PostgresKeyValueStoreOptions {
  /**
   * Key prefix for state entries.
   * @default 'workflow:state:'
   */
  prefix?: string;

  /**
   * When set, the store implements WorkflowLock for cross-process concurrency control.
   * Uses a lease (TTL) + owner token; release verifies the token.
   */
  lock?: PostgresLockOptions;
}

/**
 * Create a StatePersistence instance backed by PostgreSQL.
 *
 * The table is automatically created on first use.
 *
 * @param options - PostgreSQL connection and configuration options
 * @returns StatePersistence instance ready to use with durable.run()
 *
 * @example
 * ```typescript
 * import { createPostgresPersistence } from 'awaitly-postgres';
 * import { durable } from 'awaitly/durable';
 *
 * const store = await createPostgresPersistence({
 *   connectionString: process.env.DATABASE_URL,
 * });
 *
 * const result = await durable.run(
 *   { fetchUser, createOrder },
 *   async (step, { fetchUser, createOrder }) => {
 *     const user = await step(() => fetchUser('123'), { key: 'fetch-user' });
 *     const order = await step(() => createOrder(user), { key: 'create-order' });
 *     return order;
 *   },
 *   {
 *     id: 'checkout-123',
 *     store,
 *   }
 * );
 * ```
 *
 * @example
 * ```typescript
 * // Using individual connection options
 * const store = await createPostgresPersistence({
 *   host: 'localhost',
 *   port: 5432,
 *   database: 'myapp',
 *   user: 'postgres',
 *   password: 'password',
 *   tableName: 'custom_workflow_state',
 * });
 * ```
 */
export type PostgresStatePersistence = StatePersistence & {
  loadRaw(runId: string): Promise<SerializedState | undefined>;
  listPage(options?: ListPageOptions): Promise<ListPageResult>;
  deleteMany(ids: string[]): Promise<number>;
  clear(): Promise<void>;
};

export type PostgresStatePersistenceWithLock = PostgresStatePersistence & WorkflowLock;

export async function createPostgresPersistence(
  options: PostgresPersistenceOptions = {}
): Promise<PostgresStatePersistence | PostgresStatePersistenceWithLock> {
  const { prefix, lock: lockOptions, ...storeOptions } = options;

  const stripPrefix = (key: string): string =>
    key.slice((prefix ?? "workflow:state:").length);

  const effectivePrefix = prefix ?? "workflow:state:";
  const prefixKey = (runId: string): string => `${effectivePrefix}${runId}`;

  const addListPageAndDeleteMany = (
    statePersistence: StatePersistence & { loadRaw(runId: string): Promise<SerializedState | undefined> },
    store: PostgresKeyValueStore
  ): PostgresStatePersistence => {
    return Object.assign(statePersistence, {
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
  };

  if (lockOptions !== undefined) {
    const pool =
      storeOptions.existingPool ??
      new PgPool(
        storeOptions.connectionString
          ? { connectionString: storeOptions.connectionString, ...storeOptions.pool }
          : {
              host: storeOptions.host ?? "localhost",
              port: storeOptions.port ?? 5432,
              database: storeOptions.database,
              user: storeOptions.user,
              password: storeOptions.password,
              ...storeOptions.pool,
            }
      );
    const store = new PostgresKeyValueStore({ ...storeOptions, existingPool: pool });
    const statePersistence = createStatePersistence(store, prefix) as PostgresStatePersistence;
    const lock = createPostgresLock(pool, {
      lockTableName: lockOptions.lockTableName,
    });
    return Object.assign(addListPageAndDeleteMany(statePersistence, store), {
      tryAcquire: lock.tryAcquire.bind(lock),
      release: lock.release.bind(lock),
    });
  }

  const store = new PostgresKeyValueStore(storeOptions);
  const base = createStatePersistence(store, prefix);
  return addListPageAndDeleteMany(base as StatePersistence & { loadRaw(runId: string): Promise<SerializedState | undefined> }, store);
}

/**
 * PostgreSQL KeyValueStore implementation.
 * Use this directly if you need more control over the store.
 *
 * @example
 * ```typescript
 * import { PostgresKeyValueStore } from 'awaitly-postgres';
 * import { createStatePersistence } from 'awaitly/persistence';
 *
 * const store = new PostgresKeyValueStore({
 *   connectionString: process.env.DATABASE_URL,
 * });
 *
 * const persistence = createStatePersistence(store, 'custom:prefix:');
 * ```
 */
export { PostgresKeyValueStore, type PostgresKeyValueStoreOptions };
