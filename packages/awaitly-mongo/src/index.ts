/**
 * awaitly-mongo
 *
 * MongoDB persistence adapter for awaitly workflows.
 * Provides ready-to-use StatePersistence backed by MongoDB.
 */

import { MongoKeyValueStore, type MongoKeyValueStoreOptions } from "./mongo-store";
import { createStatePersistence, type StatePersistence } from "awaitly/persistence";

/**
 * Options for creating MongoDB persistence.
 */
export interface MongoPersistenceOptions extends MongoKeyValueStoreOptions {
  /**
   * Key prefix for state entries.
   * @default 'workflow:state:'
   */
  prefix?: string;
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
export async function createMongoPersistence(
  options: MongoPersistenceOptions = {}
): Promise<StatePersistence & { loadRaw(runId: string): Promise<import("awaitly/persistence").SerializedState | undefined> }> {
  const { prefix, ...storeOptions } = options;

  const store = new MongoKeyValueStore(storeOptions);
  return createStatePersistence(store, prefix);
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
