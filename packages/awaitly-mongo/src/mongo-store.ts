/**
 * awaitly-mongo
 *
 * MongoDB KeyValueStore implementation for awaitly persistence.
 */

import type {
  MongoClient,
  MongoClientOptions,
  Db,
  Collection,
  WithId,
  Document,
} from "mongodb";
import { MongoClient as MongoClientImpl } from "mongodb";
import type { KeyValueStore, ListPageOptions } from "awaitly/persistence";

/**
 * Options for MongoDB KeyValueStore.
 */
export interface MongoKeyValueStoreOptions {
  /**
   * MongoDB connection string.
   *
   * @example 'mongodb://localhost:27017'
   * @example 'mongodb://user:password@localhost:27017/dbname'
   */
  connectionString?: string;

  /**
   * Database name.
   * @default 'awaitly'
   */
  database?: string;

  /**
   * Collection name for storing key-value pairs.
   * @default 'workflow_state'
   */
  collection?: string;

  /**
   * Additional MongoDB client options.
   */
  clientOptions?: MongoClientOptions;

  /**
   * Existing MongoDB client to use.
   * If provided, connection options are ignored.
   */
  existingClient?: MongoClient;

  /**
   * Existing database instance to use.
   * If provided, connection and database options are ignored.
   */
  existingDb?: Db;
}

/**
 * Document schema for stored values.
 */
interface KeyValueDocument extends Document {
  _id: string;
  value: string;
  expiresAt?: Date | null;
  updatedAt?: Date | null;
}

/**
 * MongoDB implementation of KeyValueStore.
 *
 * Automatically creates the required collection with TTL index on first use.
 * Supports TTL via expiresAt field with automatic expiration.
 */
export class MongoKeyValueStore implements KeyValueStore {
  private client: MongoClient | null = null;
  private db: Db;
  private collection: Collection<KeyValueDocument>;
  private collectionName: string;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private shouldCloseClient: boolean = false;

  constructor(options: MongoKeyValueStoreOptions) {
    if (options.existingDb) {
      // Use provided database
      this.db = options.existingDb;
      this.collectionName = options.collection ?? "workflow_state";
      this.collection = this.db.collection<KeyValueDocument>(this.collectionName);
    } else if (options.existingClient) {
      // Use provided client
      this.client = options.existingClient;
      const databaseName = options.database ?? "awaitly";
      this.db = this.client.db(databaseName);
      this.collectionName = options.collection ?? "workflow_state";
      this.collection = this.db.collection<KeyValueDocument>(this.collectionName);
    } else {
      // Create new client
      let connectionString = options.connectionString ?? "mongodb://localhost:27017";
      
      // Extract database name from connection string if present
      let databaseName = options.database;
      const urlMatch = connectionString.match(/mongodb:\/\/[^/]+\/([^?]+)/);
      if (urlMatch && urlMatch[1]) {
        databaseName = databaseName || urlMatch[1];
        // Remove database from connection string to avoid conflicts
        connectionString = connectionString.replace(/\/[^/?]+(\?|$)/, '/$1');
      }
      
      this.client = new MongoClientImpl(connectionString, {
        directConnection: true, // Use direct connection for single-node instances
        ...options.clientOptions,
      });
      this.shouldCloseClient = true;
      databaseName = databaseName ?? "awaitly";
      this.db = this.client.db(databaseName);
      this.collectionName = options.collection ?? "workflow_state";
      this.collection = this.db.collection<KeyValueDocument>(this.collectionName);
    }
  }

  /**
   * Initialize the store by connecting to MongoDB and creating the collection with TTL index.
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
        // Connect client if we created it
        if (this.client && this.shouldCloseClient) {
          // Connect if not already connected
          try {
            await this.client.db("admin").command({ ping: 1 });
          } catch {
            // Not connected, connect now
            await this.client.connect();
          }
        }

        await this.createCollection();
        this.initialized = true;
      } catch (error) {
        this.initPromise = null;
        throw error;
      }
    })();

    return this.initPromise;
  }

  /**
   * Create the collection and TTL index if they don't exist.
   */
  private async createCollection(): Promise<void> {
    // Create collection if it doesn't exist
    const collections = await this.db.listCollections({ name: this.collectionName }).toArray();
    if (collections.length === 0) {
      await this.db.createCollection(this.collectionName);
    }

    // Create TTL index on expiresAt field
    try {
      const indexes = await this.collection.indexes();
      const hasTtlIndex = indexes.some(
        (index) => index.key && "expiresAt" in index.key && index.expireAfterSeconds !== undefined
      );

      if (!hasTtlIndex) {
        await this.collection.createIndex(
          { expiresAt: 1 },
          {
            expireAfterSeconds: 0, // Delete immediately when expiresAt is reached
            name: "expiresAt_ttl",
          }
        );
      }
    } catch (error) {
      // Index might already exist from a previous run, ignore duplicate key errors
      if ((error as { code?: number })?.code !== 85) {
        throw error;
      }
    }
  }

  /**
   * Convert glob pattern to MongoDB regex pattern.
   * Supports * wildcard (matches any characters).
   */
  private patternToRegex(pattern: string): RegExp {
    // Escape regex special characters and convert * to .*
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`);
  }

  async get(key: string): Promise<string | null> {
    await this.ensureInitialized();

    const doc = await this.collection.findOne({
      _id: key,
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    });

    if (!doc) {
      return null;
    }

    return doc.value;
  }

  async set(key: string, value: string, options?: { ttl?: number }): Promise<void> {
    await this.ensureInitialized();

    const expiresAt = options?.ttl ? new Date(Date.now() + options.ttl * 1000) : undefined;

    const update: Record<string, unknown> = {
      $set: {
        value,
        updatedAt: new Date(),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      },
    };
    if (expiresAt === undefined) {
      update.$unset = { expiresAt: "" };
    }

    await this.collection.updateOne({ _id: key }, update, { upsert: true });
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();

    const result = await this.collection.deleteOne({ _id: key });
    return result.deletedCount > 0;
  }

  async exists(key: string): Promise<boolean> {
    await this.ensureInitialized();

    const count = await this.collection.countDocuments({
      _id: key,
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    });

    return count > 0;
  }

  async keys(pattern: string): Promise<string[]> {
    await this.ensureInitialized();

    const regex = this.patternToRegex(pattern);

    const docs = await this.collection
      .find({
        _id: regex,
        $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      })
      .project({ _id: 1 })
      .toArray();

    return docs.map((doc) => doc._id);
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
    const orderDir = options.orderDir === "asc" ? 1 : -1;
    const regex = this.patternToRegex(pattern);

    const baseFilter: Record<string, unknown> = {
      _id: regex,
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    };
    if (options.updatedBefore != null && options.updatedAfter != null) {
      (baseFilter as Record<string, unknown>).updatedAt = {
        $lt: options.updatedBefore,
        $gt: options.updatedAfter,
      };
    } else if (options.updatedBefore != null) {
      (baseFilter as Record<string, unknown>).updatedAt = { $lt: options.updatedBefore };
    } else if (options.updatedAfter != null) {
      (baseFilter as Record<string, unknown>).updatedAt = { $gt: options.updatedAfter };
    }

    const sortKey = options.orderBy === "key" ? "_id" : "updatedAt";
    const cursor = this.collection
      .find(baseFilter)
      .project({ _id: 1 })
      .sort({ [sortKey]: orderDir })
      .skip(offset)
      .limit(limit);

    const docs = await cursor.toArray();
    const keys = docs.map((doc) => doc._id);

    let total: number | undefined;
    if (options.includeTotal === true || offset > 0) {
      total = await this.collection.countDocuments(baseFilter);
    }

    return { keys, total };
  }

  /**
   * Delete multiple keys in one round-trip.
   */
  async deleteMany(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    await this.ensureInitialized();
    const result = await this.collection.deleteMany({ _id: { $in: keys } });
    return result.deletedCount ?? 0;
  }

  /**
   * Remove all entries from the collection (clear all workflow state).
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this.collection.deleteMany({});
  }

  /**
   * Close the MongoDB client connection.
   * Only closes if this store created the client.
   */
  async close(): Promise<void> {
    if (this.client && this.shouldCloseClient) {
      await this.client.close();
      this.client = null;
    }
  }
}
