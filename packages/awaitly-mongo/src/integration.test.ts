import { describe, it, expect } from "vitest";
import { mongo } from "./index";
import { MongoClient as MongoClientImpl } from "mongodb";
import { durable } from "awaitly/durable";
import { ok, err, type AsyncResult } from "awaitly";

const TEST_CONNECTION_STRING = process.env.TEST_MONGODB_URI ??
  (process.env.CI ? "mongodb://localhost:27017/test_awaitly" : undefined);
const shouldSkip = !TEST_CONNECTION_STRING && !process.env.CI;

describe.skipIf(shouldSkip)("Integration with durable.run", () => {
  it(
    "lock: state collection uses database from connection string",
    async () => {
      let connectionString = TEST_CONNECTION_STRING || "mongodb://localhost:27017/test_awaitly";
      if (!/mongodb:\/\/[^/]+\/[^?]+/.test(connectionString)) {
        connectionString = connectionString.replace(/\/?(\?.*)?$/, "/test_awaitly$1");
      }
      const collectionName = `test_state_db_${Date.now()}`;
      const lockCollectionName = `test_lock_db_${Date.now()}`;

      const store = mongo({
        url: connectionString,
        collection: collectionName,
        lock: { lockCollectionName },
      });

      // Force collection creation by saving a snapshot
      const snapshot = {
        formatVersion: 1 as const,
        steps: {},
        execution: {
          status: "completed" as const,
          lastUpdated: new Date().toISOString(),
        },
      };
      await store.save("test-key", snapshot);

      const client = new MongoClientImpl(connectionString);
      await client.connect();
      const db = client.db();
      const collections = await db.listCollections({ name: collectionName }).toArray();

      expect(collections.length).toBe(1);

      await client.close();
      await store.delete("test-key");
      await store.close();
    },
    20000
  );

  it(
    "lock: second tryAcquire returns null when lease is still active",
    async () => {
      const connectionString = TEST_CONNECTION_STRING || "mongodb://localhost:27017/test_awaitly";
      const lockCollectionName = `test_lock_${Date.now()}`;
      const store = mongo({
        url: connectionString,
        collection: `test_state_${Date.now()}`,
        lock: { lockCollectionName },
      });

      const id = `lock-${Date.now()}`;
      const lease1 = await store.tryAcquire!(id, { ttlMs: 60_000 });
      expect(lease1).toBeTruthy();

      // Second acquisition while lease is active should return null (not throw).
      await expect(store.tryAcquire!(id, { ttlMs: 60_000 })).resolves.toBeNull();

      if (lease1) {
        await store.release!(id, lease1.ownerToken);
      }

      await store.close();
    },
    20000
  );

  it(
    "should work with durable.run",
    async () => {
      const connectionString = TEST_CONNECTION_STRING || "mongodb://localhost:27017/test_awaitly";
      const store = mongo({
        url: connectionString,
        collection: `test_integration_${Date.now()}`,
      });

      // Test basic store operations first
      const snapshot = {
        formatVersion: 1 as const,
        steps: {},
        execution: {
          status: "running" as const,
          lastUpdated: new Date().toISOString(),
        },
      };
      await store.save("test-key", snapshot);
      const loaded = await store.load("test-key");
      expect(loaded).toBeDefined();

      // Define a simple workflow
      const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
        if (id === "123") {
          return ok({ id: "123", name: "Alice" });
        }
        return err("NOT_FOUND");
      };

      const createOrder = async (user: { id: string; name: string }): AsyncResult<{ id: string; userId: string }, "EMPTY"> => {
        return ok({ id: "order-1", userId: user.id });
      };

      // Run workflow
      const result1 = await durable.run(
        { fetchUser, createOrder },
        async (step, { fetchUser, createOrder }) => {
          const user = await step("fetch-user", () => fetchUser("123"));
          const order = await step("create-order", () => createOrder(user));
          return order;
        },
        {
          id: `test-workflow-${Date.now()}`,
          store,
        }
      );

      if (!result1.ok) {
        console.error("Workflow failed:", result1.error);
      }
      expect(result1.ok).toBe(true);
      if (result1.ok) {
        expect(result1.value.id).toBe("order-1");
      }

      // Clean up
      await store.delete("test-key");
      await store.close();
    },
    20000 // 20 second timeout
  );
});
