/**
 * awaitly-postgres
 *
 * PostgreSQL persistence adapter for awaitly workflows.
 * Provides ready-to-use StatePersistence backed by PostgreSQL.
 */

import { PostgresKeyValueStore, type PostgresKeyValueStoreOptions } from "./postgres-store";
import { createStatePersistence, type StatePersistence } from "awaitly/persistence";

/**
 * Options for creating PostgreSQL persistence.
 */
export interface PostgresPersistenceOptions extends PostgresKeyValueStoreOptions {
  /**
   * Key prefix for state entries.
   * @default 'workflow:state:'
   */
  prefix?: string;
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
export async function createPostgresPersistence(
  options: PostgresPersistenceOptions = {}
): Promise<StatePersistence & { loadRaw(runId: string): Promise<import("awaitly/persistence").SerializedState | undefined> }> {
  const { prefix, ...storeOptions } = options;

  const store = new PostgresKeyValueStore(storeOptions);
  return createStatePersistence(store, prefix);
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
