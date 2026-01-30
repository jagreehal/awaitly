import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createMongoPersistence } from "./index";
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
      const stateCollection = `test_state_db_${Date.now()}`;
      const lockCollectionName = `test_lock_db_${Date.now()}`;

      const store = await createMongoPersistence({
        connectionString,
        collection: stateCollection,
        lock: { lockCollectionName },
      });

      // Force state collection creation
      await store.save("test-key", { steps: new Map() }, { test: true });

      const client = new MongoClientImpl(connectionString);
      await client.connect();
      const db = client.db();
      const collections = await db.listCollections({ name: stateCollection }).toArray();

      expect(collections.length).toBe(1);

      await client.close();
      await store.delete("test-key");
    },
    20000
  );
  it(
    "lock: second tryAcquire returns null when lease is still active",
    async () => {
      const connectionString = TEST_CONNECTION_STRING || "mongodb://localhost:27017/test_awaitly";
      const lockCollectionName = `test_lock_${Date.now()}`;
      const store = await createMongoPersistence({
        connectionString,
        collection: `test_state_${Date.now()}`,
        lock: { lockCollectionName },
      });

      const lockStore = store as unknown as {
        tryAcquire(id: string, opts?: { ttlMs?: number }): Promise<{ ownerToken: string } | null>;
        release(id: string, ownerToken: string): Promise<void>;
      };

      const id = `lock-${Date.now()}`;
      const lease1 = await lockStore.tryAcquire(id, { ttlMs: 60_000 });
      expect(lease1).toBeTruthy();

      // Second acquisition while lease is active should return null (not throw).
      await expect(lockStore.tryAcquire(id, { ttlMs: 60_000 })).resolves.toBeNull();

      if (lease1) {
        await lockStore.release(id, lease1.ownerToken);
      }
    },
    20000
  );

  it(
    "should work with durable.run",
    async () => {
      const connectionString = TEST_CONNECTION_STRING || "mongodb://localhost:27017/test_awaitly";
      const store = await createMongoPersistence({
        connectionString,
        collection: `test_integration_${Date.now()}`,
      });

      // Test basic store operations first
      await store.save("test-key", { steps: new Map() }, { test: true });
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
          const user = await step(() => fetchUser("123"), { key: "fetch-user" });
          const order = await step(() => createOrder(user), { key: "create-order" });
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
    },
    20000 // 20 second timeout
  );
});
