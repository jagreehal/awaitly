/**
 * awaitly-mongo
 *
 * MongoDB persistence adapter for awaitly workflows.
 * Provides ready-to-use StatePersistence backed by MongoDB.
 */

import type { Db } from "mongodb";
import { MongoClient as MongoClientImpl } from "mongodb";
import { MongoKeyValueStore, type MongoKeyValueStoreOptions } from "./mongo-store";
import { createMongoLock } from "./mongo-lock";
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
export interface MongoLockOptions {
  /**
   * Collection name for workflow locks.
   * @default 'workflow_lock'
   */
  lockCollectionName?: string;
}

/**
 * Options for creating MongoDB persistence.
 */
export interface MongoPersistenceOptions extends MongoKeyValueStoreOptions {
  /**
   * Key prefix for state entries.
   * @default 'workflow:state:'
   */
  prefix?: string;

  /**
   * When set, the store implements WorkflowLock for cross-process concurrency control.
   * Uses a lease (TTL) + owner token; release verifies the token.
   */
  lock?: MongoLockOptions;
}

/**
 * Create a StatePersistence instance backed by MongoDB.
 *
 * The collection is automatically created on first use with a TTL index.
 *
 * @param options - MongoDB connection and configuration options
 * @returns StatePersistence instance ready to use with durable.run()
 *
 * @example
 * ```typescript
 * import { createMongoPersistence } from 'awaitly-mongo';
 * import { durable } from 'awaitly/durable';
 *
 * const store = await createMongoPersistence({
 *   connectionString: process.env.MONGODB_URI,
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
 * const store = await createMongoPersistence({
 *   connectionString: 'mongodb://localhost:27017',
 *   database: 'myapp',
 *   collection: 'custom_workflow_state',
 * });
 * ```
 */
export type MongoStatePersistence = StatePersistence & {
  loadRaw(runId: string): Promise<SerializedState | undefined>;
  listPage(options?: ListPageOptions): Promise<ListPageResult>;
  deleteMany(ids: string[]): Promise<number>;
  clear(): Promise<void>;
};

export type MongoStatePersistenceWithLock = MongoStatePersistence & WorkflowLock;

function addListPageAndDeleteMany(
  statePersistence: StatePersistence & {
    loadRaw(runId: string): Promise<SerializedState | undefined>;
  },
  store: MongoKeyValueStore,
  prefix: string | undefined
): MongoStatePersistence {
  const effectivePrefix = prefix ?? "workflow:state:";
  const stripPrefix = (key: string): string => key.slice(effectivePrefix.length);
  const prefixKey = (runId: string): string => `${effectivePrefix}${runId}`;
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
}

export async function createMongoPersistence(
  options: MongoPersistenceOptions = {}
): Promise<MongoStatePersistence | MongoStatePersistenceWithLock> {
  const { prefix, lock: lockOptions, ...storeOptions } = options;

  if (lockOptions !== undefined) {
    let db: Db;
    if (storeOptions.existingDb) {
      db = storeOptions.existingDb;
    } else if (storeOptions.existingClient) {
      db = storeOptions.existingClient.db(storeOptions.database ?? "awaitly");
    } else {
      const connectionString =
        storeOptions.connectionString ?? "mongodb://localhost:27017";
      const client = new MongoClientImpl(connectionString, {
        directConnection: true,
        ...storeOptions.clientOptions,
      });
      await client.connect();
      let databaseName = storeOptions.database;
      const urlMatch = connectionString.match(/mongodb:\/\/[^/]+\/([^?]+)/);
      if (urlMatch && urlMatch[1]) {
        databaseName = databaseName ?? urlMatch[1];
      }
      databaseName = databaseName ?? "awaitly";
      db = client.db(databaseName);
      storeOptions.existingClient = client;
      storeOptions.database = databaseName;
    }
    const store = new MongoKeyValueStore(storeOptions);
    const statePersistence = createStatePersistence(store, prefix) as MongoStatePersistence;
    const lock = createMongoLock(db, {
      lockCollectionName: lockOptions.lockCollectionName,
    });
    return Object.assign(addListPageAndDeleteMany(statePersistence, store, prefix), {
      tryAcquire: lock.tryAcquire.bind(lock),
      release: lock.release.bind(lock),
    });
  }

  const store = new MongoKeyValueStore(storeOptions);
  const base = createStatePersistence(store, prefix);
  return addListPageAndDeleteMany(
    base as StatePersistence & {
      loadRaw(runId: string): Promise<SerializedState | undefined>;
    },
    store,
    prefix
  );
}

/**
 * MongoDB KeyValueStore implementation.
 * Use this directly if you need more control over the store.
 *
 * @example
 * ```typescript
 * import { MongoKeyValueStore } from 'awaitly-mongo';
 * import { createStatePersistence } from 'awaitly/persistence';
 *
 * const store = new MongoKeyValueStore({
 *   connectionString: process.env.MONGODB_URI,
 * });
 *
 * const persistence = createStatePersistence(store, 'custom:prefix:');
 * ```
 */
export { MongoKeyValueStore, type MongoKeyValueStoreOptions };
