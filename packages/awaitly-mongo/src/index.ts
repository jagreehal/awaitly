/**
 * awaitly-mongo
 *
 * MongoDB persistence adapter for awaitly workflows.
 * Provides ready-to-use SnapshotStore backed by MongoDB.
 */

import type { Db, MongoClientOptions } from "mongodb";
import { MongoClient as MongoClientImpl } from "mongodb";
import type { WorkflowSnapshot, SnapshotStore } from "awaitly/persistence";
import type { WorkflowLock } from "awaitly/durable";
import { createMongoLock, type MongoLockOptions } from "./mongo-lock";

/** Document shape for the snapshots collection (string _id). */
interface SnapshotDoc {
  _id: string;
  snapshot: WorkflowSnapshot;
  updatedAt: Date;
}

// Re-export types for convenience
export type { SnapshotStore, WorkflowSnapshot } from "awaitly/persistence";
export type { WorkflowLock } from "awaitly/durable";
export type { MongoLockOptions } from "./mongo-lock";

// =============================================================================
// MongoOptions
// =============================================================================

/**
 * Options for the mongo() shorthand function.
 */
export interface MongoOptions {
  /** MongoDB connection URL. */
  url: string;
  /** Database name. @default 'awaitly' */
  database?: string;
  /** Collection name for snapshots. @default 'awaitly_snapshots' */
  collection?: string;
  /** Key prefix for IDs. @default '' */
  prefix?: string;
  /** Bring your own client. */
  client?: MongoClientImpl;
  /** MongoDB client options. */
  clientOptions?: MongoClientOptions;
  /** Cross-process lock options. When set, the store implements WorkflowLock. */
  lock?: MongoLockOptions;
}

// =============================================================================
// mongo() - One-liner Snapshot Store Setup
// =============================================================================

/**
 * Create a snapshot store backed by MongoDB.
 * This is the simplified one-liner API for workflow persistence.
 *
 * @example
 * ```typescript
 * import { mongo } from 'awaitly-mongo';
 *
 * // One-liner setup
 * const store = mongo('mongodb://localhost:27017/mydb');
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
 * // With options including cross-process locking
 * const store = mongo({
 *   url: 'mongodb://localhost:27017',
 *   database: 'myapp',
 *   collection: 'my_workflow_snapshots',
 *   prefix: 'orders:',
 *   lock: { lockCollectionName: 'my_workflow_locks' },
 * });
 * ```
 */
export function mongo(urlOrOptions: string | MongoOptions): SnapshotStore & Partial<WorkflowLock> {
  const opts = typeof urlOrOptions === "string" ? { url: urlOrOptions } : urlOrOptions;
  const prefix = opts.prefix ?? "";

  // Parse database from URL if provided
  let databaseName = opts.database;
  const urlMatch = opts.url.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/);
  if (!databaseName && urlMatch && urlMatch[1]) {
    databaseName = urlMatch[1];
  }
  databaseName = databaseName ?? "awaitly";

  const collectionName = opts.collection ?? "awaitly_snapshots";

  // Create or use existing client
  const ownClient = !opts.client;
  let client: MongoClientImpl | undefined = opts.client;
  let db: Db | undefined;
  let connected = false;
  let lock: { tryAcquire: WorkflowLock["tryAcquire"]; release: WorkflowLock["release"] } | null = null;

  const ensureConnected = async (): Promise<Db> => {
    if (db && connected) return db;

    if (!client) {
      client = new MongoClientImpl(opts.url, {
        directConnection: !opts.url.includes("mongodb+srv://"),
        ...opts.clientOptions,
      });
    }

    await client.connect();
    connected = true;
    db = client.db(databaseName);

    // Create index on updatedAt for list queries
    const collection = db.collection<SnapshotDoc>(collectionName);
    await collection.createIndex({ updatedAt: -1 }, { background: true }).catch(() => {
      // Index may already exist, ignore error
    });

    // Create lock if requested
    if (opts.lock && !lock) {
      lock = createMongoLock(db, opts.lock);
    }

    return db;
  };

  const store: SnapshotStore & Partial<WorkflowLock> = {
    async save(id: string, snapshot: WorkflowSnapshot): Promise<void> {
      const db = await ensureConnected();
      const collection = db.collection<SnapshotDoc>(collectionName);
      const fullId = prefix + id;
      await collection.updateOne(
        { _id: fullId },
        {
          $set: {
            snapshot,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
    },

    async load(id: string): Promise<WorkflowSnapshot | null> {
      const db = await ensureConnected();
      const collection = db.collection<SnapshotDoc>(collectionName);
      const fullId = prefix + id;
      const doc = await collection.findOne({ _id: fullId });
      if (!doc) return null;
      return doc.snapshot;
    },

    async delete(id: string): Promise<void> {
      const db = await ensureConnected();
      const collection = db.collection<SnapshotDoc>(collectionName);
      const fullId = prefix + id;
      await collection.deleteOne({ _id: fullId });
    },

    async list(options?: { prefix?: string; limit?: number }): Promise<Array<{ id: string; updatedAt: string }>> {
      const db = await ensureConnected();
      const collection = db.collection<SnapshotDoc>(collectionName);
      const filterPrefix = prefix + (options?.prefix ?? "");
      const limit = options?.limit ?? 100;
      const escaped = filterPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const cursor = collection
        .find({ _id: { $regex: `^${escaped}` } })
        .sort({ updatedAt: -1 })
        .limit(limit);

      const docs = await cursor.toArray();
      return docs.map(doc => ({
        id: String(doc._id).slice(prefix.length),
        updatedAt: doc.updatedAt.toISOString(),
      }));
    },

    async close(): Promise<void> {
      // Only close client if we created it
      if (ownClient && client) {
        await client.close();
        connected = false;
        db = undefined;
      }
    },

    // Lock methods are added dynamically below after first connection
    async tryAcquire(id: string, options?: { ttlMs?: number }): Promise<{ ownerToken: string } | null> {
      await ensureConnected();
      if (!lock) return null;
      return lock.tryAcquire(id, options);
    },

    async release(id: string, ownerToken: string): Promise<void> {
      await ensureConnected();
      if (!lock) return;
      return lock.release(id, ownerToken);
    },
  };

  // Only include lock methods if lock is configured
  if (!opts.lock) {
    delete store.tryAcquire;
    delete store.release;
  }

  return store;
}
