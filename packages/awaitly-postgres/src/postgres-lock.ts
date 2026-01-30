/**
 * PostgreSQL workflow lock (lease) for cross-process concurrency control.
 * Uses a lease (TTL) + owner token; release verifies the token.
 */

import type { Pool } from "pg";
import { randomUUID } from "node:crypto";

export interface PostgresLockOptions {
  /**
   * Table name for workflow locks.
   * @default 'awaitly_workflow_lock'
   */
  lockTableName?: string;
}

/**
 * Create tryAcquire and release functions that use a PostgreSQL lock table.
 * Caller must pass the same pool used for state (so one connection pool).
 */
export function createPostgresLock(
  pool: Pool,
  options: PostgresLockOptions = {}
): {
  tryAcquire(
    id: string,
    opts?: { ttlMs?: number }
  ): Promise<{ ownerToken: string } | null>;
  release(id: string, ownerToken: string): Promise<void>;
  ensureLockTable(): Promise<void>;
} {
  const lockTableName = options.lockTableName ?? "awaitly_workflow_lock";

  const safeIndexName = `idx_${lockTableName.replace(/[^a-zA-Z0-9_]/g, "_")}_expires_at`;

  async function ensureLockTable(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${lockTableName} (
        workflow_id TEXT PRIMARY KEY,
        owner_token TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ${safeIndexName} ON ${lockTableName}(expires_at);
    `);
  }

  async function tryAcquire(
    id: string,
    opts?: { ttlMs?: number }
  ): Promise<{ ownerToken: string } | null> {
    const ttlMs = opts?.ttlMs ?? 60_000;
    const ownerToken = randomUUID();
    const expiresAt = new Date(Date.now() + ttlMs);

    await ensureLockTable();

    // Insert new row or update only if current row is expired (or missing).
    const result = await pool.query(
      `
      INSERT INTO ${lockTableName} (workflow_id, owner_token, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (workflow_id) DO UPDATE SET
        owner_token = EXCLUDED.owner_token,
        expires_at = EXCLUDED.expires_at
      WHERE ${lockTableName}.expires_at < NOW()
      RETURNING owner_token
    `,
      [id, ownerToken, expiresAt]
    );

    if (result.rowCount === 1 && result.rows[0].owner_token === ownerToken) {
      return { ownerToken };
    }
    return null;
  }

  async function release(id: string, ownerToken: string): Promise<void> {
    await pool.query(
      `DELETE FROM ${lockTableName} WHERE workflow_id = $1 AND owner_token = $2`,
      [id, ownerToken]
    );
  }

  return { tryAcquire, release, ensureLockTable };
}
