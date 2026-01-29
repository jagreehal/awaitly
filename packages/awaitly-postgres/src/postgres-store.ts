/**
 * awaitly-postgres
 *
 * PostgreSQL KeyValueStore implementation for awaitly persistence.
 */

import type { Pool, PoolConfig, QueryResult } from "pg";
import { Pool as PgPool } from "pg";
import type { KeyValueStore, ListPageOptions } from "awaitly/persistence";

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
   * Adds updated_at column to existing tables for listKeys ordering.
   */
  private async createTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at TIMESTAMP,
        updated_at TIMESTAMPTZ
      )
    `);

    // Add updated_at to existing tables that don't have it (before creating index)
    await this.pool.query(`
      ALTER TABLE ${this.tableName} 
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expires_at 
      ON ${this.tableName}(expires_at) 
      WHERE expires_at IS NOT NULL
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_updated_at 
      ON ${this.tableName}(updated_at) 
      WHERE updated_at IS NOT NULL
    `);
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
      INSERT INTO ${this.tableName} (key, value, expires_at, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (key) 
      DO UPDATE SET 
        value = EXCLUDED.value,
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW()
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
   * List keys with pagination, filtering, and ordering.
   */
  async listKeys(
    pattern: string,
    options: ListPageOptions = {}
  ): Promise<{ keys: string[]; total?: number }> {
    await this.ensureInitialized();

    const limit = Math.min(Math.max(0, options.limit ?? 100), 10_000);
    const offset = Math.max(0, options.offset ?? 0);
    const orderBy = options.orderBy === "key" ? "key" : "updated_at";
    const orderDir = options.orderDir === "asc" ? "ASC" : "DESC";
    const likePattern = this.patternToLike(pattern);

    const conditions: string[] = [
      "key LIKE $1",
      "(expires_at IS NULL OR expires_at > NOW())",
    ];
    const args: unknown[] = [likePattern];
    let paramIndex = 2;

    if (options.updatedBefore != null) {
      conditions.push(`updated_at < $${paramIndex}`);
      args.push(options.updatedBefore);
      paramIndex++;
    }
    if (options.updatedAfter != null) {
      conditions.push(`updated_at > $${paramIndex}`);
      args.push(options.updatedAfter);
      paramIndex++;
    }

    const whereClause = conditions.join(" AND ");
    const orderNulls = orderBy === "updated_at" ? " NULLS LAST" : "";

    const listQuery = `
      SELECT key 
      FROM ${this.tableName} 
      WHERE ${whereClause}
      ORDER BY ${orderBy} ${orderDir}${orderNulls}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    const listArgs = [...args, limit, offset];

    const result: QueryResult<{ key: string }> = await this.pool.query(listQuery, listArgs);
    const keys = result.rows.map((row) => row.key);

    let total: number | undefined;
    if (options.includeTotal === true || offset > 0) {
      const countResult: QueryResult<{ count: string }> = await this.pool.query(
        `SELECT COUNT(*) AS count FROM ${this.tableName} WHERE ${whereClause}`,
        args
      );
      total = parseInt(countResult.rows[0]?.count ?? "0", 10);
    }

    return { keys, total };
  }

  /**
   * Delete multiple keys in one round-trip.
   */
  async deleteMany(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    await this.ensureInitialized();
    const result = await this.pool.query(
      `DELETE FROM ${this.tableName} WHERE key = ANY($1::text[])`,
      [keys]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Remove all entries from the table (clear all workflow state).
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(`TRUNCATE TABLE ${this.tableName}`);
  }

  /**
   * Close the database connection pool.
   * Call this when done with the store.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
