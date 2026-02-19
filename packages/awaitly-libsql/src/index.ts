/**
 * awaitly-libsql
 *
 * libSQL / SQLite persistence adapter for awaitly workflows.
 * Provides ready-to-use SnapshotStore backed by libSQL.
 * Supports both WorkflowSnapshot and ResumeState (serialized via serializeResumeState).
 */

import { createClient, type Client } from "@libsql/client";
import type { WorkflowSnapshot, SnapshotStore } from "awaitly/persistence";
import type { WorkflowLock } from "awaitly/durable";
import {
  type ResumeState,
  type StoreSaveInput,
  type StoreLoadResult,
  isWorkflowSnapshot,
  isResumeState,
  isSerializedResumeState,
  serializeResumeState,
  deserializeResumeState,
} from "awaitly/workflow";
import { createLibSqlLock, type LibSqlLockOptions } from "./libsql-lock";

// Re-export types for convenience
export type { SnapshotStore, WorkflowSnapshot } from "awaitly/persistence";
export type { WorkflowLock } from "awaitly/durable";
export type { LibSqlLockOptions } from "./libsql-lock";
export type { StoreSaveInput, StoreLoadResult } from "awaitly/workflow";

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

/** LibSQL store with widened save/load for WorkflowSnapshot and ResumeState. Compatible with SnapshotStore for snapshot-only usage. */
export interface LibSqlStore extends Partial<WorkflowLock> {
  save(id: string, state: StoreSaveInput): Promise<void>;
  load(id: string): Promise<StoreLoadResult>;
  loadResumeState(id: string): Promise<ResumeState | null>;
  delete(id: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<Array<{ id: string; updatedAt: string }>>;
  close(): Promise<void>;
}

// =============================================================================
// libsql() - One-liner Snapshot Store Setup
// =============================================================================

/**
 * Create a snapshot store backed by libSQL / SQLite.
 * Save accepts WorkflowSnapshot or ResumeState; load returns whichever was stored.
 * Use loadResumeState(id) for type-safe restore, or toResumeState(await store.load(id)).
 *
 * @example
 * ```typescript
 * import { libsql } from 'awaitly-libsql';
 * import { createWorkflow } from 'awaitly/workflow';
 *
 * const store = libsql('file:./workflow.db');
 * const workflow = createWorkflow(deps);
 *
 * // Run and persist resume state
 * const { result, resumeState } = await workflow.runWithState(fn);
 * await store.save('wf-123', resumeState);
 *
 * // Restore
 * const resumeState = await store.loadResumeState('wf-123');
 * if (resumeState) await workflow.run(fn, { resumeState });
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
export function libsql(urlOrOptions: string | LibSqlOptions): LibSqlStore {
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

  const store: LibSqlStore = {
    async save(id: string, state: StoreSaveInput): Promise<void> {
      await ensureTable();
      const fullId = prefix + id;
      const toStore = isResumeState(state) ? serializeResumeState(state) : state;
      const json = JSON.stringify(toStore);
      await client.execute({
        sql: `INSERT INTO ${tableName} (id, snapshot, updated_at)
              VALUES (?, ?, datetime('now'))
              ON CONFLICT(id) DO UPDATE SET snapshot = ?, updated_at = datetime('now')`,
        args: [fullId, json, json],
      });
    },

    async load(id: string): Promise<StoreLoadResult> {
      await ensureTable();
      const fullId = prefix + id;
      const result = await client.execute({
        sql: `SELECT snapshot FROM ${tableName} WHERE id = ?`,
        args: [fullId],
      });
      if (result.rows.length === 0) return null;
      const raw = JSON.parse(result.rows[0].snapshot as string) as unknown;
      if (isSerializedResumeState(raw)) return deserializeResumeState(raw);
      if (isWorkflowSnapshot(raw)) return raw;
      return raw as WorkflowSnapshot;
    },

    async loadResumeState(id: string): Promise<ResumeState | null> {
      const loaded = await store.load(id);
      if (loaded === null) return null;
      if (isResumeState(loaded)) return loaded;
      return null;
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
