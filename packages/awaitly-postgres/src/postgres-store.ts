/**
 * awaitly-postgres
 *
 * PostgreSQL KeyValueStore implementation for awaitly persistence.
 */

import type { Pool, PoolConfig, QueryResult } from "pg";
import { Pool as PgPool } from "pg";
import type { KeyValueStore } from "awaitly/persistence";

/**
 * Options for PostgreSQL KeyValueStore.
 */
export interface PostgresKeyValueStoreOptions {
  /**
   * PostgreSQL connection string.
   * If provided, other connection options are ignored.
   *
   * @example 'postgresql://user:password@localhost:5432/dbname'
   */
  connectionString?: string;

  /**
   * Database host.
   * @default 'localhost'
   */
  host?: string;

  /**
   * Database port.
   * @default 5432
   */
  port?: number;

  /**
   * Database name.
   */
  database?: string;

  /**
   * Database user.
   */
  user?: string;

  /**
   * Database password.
   */
  password?: string;

  /**
   * Table name for storing key-value pairs.
   * @default 'awaitly_workflow_state'
   */
  tableName?: string;

  /**
   * Additional pool configuration options.
   * Ignored if `existingPool` is provided.
   */
  pool?: PoolConfig;

  /**
   * Existing PostgreSQL pool to use.
   * If provided, connection options are ignored.
   */
  existingPool?: Pool;
}

/**
 * PostgreSQL implementation of KeyValueStore.
 *
 * Automatically creates the required table on first use.
 * Supports TTL via expires_at column.
 */
export class PostgresKeyValueStore implements KeyValueStore {
  private pool: Pool;
  private tableName: string;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor(options: PostgresKeyValueStoreOptions) {
    if (options.existingPool) {
      // Use provided pool
      this.pool = options.existingPool;
    } else if (options.connectionString) {
      // Create pool from connection string
      this.pool = new PgPool({
        connectionString: options.connectionString,
        ...options.pool,
      });
    } else {
      // Create pool from individual options
      this.pool = new PgPool({
        host: options.host ?? "localhost",
        port: options.port ?? 5432,
        database: options.database,
        user: options.user,
        password: options.password,
        ...options.pool,
      });
    }

    this.tableName = options.tableName ?? "awaitly_workflow_state";
  }

  /**
   * Initialize the store by creating the table if it doesn't exist.
   * This is called automatically on first use.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        await this.createTable();
        this.initialized = true;
      } catch (error) {
        this.initPromise = null;
        throw error;
      }
    })();

    return this.initPromise;
  }

  /**
   * Create the table if it doesn't exist.
   */
  private async createTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expires_at 
      ON ${this.tableName}(expires_at) 
      WHERE expires_at IS NOT NULL;
    `;

    await this.pool.query(query);
  }

  /**
   * Convert glob pattern to SQL LIKE pattern.
   * Supports * wildcard (matches any characters).
   */
  private patternToLike(pattern: string): string {
    // Escape SQL LIKE special characters and convert * to %
    return pattern.replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/\*/g, "%");
  }

  async get(key: string): Promise<string | null> {
    await this.ensureInitialized();

    const query = `
      SELECT value 
      FROM ${this.tableName} 
      WHERE key = $1 
        AND (expires_at IS NULL OR expires_at > NOW())
    `;

    const result: QueryResult<{ value: string }> = await this.pool.query(query, [key]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].value;
  }

  async set(key: string, value: string, options?: { ttl?: number }): Promise<void> {
    await this.ensureInitialized();

    const expiresAt = options?.ttl
      ? new Date(Date.now() + options.ttl * 1000)
      : null;

    const query = `
      INSERT INTO ${this.tableName} (key, value, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) 
      DO UPDATE SET 
        value = EXCLUDED.value,
        expires_at = EXCLUDED.expires_at
    `;

    await this.pool.query(query, [key, value, expiresAt]);
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();

    const query = `DELETE FROM ${this.tableName} WHERE key = $1`;
    const result = await this.pool.query(query, [key]);

    return (result.rowCount ?? 0) > 0;
  }

  async exists(key: string): Promise<boolean> {
    await this.ensureInitialized();

    const query = `
      SELECT 1 
      FROM ${this.tableName} 
      WHERE key = $1 
        AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1
    `;

    const result = await this.pool.query(query, [key]);
    return result.rows.length > 0;
  }

  async keys(pattern: string): Promise<string[]> {
    await this.ensureInitialized();

    // Convert glob pattern to SQL LIKE
    const likePattern = this.patternToLike(pattern);

    const query = `
      SELECT key 
      FROM ${this.tableName} 
      WHERE key LIKE $1 
        AND (expires_at IS NULL OR expires_at > NOW())
    `;

    const result: QueryResult<{ key: string }> = await this.pool.query(query, [likePattern]);

    return result.rows.map((row) => row.key);
  }

  /**
   * Close the database connection pool.
   * Call this when done with the store.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
