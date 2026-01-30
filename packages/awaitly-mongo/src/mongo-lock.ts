/**
 * MongoDB workflow lock (lease) for cross-process concurrency control.
 * Uses a lease (TTL) + owner token; release verifies the token.
 */

import type { Db, Collection } from "mongodb";
import { randomUUID } from "node:crypto";

export interface MongoLockOptions {
  /**
   * Collection name for workflow locks.
   * @default 'workflow_lock'
   */
  lockCollectionName?: string;
}

interface LockDocument {
  _id: string;
  ownerToken: string;
  expiresAt: Date;
}

/**
 * Create tryAcquire and release functions that use a MongoDB lock collection.
 * Caller must pass the same Db used for state (so one connection).
 */
export function createMongoLock(
  db: Db,
  options: MongoLockOptions = {}
): {
  tryAcquire(
    id: string,
    opts?: { ttlMs?: number }
  ): Promise<{ ownerToken: string } | null>;
  release(id: string, ownerToken: string): Promise<void>;
  ensureLockCollection(): Promise<void>;
} {
  const lockCollectionName = options.lockCollectionName ?? "workflow_lock";
  const collection = db.collection<LockDocument>(lockCollectionName);

  async function ensureLockCollection(): Promise<void> {
    const collections = await db.listCollections({ name: lockCollectionName }).toArray();
    if (collections.length === 0) {
      await db.createCollection(lockCollectionName);
    }
  }

  async function tryAcquire(
    id: string,
    opts?: { ttlMs?: number }
  ): Promise<{ ownerToken: string } | null> {
    const ttlMs = opts?.ttlMs ?? 60_000;
    const ownerToken = randomUUID();
    const expiresAt = new Date(Date.now() + ttlMs);

    await ensureLockCollection();

    // Atomic: insert or update only when no doc or doc is expired.
    // When lock exists and is unexpired, filter won't match and upsert
    // throws duplicate key error (E11000) - catch it and return null.
    try {
      const result = await collection.findOneAndUpdate(
        {
          _id: id,
          $or: [
            { expiresAt: { $lt: new Date() } },
            { expiresAt: { $exists: false } },
          ],
        },
        { $set: { ownerToken, expiresAt } },
        { upsert: true, returnDocument: "after" }
      );

      if (result && result.ownerToken === ownerToken) {
        return { ownerToken };
      }
      return null;
    } catch (error: unknown) {
      // Duplicate key error means lock exists and is not expired
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 11000
      ) {
        return null;
      }
      throw error;
    }
  }

  async function release(id: string, ownerToken: string): Promise<void> {
    await collection.deleteOne({ _id: id, ownerToken });
  }

  return { tryAcquire, release, ensureLockCollection };
}
