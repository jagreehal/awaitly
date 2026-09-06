import type { Pool } from "pg";

/** Serialize first-use DDL across workers, then cache successful initialization. */
export function createSchemaInitializer(pool: Pool, name: string, sql: string): () => Promise<void> {
  let initialized: Promise<void> | undefined;

  const initialize = async (): Promise<void> => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // IF NOT EXISTS alone can still race in PostgreSQL's system catalogs.
      // A transaction-scoped lock is released even if the worker disconnects.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`awaitly-schema:${name}`]);
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };

  return () => {
    initialized ??= initialize().catch((error: unknown) => {
      initialized = undefined; // An outage must not permanently poison this store.
      throw error;
    });
    return initialized;
  };
}
