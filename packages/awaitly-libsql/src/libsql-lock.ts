/**
 * libSQL workflow lock (lease) for cross-process concurrency control.
 * Uses a lease (TTL) + owner token; release verifies the token.
 */

import type { Client } from "@libsql/client";
import { randomUUID } from "node:crypto";

export interface LibSqlLockOptions {
  /**
   * Table name for workflow locks.
   * @default 'awaitly_workflow_lock'
   */
  lockTableName?: string;
}

/**
 * Create tryAcquire and release functions that use a libSQL lock table.
 * Caller must pass the same client used for state (so one connection).
 */
export function createLibSqlLock(
  client: Client,
  options: LibSqlLockOptions = {}
): {
  tryAcquire(
    id: string,
    opts?: { ttlMs?: number }
  ): Promise<{ ownerToken: string } | null>;
  release(id: string, ownerToken: string): Promise<void>;
  ensureLockTable(): Promise<void>;
} {
  const lockTableName = options.lockTableName ?? "awaitly_workflow_lock";

  const safeTableName = lockTableName.replace(/[^a-zA-Z0-9_]/g, "_");

  async function ensureLockTable(): Promise<void> {
    await client.execute({
      sql: `
        CREATE TABLE IF NOT EXISTS ${lockTableName} (
          workflow_id TEXT PRIMARY KEY,
          owner_token TEXT NOT NULL,
          expires_at TEXT NOT NULL
        )
      `,
      args: [],
    });
    await client.execute({
      sql: `
        CREATE INDEX IF NOT EXISTS idx_${safeTableName}_expires_at
        ON ${lockTableName}(expires_at)
      `,
      args: [],
    });
  }

  async function tryAcquire(
    id: string,
    opts?: { ttlMs?: number }
  ): Promise<{ ownerToken: string } | null> {
    const ttlMs = opts?.ttlMs ?? 60_000;
    const ownerToken = randomUUID();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    await ensureLockTable();

    // Insert new row or update only if current row is expired (or missing).
    // SQLite 3.35+ / libSQL support RETURNING.
    const result = await client.execute({
      sql: `
        INSERT INTO ${lockTableName} (workflow_id, owner_token, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(workflow_id) DO UPDATE SET
          owner_token = excluded.owner_token,
          expires_at = excluded.expires_at
        WHERE ${lockTableName}.expires_at < datetime('now')
        RETURNING owner_token
      `,
      args: [id, ownerToken, expiresAt],
    });

    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (result.rows.length === 1 && row?.owner_token === ownerToken) {
      return { ownerToken };
    }
    return null;
  }

  async function release(id: string, ownerToken: string): Promise<void> {
    await client.execute({
      sql: `DELETE FROM ${lockTableName} WHERE workflow_id = ? AND owner_token = ?`,
      args: [id, ownerToken],
    });
  }

  return { tryAcquire, release, ensureLockTable };
}
