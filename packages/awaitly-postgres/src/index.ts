/**
 * awaitly-postgres
 *
 * PostgreSQL persistence adapter for awaitly workflows.
 * Provides ready-to-use SnapshotStore backed by PostgreSQL.
 * Supports both WorkflowSnapshot and ResumeState (serialized via serializeResumeState).
 */

import { Pool as PgPool } from "pg";
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
import { createPostgresLock, type PostgresLockOptions } from "./postgres-lock";

// Re-export types for convenience
export type { SnapshotStore, WorkflowSnapshot } from "awaitly/persistence";
export type { WorkflowLock } from "awaitly/durable";
export type { PostgresLockOptions } from "./postgres-lock";
export type { StoreSaveInput, StoreLoadResult } from "awaitly/workflow";

// =============================================================================
// PostgresOptions
// =============================================================================

/**
 * Options for the postgres() shorthand function.
 */
export interface PostgresOptions {
  /** PostgreSQL connection URL. */
  url: string;
  /** Table name for snapshots. @default 'awaitly_snapshots' */
  table?: string;
  /** Key prefix for IDs. @default '' */
  prefix?: string;
  /** Bring your own pool. */
  pool?: PgPool;
  /** Auto-create table on first use. @default true */
  autoCreateTable?: boolean;
  /** Cross-process lock options. When set, the store implements WorkflowLock. */
  lock?: PostgresLockOptions;
}

// =============================================================================
// postgres() - One-liner Snapshot Store Setup
// =============================================================================

const SAFE_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Create a snapshot store backed by PostgreSQL.
 * Save accepts WorkflowSnapshot or ResumeState; load returns whichever was stored.
 * Use loadResumeState(id) for type-safe restore, or toResumeState(await store.load(id)).
 *
 * @example
 * ```typescript
 * import { postgres } from 'awaitly-postgres';
 * import { createWorkflow, toResumeState } from 'awaitly/workflow';
 *
 * const store = postgres('postgresql://localhost/mydb');
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
 * // With options including cross-process locking
 * const store = postgres({
 *   url: 'postgresql://localhost/mydb',
 *   table: 'my_workflow_snapshots',
 *   prefix: 'orders:',
 *   lock: { lockTableName: 'my_workflow_locks' },
 * });
 * ```
 */
/** Postgres store with widened save/load for WorkflowSnapshot and ResumeState. Compatible with SnapshotStore for snapshot-only usage. */
export interface PostgresStore extends Partial<WorkflowLock> {
  save(id: string, state: StoreSaveInput): Promise<void>;
  load(id: string): Promise<StoreLoadResult>;
  loadResumeState(id: string): Promise<ResumeState | null>;
  delete(id: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<Array<{ id: string; updatedAt: string }>>;
  close(): Promise<void>;
}

export function postgres(urlOrOptions: string | PostgresOptions): PostgresStore {
  const opts = typeof urlOrOptions === "string" ? { url: urlOrOptions } : urlOrOptions;
  const tableName = opts.table ?? "awaitly_snapshots";

  if (!SAFE_TABLE_NAME.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}. Must be alphanumeric with underscores.`);
  }

  const prefix = opts.prefix ?? "";
  const autoCreateTable = opts.autoCreateTable ?? true;

  // Create or use existing pool
  const ownPool = !opts.pool;
  const pool = opts.pool ?? new PgPool({ connectionString: opts.url });
  let tableCreated = false;

  const ensureTable = async (): Promise<void> => {
    if (!autoCreateTable || tableCreated) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id TEXT PRIMARY KEY,
        snapshot JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS ${tableName}_updated_at_idx ON ${tableName} (updated_at DESC)
    `);
    tableCreated = true;
  };

  // Create lock if requested
  const lock = opts.lock ? createPostgresLock(pool, opts.lock) : null;

  const store: PostgresStore = {
    async save(id: string, state: StoreSaveInput): Promise<void> {
      await ensureTable();
      const fullId = prefix + id;
      const toStore = isResumeState(state) ? serializeResumeState(state) : state;
      await pool.query(
        `INSERT INTO ${tableName} (id, snapshot, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET snapshot = $2, updated_at = NOW()`,
        [fullId, JSON.stringify(toStore)]
      );
    },

    async load(id: string): Promise<StoreLoadResult> {
      await ensureTable();
      const fullId = prefix + id;
      const result = await pool.query(
        `SELECT snapshot FROM ${tableName} WHERE id = $1`,
        [fullId]
      );
      if (result.rows.length === 0) return null;
      const raw = result.rows[0].snapshot;
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
      await pool.query(`DELETE FROM ${tableName} WHERE id = $1`, [fullId]);
    },

    async list(options?: { prefix?: string; limit?: number }): Promise<Array<{ id: string; updatedAt: string }>> {
      await ensureTable();
      const filterPrefix = prefix + (options?.prefix ?? "");
      const limit = options?.limit ?? 100;

      const result = await pool.query(
        `SELECT id, updated_at FROM ${tableName}
         WHERE id LIKE $1
         ORDER BY updated_at DESC
         LIMIT $2`,
        [filterPrefix + "%", limit]
      );

      return result.rows.map(row => ({
        id: (row.id as string).slice(prefix.length),
        updatedAt: (row.updated_at as Date).toISOString(),
      }));
    },

    async close(): Promise<void> {
      // Only end pool if we created it
      if (ownPool) {
        await pool.end();
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
