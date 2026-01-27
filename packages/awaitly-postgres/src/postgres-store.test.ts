import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { PostgresKeyValueStore } from "./postgres-store";
import type { Pool } from "pg";
import { Pool as PgPool } from "pg";

// Test database connection - use environment variables or defaults
const TEST_CONNECTION_STRING = process.env.TEST_POSTGRES_CONNECTION_STRING ??
  (process.env.CI ? "postgresql://postgres:postgres@localhost:5432/test_awaitly" : undefined);
const TEST_DB_CONFIG = TEST_CONNECTION_STRING
  ? undefined
  : {
      host: process.env.TEST_POSTGRES_HOST ?? "localhost",
      port: parseInt(process.env.TEST_POSTGRES_PORT ?? "5432", 10),
      database: process.env.TEST_POSTGRES_DB ?? "test_awaitly",
      user: process.env.TEST_POSTGRES_USER ?? "postgres",
      password: process.env.TEST_POSTGRES_PASSWORD ?? "postgres",
    };

// Skip tests if database is not available (only skip locally when no connection configured)
const shouldSkip = !TEST_CONNECTION_STRING && !process.env.TEST_POSTGRES_HOST && !process.env.CI;

describe.skipIf(shouldSkip)("PostgresKeyValueStore", () => {
  let pool: Pool;
  let store: PostgresKeyValueStore;

  beforeAll(async () => {
    // Create a test pool
    if (TEST_CONNECTION_STRING) {
      pool = new PgPool({
        connectionString: TEST_CONNECTION_STRING,
      });
    } else if (TEST_DB_CONFIG) {
      pool = new PgPool({
        ...TEST_DB_CONFIG,
      });
    } else {
      throw new Error("No test database configuration provided");
    }

    // Test connection
    try {
      await pool.query("SELECT 1");
    } catch (error) {
      console.warn("PostgreSQL not available, skipping tests");
      throw error;
    }
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (store) {
      await store.close();
    }
  });

  beforeEach(async () => {
    // Create a new store with a unique table name for each test
    const tableName = `test_workflow_state_${Date.now()}`;
    store = new PostgresKeyValueStore({
      existingPool: pool,
      tableName,
    });

    // Ensure table is created
    await store.get("dummy"); // This triggers initialization
  });

  afterEach(async () => {
    if (store) {
      // Clean up test table
      const tableName = (store as any).tableName;
      try {
        await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
        await pool.query(`DROP INDEX IF EXISTS idx_${tableName}_expires_at`);
      } catch (error) {
        // Ignore cleanup errors
      }
      // Don't close the store's pool - we're using a shared pool
      // Just clear the reference
      store = null as any;
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

      // Should be expired
      expect(await store.get("key1")).toBeNull();
      expect(await store.exists("key1")).toBe(false);
    });

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
    });
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

    it("should escape SQL LIKE special characters", async () => {
      await store.set("key%percent", "value1");
      await store.set("key_underscore", "value2");
      await store.set("key_normal", "value3");

      // Pattern with % should match key%percent
      const keys = await store.keys("key%*");
      expect(keys).toContain("key%percent");
    });
  });

  describe("Connection options", () => {
    it("should work with connection string", async () => {
      const connectionString =
        TEST_CONNECTION_STRING ||
        `postgresql://${TEST_DB_CONFIG!.user}:${TEST_DB_CONFIG!.password}@${TEST_DB_CONFIG!.host}:${TEST_DB_CONFIG!.port}/${TEST_DB_CONFIG!.database}`;
      const testStore = new PostgresKeyValueStore({
        connectionString,
        tableName: `test_conn_string_${Date.now()}`,
      });

      try {
        await testStore.set("key1", "value1");
        const value = await testStore.get("key1");
        expect(value).toBe("value1");
      } finally {
        // Only close if we created our own pool
        if (!TEST_CONNECTION_STRING && !TEST_DB_CONFIG) {
          await testStore.close();
        }
      }
    });

    it("should work with individual connection options", async () => {
      if (!TEST_DB_CONFIG) {
        // Skip if using connection string
        return;
      }

      const testStore = new PostgresKeyValueStore({
        host: TEST_DB_CONFIG.host,
        port: TEST_DB_CONFIG.port,
        database: TEST_DB_CONFIG.database,
        user: TEST_DB_CONFIG.user,
        password: TEST_DB_CONFIG.password,
        tableName: `test_individual_${Date.now()}`,
      });

      try {
        await testStore.set("key1", "value1");
        const value = await testStore.get("key1");
        expect(value).toBe("value1");
      } finally {
        await testStore.close();
      }
    });
  });
});
