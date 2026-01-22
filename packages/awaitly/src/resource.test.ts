import { describe, it, expect, vi } from "vitest";
import {
  createResourceScope,
  withScope,
  createResource,
  isResourceCleanupError,
  type Resource,
  type ResourceCleanupError,
} from "./resource";
import { ok, err } from "./core";

describe("Resource Management", () => {
  describe("createResourceScope", () => {
    it("should track added resources", () => {
      const scope = createResourceScope();
      const resource: Resource<string> = {
        value: "test",
        close: vi.fn(),
      };

      const value = scope.add(resource);

      expect(value).toBe("test");
      expect(scope.has(resource)).toBe(true);
      expect(scope.size()).toBe(1);
    });

    it("should close resources in LIFO order", async () => {
      const scope = createResourceScope();
      const closeOrder: string[] = [];

      const resource1: Resource<string> = {
        value: "first",
        close: async () => {
          closeOrder.push("first");
        },
      };

      const resource2: Resource<string> = {
        value: "second",
        close: async () => {
          closeOrder.push("second");
        },
      };

      const resource3: Resource<string> = {
        value: "third",
        close: async () => {
          closeOrder.push("third");
        },
      };

      scope.add(resource1);
      scope.add(resource2);
      scope.add(resource3);

      await scope.close();

      // LIFO: third -> second -> first
      expect(closeOrder).toEqual(["third", "second", "first"]);
    });

    it("should clear resources after closing", async () => {
      const scope = createResourceScope();
      const resource: Resource<string> = {
        value: "test",
        close: vi.fn(),
      };

      scope.add(resource);
      expect(scope.size()).toBe(1);

      await scope.close();
      expect(scope.size()).toBe(0);
    });

    it("should continue closing other resources if one fails", async () => {
      const scope = createResourceScope();
      const closeOrder: string[] = [];

      const resource1: Resource<string> = {
        value: "first",
        close: async () => {
          closeOrder.push("first");
        },
      };

      const resource2: Resource<string> = {
        value: "second",
        close: async () => {
          closeOrder.push("second-start");
          throw new Error("Close failed");
        },
      };

      const resource3: Resource<string> = {
        value: "third",
        close: async () => {
          closeOrder.push("third");
        },
      };

      scope.add(resource1);
      scope.add(resource2);
      scope.add(resource3);

      await expect(scope.close()).rejects.toMatchObject({
        type: "RESOURCE_CLEANUP_ERROR",
      });

      // All resources should be attempted to close
      expect(closeOrder).toEqual(["third", "second-start", "first"]);
    });

    it("should collect all cleanup errors", async () => {
      const scope = createResourceScope();

      scope.add({
        value: "first",
        close: async () => {
          throw new Error("Error 1");
        },
      });

      scope.add({
        value: "second",
        close: async () => {
          throw new Error("Error 2");
        },
      });

      try {
        await scope.close();
        expect.fail("Should have thrown");
      } catch (error) {
        expect(isResourceCleanupError(error)).toBe(true);
        const cleanupError = error as ResourceCleanupError;
        expect(cleanupError.errors.length).toBe(2);
      }
    });
  });

  describe("withScope", () => {
    it("should cleanup resources on success", async () => {
      const closeFn = vi.fn();

      const result = await withScope(async (scope) => {
        scope.add({
          value: "test",
          close: closeFn,
        });

        return ok("success");
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("success");
      }
      expect(closeFn).toHaveBeenCalledTimes(1);
    });

    it("should cleanup resources on error result", async () => {
      const closeFn = vi.fn();

      const result = await withScope(async (scope) => {
        scope.add({
          value: "test",
          close: closeFn,
        });

        return err("SOME_ERROR" as const);
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("SOME_ERROR");
      }
      expect(closeFn).toHaveBeenCalledTimes(1);
    });

    it("should cleanup resources on exception", async () => {
      const closeFn = vi.fn();

      await expect(
        withScope(async (scope) => {
          scope.add({
            value: "test",
            close: closeFn,
          });

          throw new Error("Unexpected error");
        })
      ).rejects.toThrow("Unexpected error");

      expect(closeFn).toHaveBeenCalledTimes(1);
    });

    it("should return cleanup error if cleanup fails", async () => {
      const result = await withScope(async (scope) => {
        scope.add({
          value: "test",
          close: async () => {
            throw new Error("Cleanup failed");
          },
        });

        return ok("success");
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isResourceCleanupError(result.error)).toBe(true);
        const cleanupError = result.error as ResourceCleanupError;
        expect(cleanupError.errors.length).toBe(1);
        expect(cleanupError.originalResult).toEqual({ ok: true, value: "success" });
      }
    });

    it("should handle nested scopes", async () => {
      const closeOrder: string[] = [];

      const result = await withScope(async (outerScope) => {
        outerScope.add({
          value: "outer",
          close: async () => {
            closeOrder.push("outer");
          },
        });

        const innerResult = await withScope(async (innerScope) => {
          innerScope.add({
            value: "inner",
            close: async () => {
              closeOrder.push("inner");
            },
          });

          return ok("inner-success");
        });

        return innerResult;
      });

      expect(result.ok).toBe(true);
      // Inner scope closes first (when inner withScope completes)
      // Then outer scope closes (when outer withScope completes)
      expect(closeOrder).toEqual(["inner", "outer"]);
    });
  });

  describe("createResource", () => {
    it("should create a resource from acquire/release functions", async () => {
      const releaseFn = vi.fn();

      const resource = await createResource(
        () => ({ id: "test-resource" }),
        releaseFn
      );

      expect(resource.value).toEqual({ id: "test-resource" });

      await resource.close();
      expect(releaseFn).toHaveBeenCalledWith({ id: "test-resource" });
    });

    it("should work with async acquire", async () => {
      const resource = await createResource(
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          return "async-value";
        },
        vi.fn()
      );

      expect(resource.value).toBe("async-value");
    });

    it("should work with async release", async () => {
      let released = false;

      const resource = await createResource(
        () => "value",
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          released = true;
        }
      );

      await resource.close();
      expect(released).toBe(true);
    });
  });

  describe("isResourceCleanupError", () => {
    it("should return true for ResourceCleanupError", () => {
      const error: ResourceCleanupError = {
        type: "RESOURCE_CLEANUP_ERROR",
        errors: [new Error("test")],
      };
      expect(isResourceCleanupError(error)).toBe(true);
    });

    it("should return false for other errors", () => {
      expect(isResourceCleanupError(null)).toBe(false);
      expect(isResourceCleanupError(undefined)).toBe(false);
      expect(isResourceCleanupError("error")).toBe(false);
      expect(isResourceCleanupError({ type: "OTHER_ERROR" })).toBe(false);
    });
  });

  describe("real-world usage patterns", () => {
    it("should work like pdf-brain database lifecycle pattern", async () => {
      // Simulate the pdf-brain database lifecycle pattern:
      // - Open database connection
      // - Use it for operations
      // - Automatically close on scope exit

      interface MockDbClient {
        query: (sql: string) => Promise<unknown[]>;
        closed: boolean;
      }

      const createDbClient = (): MockDbClient => ({
        query: async (sql: string) => [{ sql, result: "data" }],
        closed: false,
      });

      const result = await withScope(async (scope) => {
        // Create and register database client
        const db = scope.add(
          await createResource(
            () => createDbClient(),
            (client) => {
              client.closed = true;
            }
          )
        );

        // Verify connection is open
        expect(db.closed).toBe(false);

        // Perform operations
        const users = await db.query("SELECT * FROM users");

        return ok(users);
      });

      expect(result.ok).toBe(true);
      // The db.closed would be true at this point if we could access it
    });

    it("should work with multiple dependent resources", async () => {
      const events: string[] = [];

      interface MockDb {
        name: string;
        close: () => void;
      }

      interface MockCache {
        db: MockDb;
        close: () => void;
      }

      const result = await withScope(async (scope) => {
        // First resource: database
        const db = scope.add(
          await createResource<MockDb>(
            () => {
              events.push("db:open");
              return { name: "db", close: () => events.push("db:close") };
            },
            (d) => d.close()
          )
        );

        // Second resource: cache (depends on db)
        const cache = scope.add(
          await createResource<MockCache>(
            () => {
              events.push("cache:open");
              return { db, close: () => events.push("cache:close") };
            },
            (c) => c.close()
          )
        );

        events.push("using-resources");
        expect(cache.db.name).toBe("db");

        return ok("done");
      });

      expect(result.ok).toBe(true);
      // Resources should be opened in order, used, then closed in reverse order
      expect(events).toEqual([
        "db:open",
        "cache:open",
        "using-resources",
        "cache:close",
        "db:close",
      ]);
    });
  });
});
