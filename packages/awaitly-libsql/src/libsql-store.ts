/**
 * awaitly-libsql
 *
 * libSQL / SQLite KeyValueStore implementation for awaitly persistence.
 */

import { createClient, type Client } from "@libsql/client";
import type { KeyValueStore } from "awaitly/persistence";

/**
 * Options for libSQL / SQLite KeyValueStore.
 */
export interface LibSqlKeyValueStoreOptions {
  /**
   * libSQL database URL.
   *
   * Examples:
   * - "file:./awaitly.db" (local file)
   * - ":memory:" (in-memory, for tests)
   * - "libsql://your-db.turso.io" (remote)
   *
   * @default "file:./awaitly.db"
   */
  url?: string;

  /**
   * Authentication token for remote libSQL databases (e.g. Turso).
   */
  authToken?: string;

  /**
   * Table name for storing key-value pairs.
   * @default "awaitly_workflow_state"
   */
  tableName?: string;

  /**
   * Existing libSQL client to use.
   * If provided, url/authToken options are ignored.
   */
  client?: Client;
}

/**
 * libSQL / SQLite implementation of KeyValueStore.
 *
 * Automatically creates the required table on first use.
 * Supports TTL via ISO 8601 `expires_at` column.
 */
export class LibSqlKeyValueStore implements KeyValueStore {
  private client: Client;
  private tableName: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(options: LibSqlKeyValueStoreOptions = {}) {
    if (options.client) {
      this.client = options.client;
    } else {
      const url = options.url ?? "file:./awaitly.db";
      this.client = createClient({
        url,
        authToken: options.authToken,
      });
    }

    const tableName = options.tableName ?? "awaitly_workflow_state";
    if (!/^[A-Za-z0-9_]+$/.test(tableName)) {
      throw new Error(
        `Invalid table name '${tableName}'. Only alphanumeric and underscore characters are allowed.`
      );
    }
    this.tableName = tableName;
  }

  /**
   * Initialize the store by creating the table and index if they don't exist.
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
      } finally {
        if (!this.initialized) {
          this.initPromise = null;
        }
      }
    })();

    return this.initPromise;
  }

  /**
   * Create the table and index if they don't exist.
   */
  private async createTable(): Promise<void> {
    // SQLite / libSQL: execute schema changes as separate statements
    await this.client.execute({
      sql: `
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          expires_at TEXT
        );
      `,
      args: [],
    });

    await this.client.execute({
      sql: `
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expires_at
        ON ${this.tableName}(expires_at);
      `,
      args: [],
    });
  }

  /**
   * Convert glob pattern to SQL LIKE pattern.
   * Supports * wildcard (matches any characters).
   */
  private patternToLike(pattern: string): string {
    // Escape LIKE special characters and convert * to %
    return pattern.replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/\*/g, "%");
  }

  async get(key: string): Promise<string | null> {
    await this.ensureInitialized();

    const nowIso = new Date().toISOString();
    const result = await this.client.execute({
      sql: `
        SELECT value, expires_at
        FROM ${this.tableName}
        WHERE key = ?
      `,
      args: [key],
    });

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as Record<string, unknown>;
    const expiresAt = row["expires_at"] as string | null | undefined;

    if (expiresAt && expiresAt <= nowIso) {
      // Expired - behave as if key doesn't exist
      return null;
    }

    return (row["value"] as string) ?? null;
  }

  async set(key: string, value: string, options?: { ttl?: number }): Promise<void> {
    await this.ensureInitialized();

    const expiresAt =
      options?.ttl && options.ttl > 0
        ? new Date(Date.now() + options.ttl * 1000).toISOString()
        : null;

    await this.client.execute({
      sql: `
        INSERT INTO ${this.tableName} (key, value, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          expires_at = excluded.expires_at
      `,
      args: [key, value, expiresAt],
    });
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();

    const result = await this.client.execute({
      sql: `DELETE FROM ${this.tableName} WHERE key = ?`,
      args: [key],
    });

    // libSQL .rowsAffected is available on hrana responses; fall back to > 0 check
    const affected: number | undefined = result.rowsAffected;
    if (typeof affected === "number") {
      return affected > 0;
    }

    // If rowsAffected is not available, perform an existence check as a fallback
    const after = await this.get(key);
    return after === null;
  }

  async exists(key: string): Promise<boolean> {
    await this.ensureInitialized();

    const nowIso = new Date().toISOString();
    const result = await this.client.execute({
      sql: `
        SELECT 1
        FROM ${this.tableName}
        WHERE key = ?
          AND (expires_at IS NULL OR expires_at > ?)
        LIMIT 1
      `,
      args: [key, nowIso],
    });

    return result.rows.length > 0;
  }

  async keys(pattern: string): Promise<string[]> {
    await this.ensureInitialized();

    const likePattern = this.patternToLike(pattern);
    const nowIso = new Date().toISOString();

    const result = await this.client.execute({
      sql: `
        SELECT key
        FROM ${this.tableName}
        WHERE key LIKE ? ESCAPE '\\'
          AND (expires_at IS NULL OR expires_at > ?)
      `,
      args: [likePattern, nowIso],
    });

    return result.rows.map((row) => (row as Record<string, unknown>)["key"] as string);
  }

  /**
   * Close the underlying client if it supports close().
   */
  async close(): Promise<void> {
    // libSQL client doesn't expose a close API in all runtimes; no-op for now.
    // If a future version adds client.close(), it can be wired here.
  }
}

