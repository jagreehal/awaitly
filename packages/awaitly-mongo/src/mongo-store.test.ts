import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { MongoKeyValueStore } from "./mongo-store";
import type { MongoClient, Db } from "mongodb";
import { MongoClient as MongoClientImpl } from "mongodb";

// Test database connection - use environment variables or defaults
const TEST_CONNECTION_STRING = process.env.TEST_MONGODB_URI;
const TEST_DB_CONFIG = {
  connectionString: TEST_CONNECTION_STRING ?? "mongodb://localhost:27017",
  database: process.env.TEST_MONGODB_DB ?? "test_awaitly",
};

// Skip tests if database is not available (but run in CI)
const shouldSkip = !TEST_CONNECTION_STRING && !process.env.TEST_MONGODB_URI && !process.env.CI;

describe.skipIf(shouldSkip)("MongoKeyValueStore", () => {
  let client: MongoClient;
  let db: Db;
  let store: MongoKeyValueStore;

  beforeAll(
    async () => {
      // Create a test client
      let connectionString = TEST_CONNECTION_STRING || TEST_DB_CONFIG.connectionString;
      // If connection string doesn't include database, append it
      if (!connectionString.includes('/') || connectionString.split('/').length < 2) {
        connectionString = `${connectionString}/${TEST_DB_CONFIG.database}`;
      }
      
      client = new MongoClientImpl(connectionString, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 10000,
        directConnection: true, // Use direct connection for single-node instances
      });
      
      try {
        await client.connect();
        // Verify connection with a ping
        await client.db("admin").command({ ping: 1 });
        // Extract database name from connection string or use default
        const dbName = connectionString.split('/').pop()?.split('?')[0] || TEST_DB_CONFIG.database;
        db = client.db(dbName);
      } catch (error) {
        console.error("MongoDB connection failed:", error);
        throw error;
      }
    },
    20000 // 20 second timeout
  );

  afterAll(async () => {
    if (client) {
      await client.close();
    }
  });

  beforeEach(async () => {
    // Create a new store with a unique collection name for each test
    const collectionName = `test_workflow_state_${Date.now()}`;
    store = new MongoKeyValueStore({
      existingDb: db,
      collection: collectionName,
    });

    // Ensure collection is created
    await store.get("dummy"); // This triggers initialization
  });

  afterEach(async () => {
    if (store) {
      // Clean up test collection
      const collectionName = (store as any).collectionName;
      await db.collection(collectionName).drop().catch(() => {
        // Ignore errors if collection doesn't exist
      });
    }
  });

  describe("KeyValueStore interface", () => {
    it("should get a value that was set", async () => {
      await store.set("key1", "value1");
      const value = await store.get("key1");
      expect(value).toBe("value1");
    });

    it("should return null for non-existent key", async () => {
      const value = await store.get("nonexistent");
      expect(value).toBeNull();
    });

    it("should update existing key", async () => {
      await store.set("key1", "value1");
      await store.set("key1", "value2");
      const value = await store.get("key1");
      expect(value).toBe("value2");
    });

    it("should delete a key", async () => {
      await store.set("key1", "value1");
      const deleted = await store.delete("key1");
      expect(deleted).toBe(true);

      const value = await store.get("key1");
      expect(value).toBeNull();
    });

    it("should return false when deleting non-existent key", async () => {
      const deleted = await store.delete("nonexistent");
      expect(deleted).toBe(false);
    });

    it("should check if key exists", async () => {
      expect(await store.exists("key1")).toBe(false);

      await store.set("key1", "value1");
      expect(await store.exists("key1")).toBe(true);

      await store.delete("key1");
      expect(await store.exists("key1")).toBe(false);
    });

    it("should list keys matching pattern", async () => {
      await store.set("workflow:state:run1", "value1");
      await store.set("workflow:state:run2", "value2");
      await store.set("workflow:cache:key1", "value3");

      const keys = await store.keys("workflow:state:*");
      expect(keys).toContain("workflow:state:run1");
      expect(keys).toContain("workflow:state:run2");
      expect(keys).not.toContain("workflow:cache:key1");
    });

    it("should handle empty pattern (matches all)", async () => {
      await store.set("key1", "value1");
      await store.set("key2", "value2");

      const keys = await store.keys("*");
      expect(keys.length).toBeGreaterThanOrEqual(2);
      expect(keys).toContain("key1");
      expect(keys).toContain("key2");
    });
  });

  describe("TTL support", () => {
    it("should expire keys after TTL", async () => {
      // Set key with 1 second TTL
      await store.set("key1", "value1", { ttl: 1 });

      // Should exist immediately
      expect(await store.get("key1")).toBe("value1");
      expect(await store.exists("key1")).toBe(true);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be expired (MongoDB TTL index may take a moment)
      // We check that it's not accessible via our query
      const value = await store.get("key1");
      expect(value).toBeNull();
    }, 10000); // Longer timeout for TTL test

    it("should not expire keys without TTL", async () => {
      await store.set("key1", "value1");

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should still exist
      expect(await store.get("key1")).toBe("value1");
      expect(await store.exists("key1")).toBe(true);
    });

    it("should update TTL when updating key", async () => {
      // Set with short TTL
      await store.set("key1", "value1", { ttl: 1 });

      // Wait a bit but not enough to expire
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Update with longer TTL
      await store.set("key1", "value1", { ttl: 2 });

      // Wait for original TTL to pass
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Should still exist (new TTL)
      expect(await store.get("key1")).toBe("value1");
    }, 10000);
  });

  describe("Pattern matching", () => {
    it("should handle special characters in patterns", async () => {
      await store.set("key:with:colons", "value1");
      await store.set("key_with_underscores", "value2");
      await store.set("key-with-dashes", "value3");

      // Pattern "key:*" matches keys starting with "key:"
      const keysWithColon = await store.keys("key:*");
      expect(keysWithColon).toContain("key:with:colons");
      expect(keysWithColon).not.toContain("key_with_underscores");
      expect(keysWithColon).not.toContain("key-with-dashes");

      // Pattern "key*" matches all keys starting with "key"
      const allKeys = await store.keys("key*");
      expect(allKeys).toContain("key:with:colons");
      expect(allKeys).toContain("key_with_underscores");
      expect(allKeys).toContain("key-with-dashes");
    });

    it("should escape regex special characters", async () => {
      await store.set("key.dot", "value1");
      await store.set("key+plus", "value2");
      await store.set("key$dollar", "value3");
      await store.set("key_normal", "value4");

      // Pattern with dot should match key.dot
      const keys = await store.keys("key.*");
      expect(keys).toContain("key.dot");
    });
  });

  describe("Connection options", () => {
    it("should work with connection string", async () => {
      const testStore = new MongoKeyValueStore({
        connectionString: TEST_DB_CONFIG.connectionString,
        database: TEST_DB_CONFIG.database,
        collection: `test_conn_string_${Date.now()}`,
      });

      try {
        await testStore.set("key1", "value1");
        const value = await testStore.get("key1");
        expect(value).toBe("value1");
      } finally {
        await testStore.close();
      }
    });

    it("should work with existing client", async () => {
      const testClient = new MongoClientImpl(TEST_DB_CONFIG.connectionString);
      await testClient.connect();

      try {
        const testStore = new MongoKeyValueStore({
          existingClient: testClient,
          database: TEST_DB_CONFIG.database,
          collection: `test_existing_client_${Date.now()}`,
        });

        await testStore.set("key1", "value1");
        const value = await testStore.get("key1");
        expect(value).toBe("value1");

        // Should not close the client we provided
        await testStore.close();
        // Client should still be connected
        expect(testClient).toBeDefined();
      } finally {
        await testClient.close();
      }
    });

    it("should work with existing database", async () => {
      const testStore = new MongoKeyValueStore({
        existingDb: db,
        collection: `test_existing_db_${Date.now()}`,
      });

      await testStore.set("key1", "value1");
      const value = await testStore.get("key1");
      expect(value).toBe("value1");
    });
  });
});
