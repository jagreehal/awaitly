/**
 * Test file to verify all code examples in resource-management.md actually work
 * This file should compile and run without errors
 */

import { describe, it, expect, vi } from "vitest";
import {
  withScope,
  createResourceScope,
  createResource,
  isResourceCleanupError,
  type Resource,
  type ResourceCleanupError,
} from "./resource";
import { Awaitly, type AsyncResult } from "./index";
const { ok, err } = Awaitly;
import { createWorkflow } from "./workflow-entry";

// ============================================================================
// Mock Resources
// ============================================================================

interface DbClient {
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  close: () => Promise<void>;
}

interface CacheClient {
  get: (key: string) => Promise<unknown>;
  disconnect: () => Promise<void>;
}

interface Session {
  id: string;
  end: () => Promise<void>;
}

async function createDbConnection(): Promise<DbClient> {
  return {
    query: async (_sql: string) => [{ id: "1", name: "Test" }],
    close: async () => {},
  };
}

async function createCache(_db?: DbClient): Promise<CacheClient> {
  return {
    get: async (_key: string) => ({ cached: true }),
    disconnect: async () => {},
  };
}

async function createSession(
  _db: DbClient,
  _cache: CacheClient
): Promise<Session> {
  return {
    id: "session-123",
    end: async () => {},
  };
}

type User = { id: string; name: string };

async function processUser(_user: unknown): Promise<unknown> {
  return { processed: true };
}

// Alias for consistency with markdown examples
// In markdown, createConnection is used, but we use createDbConnection in tests
const createConnection = createDbConnection;

// ============================================================================
// Basic Usage Examples
// ============================================================================

describe("resource-management", () => {
  describe("The Solution: withScope", () => {
    it("processData example with early return", async () => {
      const closeCalls: string[] = [];

      // Create a mock that returns empty for this test
      const mockDb: DbClient = {
        query: async (_sql: string) => [], // Return empty to trigger early return
        close: async () => {},
      };

      async function processData(userId: string) {
        return withScope(async (scope) => {
          // scope.add returns the value directly for convenience
          const db = scope.add({
            value: mockDb,
            close: async () => {
              closeCalls.push("db");
              await db.close();
            },
          });

          const cache = scope.add({
            value: await createCache(),
            close: async () => {
              closeCalls.push("cache");
              await cache.disconnect();
            },
          });

          const user = await db.query("SELECT * FROM users WHERE id = ?", [
            userId,
          ]);
          if (!user || user.length === 0) {
            return err("USER_NOT_FOUND" as const); // ✓ db and cache still get closed
          }

          return ok(await processUser(user));
          // ✓ Resources closed automatically in LIFO order
        });
      }

      const result = await processData("123");
      expect(result.ok).toBe(false);
      expect(closeCalls).toEqual(["cache", "db"]); // LIFO order
    });
  });

  describe("Basic Usage", () => {
    it("getUsers function example", async () => {
      const closeCalls: string[] = [];

      async function getUsers(): AsyncResult<User[], "DB_ERROR"> {
        return withScope(async (scope) => {
          // scope.add returns the value directly
          const db = scope.add({
            value: await createDbConnection(),
            close: async () => {
              closeCalls.push("db");
              await db.close();
            },
          });

          const users = await db.query("SELECT * FROM users");
          return ok(users as User[]);
        });
      }

      const result = await getUsers();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([{ id: "1", name: "Test" }]);
      }
      expect(closeCalls).toEqual(["db"]);
    });
  });

  describe("withScope", () => {
    it("automatically cleans up resources on success", async () => {
      const closeCalls: string[] = [];

      const result = await withScope(async (scope) => {
        // scope.add returns the value directly, not a wrapper
        const db = scope.add({
          value: await createDbConnection(),
          close: async () => {
            closeCalls.push("db");
          },
        });

        scope.add({
          value: await createCache(),
          close: async () => {
            closeCalls.push("cache");
          },
        });

        // db is the DbClient directly
        const users = await db.query("SELECT * FROM users");
        return ok(users);
      });

      expect(result.ok).toBe(true);
      expect(closeCalls).toEqual(["cache", "db"]); // LIFO order
    });

    it("cleans up resources on early return", async () => {
      const closeCalls: string[] = [];

      const result = await withScope(async (scope) => {
        scope.add({
          value: await createDbConnection(),
          close: async () => {
            closeCalls.push("db");
          },
        });

        scope.add({
          value: await createCache(),
          close: async () => {
            closeCalls.push("cache");
          },
        });

        // Early return - resources still get cleaned up
        return err("USER_NOT_FOUND" as const);
      });

      expect(result.ok).toBe(false);
      expect(closeCalls).toEqual(["cache", "db"]);
    });

    it("cleans up resources on exception", async () => {
      const closeCalls: string[] = [];

      await expect(
        withScope(async (scope) => {
          scope.add({
            value: "resource",
            close: async () => {
              closeCalls.push("resource");
            },
          });

          throw new Error("Unexpected error");
        })
      ).rejects.toThrow("Unexpected error");

      expect(closeCalls).toEqual(["resource"]);
    });
  });

  describe("LIFO cleanup order", () => {
    it("closes resources in reverse order", async () => {
      const closeCalls: string[] = [];

      const result = await withScope(async (scope) => {
        // 1. Connection first
        const db = scope.add({
          value: await createConnection(),
          close: async () => {
            closeCalls.push("db");
            await db.close();
          },
        });

        // 2. Cache depends on connection
        const cache = scope.add({
          value: await createCache(db), // pass db directly
          close: async () => {
            closeCalls.push("cache");
            await cache.disconnect();
          },
        });

        // 3. Session depends on both
        const session = scope.add({
          value: await createSession(db, cache),
          close: async () => {
            closeCalls.push("session");
            await session.end();
          },
        });

        return ok("done");
      });

      expect(result.ok).toBe(true);
      // Output: Closing session (added last, closed first)
      //         Closing cache
      //         Closing db (added first, closed last)
      expect(closeCalls).toEqual(["session", "cache", "db"]);
    });
  });

  describe("createResource helper", () => {
    it("wraps acquire/release pattern", async () => {
      const closeCalls: string[] = [];

      const result = await withScope(async (scope) => {
        // createResource wraps acquire + release into a Resource
        const dbResource = await createResource(
          () => createConnection(),
          (conn) => {
            closeCalls.push("db");
            return conn.close();
          }
        );
        const db = scope.add(dbResource);

        const cacheResource = await createResource(
          () => createCache(),
          (cache) => {
            closeCalls.push("cache");
            return cache.disconnect();
          }
        );
        scope.add(cacheResource);

        // Use resources
        return ok(await db.query("SELECT 1"));
      });

      expect(result.ok).toBe(true);
      expect(closeCalls).toEqual(["cache", "db"]);
    });
  });

  describe("cleanup errors", () => {
    it("returns ResourceCleanupError on cleanup failure", async () => {
      const result = await withScope(async (scope) => {
        scope.add({
          value: "resource1",
          close: async () => {
            throw new Error("Cleanup failed!");
          },
        });

        return ok("done");
      });

      expect(result.ok).toBe(false);
      if (!result.ok && isResourceCleanupError(result.error)) {
        expect(result.error.type).toBe("RESOURCE_CLEANUP_ERROR");
        expect(result.error.errors.length).toBe(1);
        expect(result.error.originalResult).toEqual({ ok: true, value: "done" });
      }
    });

    it("collects multiple cleanup errors", async () => {
      const result = await withScope(async (scope) => {
        scope.add({
          value: "resource1",
          close: async () => {
            throw new Error("Cleanup 1 failed");
          },
        });

        scope.add({
          value: "resource2",
          close: async () => {
            throw new Error("Cleanup 2 failed");
          },
        });

        return ok("done");
      });

      expect(result.ok).toBe(false);
      if (!result.ok && isResourceCleanupError(result.error)) {
        expect(result.error.errors.length).toBe(2);
      }
    });

    it("continues cleanup even if one resource fails", async () => {
      const closeCalls: string[] = [];

      await withScope(async (scope) => {
        scope.add({
          value: "resource1",
          close: async () => {
            closeCalls.push("resource1");
          },
        });

        scope.add({
          value: "resource2",
          close: async () => {
            closeCalls.push("resource2-fail");
            throw new Error("Cleanup failed");
          },
        });

        scope.add({
          value: "resource3",
          close: async () => {
            closeCalls.push("resource3");
          },
        });

        return ok("done");
      });

      // All resources attempted in LIFO order
      expect(closeCalls).toEqual(["resource3", "resource2-fail", "resource1"]);
    });
  });

  describe("isResourceCleanupError type guard", () => {
    it("correctly identifies ResourceCleanupError", () => {
      const error: ResourceCleanupError = {
        type: "RESOURCE_CLEANUP_ERROR",
        errors: [new Error("test")],
      };

      expect(isResourceCleanupError(error)).toBe(true);
      expect(isResourceCleanupError({ type: "OTHER" })).toBe(false);
      expect(isResourceCleanupError(null)).toBe(false);
      expect(isResourceCleanupError("string")).toBe(false);
    });
  });

  describe("createResourceScope (manual)", () => {
    it("allows manual scope management", async () => {
      const closeCalls: string[] = [];
      const scope = createResourceScope();

      try {
        // scope.add returns the value directly, not a Resource wrapper
        const db = scope.add({
          value: await createConnection(),
          close: async () => {
            closeCalls.push("db");
            await db.close(); // db IS the connection
          },
        });

        const cache = scope.add({
          value: await createCache(),
          close: async () => {
            closeCalls.push("cache");
            await cache.disconnect(); // cache IS the client
          },
        });

        // Check scope state
        expect(scope.size()).toBe(2);

        // Use resources...
        await db.query("SELECT 1");
      } finally {
        await scope.close(); // Manual cleanup
      }

      expect(closeCalls).toEqual(["cache", "db"]);
      expect(scope.size()).toBe(0); // Cleared after close
    });

    it("provides has() method to check resource membership", async () => {
      const scope = createResourceScope();

      const resource: Resource<string> = {
        value: "test",
        close: async () => {},
      };

      scope.add(resource);
      expect(scope.has(resource)).toBe(true);

      const otherResource: Resource<string> = {
        value: "other",
        close: async () => {},
      };
      expect(scope.has(otherResource)).toBe(false);

      await scope.close();
    });

    it("scope.has() example from documentation note", async () => {
      const scope = createResourceScope();

      // scope.has() expects a Resource<T> object, not the value
      const dbResource: Resource<DbClient> = {
        value: await createDbConnection(),
        close: async () => {
          await dbResource.value.close();
        },
      };
      scope.add(dbResource);
      expect(scope.has(dbResource)).toBe(true); // true

      await scope.close();
    });
  });

  describe("integration with workflows", () => {
    it("works inside workflow steps", async () => {
      const closeCalls: string[] = [];

      const deps = {
        processWithResources: async (
          id: string
        ): AsyncResult<unknown[], "PROCESS_ERROR" | ResourceCleanupError> => {
          return withScope(async (scope) => {
            const db = scope.add({
              value: await createConnection(),
              close: async () => {
                closeCalls.push("db");
                await db.close();
              },
            });

            const data = await db.query("SELECT * FROM items WHERE id = ?", [
              id,
            ]);
            return ok(data);
          });
        },
      };

      const workflow = createWorkflow("workflow", deps);

      const result = await workflow(async ({ step, deps: { processWithResources } }) => {
        const data = await step('processWithResources', () => processWithResources("123"));
        return ok(data);
      });

      expect(result.ok).toBe(true);
      expect(closeCalls).toEqual(["db"]);
    });
  });

  describe("Best Practices", () => {
    it("DO: Register cleanup immediately after acquisition", async () => {
      const closeCalls: string[] = [];

      await withScope(async (scope) => {
        // ✓ Register right after acquiring
        const db = scope.add({
          value: await createConnection(),
          close: async () => {
            closeCalls.push("db");
            await db.close();
          },
        });

        return ok("done");
      });

      expect(closeCalls).toEqual(["db"]);
    });

    it("DO: Handle cleanup errors appropriately", async () => {
      const logger = {
        error: vi.fn(),
      };

      const result = await withScope(async (scope) => {
        scope.add({
          value: await createConnection(),
          close: async () => {
            throw new Error("Cleanup failed");
          },
        });

        return ok("success");
      });

      if (!result.ok) {
        if (isResourceCleanupError(result.error)) {
          // Log cleanup issues but don't expose to users
          logger.error("Resource cleanup failed", result.error.errors);
          // Return the original error if there was one
          if (
            result.error.originalResult &&
            typeof result.error.originalResult === "object" &&
            result.error.originalResult !== null &&
            "ok" in result.error.originalResult &&
            !result.error.originalResult.ok
          ) {
            return result.error.originalResult;
          }
        }
      }

      expect(result.ok).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Real-World Scenarios
  // ============================================================================

  describe("real-world scenarios", () => {
    describe("Database Transaction with File Upload", () => {
      it("rolls back transaction and deletes file on failure", async () => {
        const rollbackCalls: string[] = [];
        const deleteCalls: string[] = [];

        const mockDb = {
          beginTransaction: async () => ({
            execute: async (_sql: string, _params: unknown[]) => {},
            commit: async () => {},
            rollback: async () => {
              rollbackCalls.push("rollback");
            },
          }),
        };

        const mockS3 = {
          upload: async (_key: string, _data: unknown) => ({ key: "receipts/123.pdf" }),
          delete: async (_key: string) => {
            deleteCalls.push("delete");
          },
        };

        async function processOrder(orderId: string, _receiptData: Buffer) {
          return withScope(async (scope) => {
            // In failure case, committed stays false
            const committed = false;

            const tx = scope.add({
              value: await mockDb.beginTransaction(),
              close: async () => {
                if (!committed) {
                  await tx.rollback();
                }
              },
            });

            const receiptKey = `receipts/${orderId}.pdf`;
            scope.add({
              value: await mockS3.upload(receiptKey, Buffer.from("data")),
              close: async () => {
                await mockS3.delete(receiptKey);
              },
            });

            // Simulate failure before commit - return error result
            return err("PROCESSING_FAILED" as const);
          });
        }

        const result = await processOrder("123", Buffer.from("data"));

        expect(result.ok).toBe(false);
        expect(rollbackCalls).toContain("rollback");
        expect(deleteCalls).toContain("delete");
      });
    });

    describe("Multi-Tenant Data Export", () => {
      it("cleans up resources for each tenant", async () => {
        const cleanupCalls: string[] = [];

        async function createTempDir(tenantId: string): Promise<string> {
          return `/tmp/export-${tenantId}-${Date.now()}`;
        }

        async function releaseTempDir(dir: string): Promise<void> {
          cleanupCalls.push(`cleanup-${dir}`);
        }

        const mockConn = {
          query: async (_sql: string) => [{ id: "1" }, { id: "2" }],
          close: async () => {
            cleanupCalls.push("close-conn");
          },
        };

        async function getTenantConnection(_tenantId: string) {
          return mockConn;
        }

        async function exportTenantData(tenantId: string) {
          return withScope(async (scope) => {
            const exportDir = scope.add({
              value: await createTempDir(tenantId),
              close: async () => {
                await releaseTempDir(exportDir);
              },
            });

            const conn = scope.add({
              value: await getTenantConnection(tenantId),
              close: async () => {
                await conn.close();
              },
            });

            const data = await conn.query("SELECT * FROM user_data");

            return ok({ tenantId, recordCount: data.length });
          });
        }

        const result = await exportTenantData("tenant-1");

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.recordCount).toBe(2);
        }
        // Resources should be cleaned up
        expect(cleanupCalls.length).toBeGreaterThan(0);
      });
    });

    describe("Webhook Processing with Temporary Credentials", () => {
      it("releases lock even on failure", async () => {
        const releaseCalls: string[] = [];

        const mockLock = {
          release: async () => {
            releaseCalls.push("lock-released");
          },
        };

        const mockRedis = {
          lock: async (_key: string, _opts: unknown) => mockLock,
        };

        async function processWebhook(webhookId: string, _payload: unknown) {
          return withScope(async (scope) => {
            const lock = scope.add({
              value: await mockRedis.lock(`webhook:${webhookId}`, { ttl: 30000 }),
              close: async () => {
                await lock.release();
              },
            });

            // Simulate processing failure - return error result instead of throwing
            return err("PROCESSING_FAILED" as const);
          });
        }

        const result = await processWebhook("webhook-123", {});

        expect(result.ok).toBe(false);
        // Lock should be released even on failure
        expect(releaseCalls).toContain("lock-released");
      });
    });
  });
});

// ============================================================================
// Export to avoid unused variable warnings
// ============================================================================

export {
  createDbConnection,
  createCache,
  createSession,
  processUser,
};
