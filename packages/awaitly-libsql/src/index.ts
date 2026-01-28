/**
 * awaitly-libsql
 *
 * libSQL / SQLite persistence adapter for awaitly workflows.
 * Provides ready-to-use StatePersistence backed by libSQL.
 */

import { LibSqlKeyValueStore, type LibSqlKeyValueStoreOptions } from "./libsql-store";
import { createStatePersistence, type StatePersistence } from "awaitly/persistence";

/**
 * Options for creating libSQL persistence.
 */
export interface LibSqlPersistenceOptions extends LibSqlKeyValueStoreOptions {
  /**
   * Key prefix for state entries.
   * @default "workflow:state:"
   */
  prefix?: string;
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
export async function createLibSqlPersistence(
  options: LibSqlPersistenceOptions = {}
): Promise<
  StatePersistence & {
    loadRaw(runId: string): Promise<import("awaitly/persistence").SerializedState | undefined>;
  }
> {
  const { prefix, ...storeOptions } = options;

  const store = new LibSqlKeyValueStore(storeOptions);
  return createStatePersistence(store, prefix);
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

