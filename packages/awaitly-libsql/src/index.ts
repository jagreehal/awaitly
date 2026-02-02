/**
 * awaitly-libsql
 *
 * libSQL / SQLite persistence adapter for awaitly workflows.
 * Provides ready-to-use SnapshotStore backed by libSQL.
 */

import { createClient, type Client } from "@libsql/client";
import type { WorkflowSnapshot, SnapshotStore } from "awaitly/persistence";
import type { WorkflowLock } from "awaitly/durable";
import { createLibSqlLock, type LibSqlLockOptions } from "./libsql-lock";

// Re-export types for convenience
export type { SnapshotStore, WorkflowSnapshot } from "awaitly/persistence";
export type { WorkflowLock } from "awaitly/durable";
export type { LibSqlLockOptions } from "./libsql-lock";

// =============================================================================
// LibSqlOptions
// =============================================================================

/**
 * Options for the libsql() shorthand function.
 */
export interface LibSqlOptions {
  /** libSQL connection URL (file: for local, https: for Turso). */
  url: string;
  /** Auth token for remote Turso instances. */
  authToken?: string;
  /** Table name for snapshots. @default 'awaitly_snapshots' */
  table?: string;
  /** Key prefix for IDs. @default '' */
  prefix?: string;
  /** Bring your own client. */
  client?: Client;
  /** Cross-process lock options. When set, the store implements WorkflowLock. */
  lock?: LibSqlLockOptions;
}

// =============================================================================
// libsql() - One-liner Snapshot Store Setup
// =============================================================================

/**
 * Create a snapshot store backed by libSQL / SQLite.
 * This is the simplified one-liner API for workflow persistence.
 *
 * @example
 * ```typescript
 * import { libsql } from 'awaitly-libsql';
 *
 * // One-liner setup (local SQLite)
 * const store = libsql('file:./workflow.db');
 *
 * // Execute + persist
 * const wf = createWorkflow(deps);
 * await wf(myWorkflowFn);
 * await store.save('wf-123', wf.getSnapshot());
 *
 * // Restore
 * const snapshot = await store.load('wf-123');
 * const wf2 = createWorkflow(deps, { snapshot });
 * await wf2(myWorkflowFn);
 * ```
 *
 * @example
 * ```typescript
 * // With remote Turso and cross-process locking
 * const store = libsql({
 *   url: process.env.TURSO_URL!,
 *   authToken: process.env.TURSO_AUTH_TOKEN,
 *   table: 'my_workflow_snapshots',
 *   prefix: 'orders:',
 *   lock: { lockTableName: 'my_workflow_locks' },
 * });
 * ```
 */
export function libsql(urlOrOptions: string | LibSqlOptions): SnapshotStore & Partial<WorkflowLock> {
  const opts = typeof urlOrOptions === "string" ? { url: urlOrOptions } : urlOrOptions;
  const tableName = opts.table ?? "awaitly_snapshots";
  const prefix = opts.prefix ?? "";

  // Validate table name for SQL injection prevention
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}. Must be alphanumeric with underscores.`);
  }

  // Create or use existing client
  const ownClient = !opts.client;
  const client = opts.client ?? createClient({
    url: opts.url,
    authToken: opts.authToken,
  });

  let tableCreated = false;

  // Create lock if requested
  const lock = opts.lock ? createLibSqlLock(client, opts.lock) : null;

  const ensureTable = async (): Promise<void> => {
    if (tableCreated) return;
    await client.execute(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id TEXT PRIMARY KEY,
        snapshot TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    await client.execute(`
      CREATE INDEX IF NOT EXISTS ${tableName}_updated_at_idx ON ${tableName} (updated_at DESC)
    `);
    tableCreated = true;
  };

  const store: SnapshotStore & Partial<WorkflowLock> = {
    async save(id: string, snapshot: WorkflowSnapshot): Promise<void> {
      await ensureTable();
      const fullId = prefix + id;
      await client.execute({
        sql: `INSERT INTO ${tableName} (id, snapshot, updated_at)
              VALUES (?, ?, datetime('now'))
              ON CONFLICT(id) DO UPDATE SET snapshot = ?, updated_at = datetime('now')`,
        args: [fullId, JSON.stringify(snapshot), JSON.stringify(snapshot)],
      });
    },

    async load(id: string): Promise<WorkflowSnapshot | null> {
      await ensureTable();
      const fullId = prefix + id;
      const result = await client.execute({
        sql: `SELECT snapshot FROM ${tableName} WHERE id = ?`,
        args: [fullId],
      });
      if (result.rows.length === 0) return null;
      return JSON.parse(result.rows[0].snapshot as string) as WorkflowSnapshot;
    },

    async delete(id: string): Promise<void> {
      await ensureTable();
      const fullId = prefix + id;
      await client.execute({
        sql: `DELETE FROM ${tableName} WHERE id = ?`,
        args: [fullId],
      });
    },

    async list(options?: { prefix?: string; limit?: number }): Promise<Array<{ id: string; updatedAt: string }>> {
      await ensureTable();
      const filterPrefix = prefix + (options?.prefix ?? "");
      const limit = options?.limit ?? 100;

      const result = await client.execute({
        sql: `SELECT id, updated_at FROM ${tableName}
              WHERE id LIKE ?
              ORDER BY updated_at DESC
              LIMIT ?`,
        args: [filterPrefix + "%", limit],
      });

      return result.rows.map(row => ({
        id: (row.id as string).slice(prefix.length),
        updatedAt: row.updated_at as string,
      }));
    },

    async close(): Promise<void> {
      // Only close client if we created it
      if (ownClient) {
        client.close();
      }
    },
  };

  // Add lock methods if lock is configured
  if (lock) {
    store.tryAcquire = lock.tryAcquire.bind(lock);
    store.release = lock.release.bind(lock);
  }

  return store;
}
