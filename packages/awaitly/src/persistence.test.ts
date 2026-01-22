import { describe, it, expect, vi } from "vitest";
import {
  serializeCause,
  deserializeCause,
  serializeResult,
  deserializeResult,
  serializeMeta,
  deserializeMeta,
  serializeState,
  deserializeState,
  stringifyState,
  parseState,
  createMemoryCache,
  createFileCache,
  createKVCache,
  createStatePersistence,
  createHydratingCache,
} from "./persistence";
import { ok, err } from "./core";
import type { ResumeState } from "./workflow";
import type { StepFailureMeta } from "./core";

describe("Persistence", () => {
  describe("serializeCause / deserializeCause", () => {
    it("should serialize undefined cause", () => {
      const serialized = serializeCause(undefined);
      expect(serialized.type).toBe("undefined");

      const deserialized = deserializeCause(serialized);
      expect(deserialized).toBeUndefined();
    });

    it("should serialize Error objects", () => {
      const error = new Error("Something went wrong");
      error.name = "CustomError";

      const serialized = serializeCause(error);
      expect(serialized.type).toBe("error");
      expect(serialized.errorName).toBe("CustomError");
      expect(serialized.errorMessage).toBe("Something went wrong");
      expect(serialized.errorStack).toBeDefined();

      const deserialized = deserializeCause(serialized) as Error;
      expect(deserialized).toBeInstanceOf(Error);
      expect(deserialized.name).toBe("CustomError");
      expect(deserialized.message).toBe("Something went wrong");
    });

    it("should serialize primitive values", () => {
      const serialized = serializeCause("simple error");
      expect(serialized.type).toBe("value");
      expect(serialized.value).toBe("simple error");

      const deserialized = deserializeCause(serialized);
      expect(deserialized).toBe("simple error");
    });

    it("should serialize objects", () => {
      const cause = { code: "NOT_FOUND", id: "123" };

      const serialized = serializeCause(cause);
      expect(serialized.type).toBe("value");
      expect(serialized.value).toEqual(cause);

      const deserialized = deserializeCause(serialized);
      expect(deserialized).toEqual(cause);
    });

    it("should handle non-serializable values", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      const serialized = serializeCause(circular);
      expect(serialized.type).toBe("value");
      // Should convert to string representation
      expect(typeof serialized.value).toBe("string");
    });
  });

  describe("serializeResult / deserializeResult", () => {
    it("should serialize ok result", () => {
      const result = ok({ id: "1", name: "Alice" });

      const serialized = serializeResult(result);
      expect(serialized.ok).toBe(true);
      expect(serialized.value).toEqual({ id: "1", name: "Alice" });
      expect(serialized.error).toBeUndefined();

      const deserialized = deserializeResult(serialized);
      expect(deserialized.ok).toBe(true);
      if (deserialized.ok) {
        expect(deserialized.value).toEqual({ id: "1", name: "Alice" });
      }
    });

    it("should serialize err result without cause", () => {
      const result = err({ code: "NOT_FOUND", userId: "123" });

      const serialized = serializeResult(result);
      expect(serialized.ok).toBe(false);
      expect(serialized.error).toEqual({ code: "NOT_FOUND", userId: "123" });
      expect(serialized.cause).toBeUndefined();

      const deserialized = deserializeResult(serialized);
      expect(deserialized.ok).toBe(false);
      if (!deserialized.ok) {
        expect(deserialized.error).toEqual({ code: "NOT_FOUND", userId: "123" });
      }
    });

    it("should serialize err result with cause", () => {
      const cause = new Error("Database connection failed");
      const result = err({ code: "DB_ERROR" }, { cause });

      const serialized = serializeResult(result);
      expect(serialized.ok).toBe(false);
      expect(serialized.cause).toBeDefined();
      expect(serialized.cause?.type).toBe("error");

      const deserialized = deserializeResult(serialized);
      expect(deserialized.ok).toBe(false);
      if (!deserialized.ok) {
        expect(deserialized.cause).toBeInstanceOf(Error);
      }
    });
  });

  describe("serializeMeta / deserializeMeta", () => {
    it("should serialize result origin meta", () => {
      const meta: StepFailureMeta = {
        origin: "result",
        resultCause: new Error("Original error"),
      };

      const serialized = serializeMeta(meta);
      expect(serialized.origin).toBe("result");
      expect(serialized.resultCause).toBeDefined();
      expect(serialized.resultCause?.type).toBe("error");

      const deserialized = deserializeMeta(serialized);
      expect(deserialized.origin).toBe("result");
      expect(deserialized.resultCause).toBeInstanceOf(Error);
    });

    it("should serialize throw origin meta", () => {
      const meta: StepFailureMeta = {
        origin: "throw",
        thrown: new Error("Thrown error"),
      };

      const serialized = serializeMeta(meta);
      expect(serialized.origin).toBe("throw");
      expect(serialized.thrown).toBeDefined();
      expect(serialized.thrown?.type).toBe("error");

      const deserialized = deserializeMeta(serialized);
      expect(deserialized.origin).toBe("throw");
      expect(deserialized.thrown).toBeInstanceOf(Error);
    });

    it("should handle undefined result cause", () => {
      const meta: StepFailureMeta = {
        origin: "result",
        resultCause: undefined,
      };

      const serialized = serializeMeta(meta);
      expect(serialized.resultCause).toBeUndefined();

      const deserialized = deserializeMeta(serialized);
      expect(deserialized.resultCause).toBeUndefined();
    });
  });

  describe("serializeState / deserializeState", () => {
    it("should serialize ResumeState", () => {
      const state: ResumeState = {
        steps: new Map([
          ["user:1", { result: ok({ id: "1", name: "Alice" }) }],
          ["payment:1", { result: ok({ transactionId: "tx-123" }) }],
        ]),
      };

      const serialized = serializeState(state, { workflowId: "wf-1" });
      expect(serialized.version).toBe(1);
      expect(serialized.metadata).toEqual({ workflowId: "wf-1" });
      expect(serialized.entries["user:1"]).toBeDefined();
      expect(serialized.entries["payment:1"]).toBeDefined();

      const deserialized = deserializeState(serialized);
      expect(deserialized.steps.size).toBe(2);
      expect(deserialized.steps.get("user:1")?.result.ok).toBe(true);
    });

    it("should serialize state with error results", () => {
      const state: ResumeState = {
        steps: new Map([
          ["user:1", { result: err({ code: "NOT_FOUND" }) }],
        ]),
      };

      const serialized = serializeState(state);
      const deserialized = deserializeState(serialized);

      const entry = deserialized.steps.get("user:1");
      expect(entry?.result.ok).toBe(false);
      if (!entry?.result.ok) {
        expect(entry.result.error).toEqual({ code: "NOT_FOUND" });
      }
    });

    it("should serialize state with meta", () => {
      const state: ResumeState = {
        steps: new Map([
          [
            "user:1",
            {
              result: err({ code: "NOT_FOUND" }),
              meta: { origin: "throw", thrown: new Error("User fetch failed") },
            },
          ],
        ]),
      };

      const serialized = serializeState(state);
      const deserialized = deserializeState(serialized);

      const entry = deserialized.steps.get("user:1");
      expect(entry?.meta?.origin).toBe("throw");
      expect(entry?.meta?.thrown).toBeInstanceOf(Error);
    });
  });

  describe("stringifyState / parseState", () => {
    it("should round-trip state through JSON", () => {
      const state: ResumeState = {
        steps: new Map([
          ["user:1", { result: ok({ id: "1", name: "Alice" }) }],
          ["payment:1", { result: err({ code: "PAYMENT_FAILED" }) }],
        ]),
      };

      const json = stringifyState(state, { workflowId: "wf-1" });
      expect(typeof json).toBe("string");

      const parsed = parseState(json);
      expect(parsed.steps.size).toBe(2);

      const userEntry = parsed.steps.get("user:1");
      expect(userEntry?.result.ok).toBe(true);
      if (userEntry?.result.ok) {
        expect(userEntry.result.value).toEqual({ id: "1", name: "Alice" });
      }
    });
  });

  describe("createMemoryCache", () => {
    it("should create a basic cache", () => {
      const cache = createMemoryCache();

      expect(cache.get("key1")).toBeUndefined();
      expect(cache.has("key1")).toBe(false);

      cache.set("key1", ok("value1"));
      expect(cache.has("key1")).toBe(true);

      const result = cache.get("key1");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.value).toBe("value1");
      }
    });

    it("should support delete", () => {
      const cache = createMemoryCache();

      cache.set("key1", ok("value1"));
      expect(cache.has("key1")).toBe(true);

      const deleted = cache.delete("key1");
      expect(deleted).toBe(true);
      expect(cache.has("key1")).toBe(false);
    });

    it("should support clear", () => {
      const cache = createMemoryCache();

      cache.set("key1", ok("value1"));
      cache.set("key2", ok("value2"));

      cache.clear();

      expect(cache.has("key1")).toBe(false);
      expect(cache.has("key2")).toBe(false);
    });

    it("should support TTL expiration", () => {
      vi.useFakeTimers();

      const cache = createMemoryCache({ ttl: 1000 });

      cache.set("key1", ok("value1"));
      expect(cache.has("key1")).toBe(true);

      vi.advanceTimersByTime(500);
      expect(cache.has("key1")).toBe(true);

      vi.advanceTimersByTime(600);
      expect(cache.has("key1")).toBe(false);
      expect(cache.get("key1")).toBeUndefined();

      vi.useRealTimers();
    });

    it("should support maxSize with LRU eviction", () => {
      vi.useFakeTimers();

      const cache = createMemoryCache({ maxSize: 2 });

      cache.set("key1", ok("value1"));
      vi.advanceTimersByTime(10);
      cache.set("key2", ok("value2"));
      vi.advanceTimersByTime(10);

      // This should evict key1 (oldest)
      cache.set("key3", ok("value3"));

      expect(cache.has("key1")).toBe(false);
      expect(cache.has("key2")).toBe(true);
      expect(cache.has("key3")).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("createFileCache", () => {
    it("should require fs interface", () => {
      expect(() => createFileCache({ directory: "/tmp/cache" })).toThrow(
        "File system interface is required"
      );
    });

    it("should create a cache with fs interface", async () => {
      const mockFs = {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        unlink: vi.fn(),
        exists: vi.fn().mockResolvedValue(false),
        readdir: vi.fn().mockResolvedValue([]),
        mkdir: vi.fn().mockResolvedValue(undefined),
      };

      const cache = createFileCache({
        directory: "/tmp/cache",
        fs: mockFs,
      });

      await cache.init();
      expect(mockFs.mkdir).toHaveBeenCalledWith("/tmp/cache", { recursive: true });
    });

    it("should use memory cache for sync operations", () => {
      const mockFs = {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        unlink: vi.fn(),
        exists: vi.fn(),
        readdir: vi.fn(),
        mkdir: vi.fn(),
      };

      const cache = createFileCache({
        directory: "/tmp/cache",
        fs: mockFs,
      });

      // Sync operations use memory cache
      cache.set("key1", ok("value1"));
      expect(cache.has("key1")).toBe(true);

      const result = cache.get("key1");
      expect(result?.ok).toBe(true);
    });

    it("should support async operations", async () => {
      const mockFs = {
        readFile: vi.fn().mockResolvedValue(JSON.stringify({ ok: true, value: "stored" })),
        writeFile: vi.fn().mockResolvedValue(undefined),
        unlink: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
        readdir: vi.fn().mockResolvedValue(["key1.json"]),
        mkdir: vi.fn().mockResolvedValue(undefined),
      };

      const cache = createFileCache({
        directory: "/tmp/cache",
        fs: mockFs,
      });

      // Async get
      const result = await cache.getAsync("key1");
      expect(result?.ok).toBe(true);
      expect(mockFs.readFile).toHaveBeenCalled();

      // Async set
      await cache.setAsync("key2", ok("value2"));
      expect(mockFs.writeFile).toHaveBeenCalled();

      // Async delete
      await cache.deleteAsync("key1");
      expect(mockFs.unlink).toHaveBeenCalled();

      // Async clear
      await cache.clearAsync();
      expect(mockFs.readdir).toHaveBeenCalled();
    });

    it("should sanitize keys for file paths", async () => {
      const mockFs = {
        readFile: vi.fn(),
        writeFile: vi.fn().mockResolvedValue(undefined),
        unlink: vi.fn(),
        exists: vi.fn(),
        readdir: vi.fn(),
        mkdir: vi.fn(),
      };

      const cache = createFileCache({
        directory: "/tmp/cache",
        fs: mockFs,
      });

      await cache.setAsync("user:1/special", ok("value"));

      // The key should be sanitized
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/user_1_special\.json$/),
        expect.any(String)
      );
    });
  });

  describe("createKVCache", () => {
    it("should create a cache with KV store", () => {
      const mockStore = {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
        exists: vi.fn(),
        keys: vi.fn(),
      };

      const cache = createKVCache({
        store: mockStore,
        prefix: "myapp:",
      });

      expect(cache).toBeDefined();
    });

    it("should use memory cache for sync operations", () => {
      const mockStore = {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
        exists: vi.fn(),
        keys: vi.fn(),
      };

      const cache = createKVCache({ store: mockStore });

      cache.set("key1", ok("value1"));
      expect(cache.has("key1")).toBe(true);
      expect(cache.get("key1")?.ok).toBe(true);
    });

    it("should support async operations with prefix", async () => {
      const mockStore = {
        get: vi.fn().mockResolvedValue(JSON.stringify({ ok: true, value: "stored" })),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(true),
        exists: vi.fn().mockResolvedValue(true),
        keys: vi.fn().mockResolvedValue(["myapp:key1", "myapp:key2"]),
      };

      const cache = createKVCache({
        store: mockStore,
        prefix: "myapp:",
        ttl: 3600,
      });

      // Async get with prefix
      await cache.getAsync("key1");
      expect(mockStore.get).toHaveBeenCalledWith("myapp:key1");

      // Async set with TTL
      await cache.setAsync("key2", ok("value2"));
      expect(mockStore.set).toHaveBeenCalledWith(
        "myapp:key2",
        expect.any(String),
        { ttl: 3600 }
      );

      // Async exists
      const exists = await cache.hasAsync("key1");
      expect(exists).toBe(true);
      expect(mockStore.exists).toHaveBeenCalledWith("myapp:key1");

      // Async delete
      await cache.deleteAsync("key1");
      expect(mockStore.delete).toHaveBeenCalledWith("myapp:key1");

      // Async clear
      await cache.clearAsync();
      expect(mockStore.keys).toHaveBeenCalledWith("myapp:*");
    });
  });

  describe("createStatePersistence", () => {
    it("should save and load state", async () => {
      const storage = new Map<string, string>();
      const mockStore = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key) ?? null)),
        set: vi.fn((key: string, value: string) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        delete: vi.fn((key: string) => {
          const existed = storage.has(key);
          storage.delete(key);
          return Promise.resolve(existed);
        }),
        exists: vi.fn((key: string) => Promise.resolve(storage.has(key))),
        keys: vi.fn((pattern: string) => {
          const prefix = pattern.replace("*", "");
          return Promise.resolve(
            Array.from(storage.keys()).filter((k) => k.startsWith(prefix))
          );
        }),
      };

      const persistence = createStatePersistence(mockStore, "workflow:state:");

      const state: ResumeState = {
        steps: new Map([
          ["user:1", { result: ok({ id: "1" }) }],
        ]),
      };

      await persistence.save("run-1", state, { workflowId: "wf-1" });

      const loaded = await persistence.load("run-1");
      expect(loaded).toBeDefined();
      expect(loaded?.steps.size).toBe(1);
      expect(loaded?.steps.get("user:1")?.result.ok).toBe(true);
    });

    it("should return undefined for non-existent state", async () => {
      const mockStore = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
        delete: vi.fn(),
        exists: vi.fn(),
        keys: vi.fn(),
      };

      const persistence = createStatePersistence(mockStore);
      const loaded = await persistence.load("non-existent");
      expect(loaded).toBeUndefined();
    });

    it("should delete state", async () => {
      const mockStore = {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn().mockResolvedValue(true),
        exists: vi.fn(),
        keys: vi.fn(),
      };

      const persistence = createStatePersistence(mockStore);
      const deleted = await persistence.delete("run-1");
      expect(deleted).toBe(true);
    });

    it("should list saved workflow IDs", async () => {
      const mockStore = {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
        exists: vi.fn(),
        keys: vi.fn().mockResolvedValue([
          "workflow:state:run-1",
          "workflow:state:run-2",
        ]),
      };

      const persistence = createStatePersistence(mockStore);
      const ids = await persistence.list();
      expect(ids).toEqual(["run-1", "run-2"]);
    });
  });

  describe("createHydratingCache", () => {
    it("should hydrate from persistence on first access", async () => {
      const memoryCache = createMemoryCache();

      const state: ResumeState = {
        steps: new Map([
          ["user:1", { result: ok({ id: "1", name: "Alice" }) }],
        ]),
      };

      const mockPersistence = {
        save: vi.fn(),
        load: vi.fn().mockResolvedValue(state),
        delete: vi.fn(),
        list: vi.fn(),
      };

      const cache = createHydratingCache(memoryCache, mockPersistence, "run-1");

      // Before hydration
      expect(cache.has("user:1")).toBe(false);

      // Hydrate
      await cache.hydrate();

      // After hydration
      expect(cache.has("user:1")).toBe(true);
      const result = cache.get("user:1");
      expect(result?.ok).toBe(true);
    });

    it("should only hydrate once", async () => {
      const memoryCache = createMemoryCache();

      const mockPersistence = {
        save: vi.fn(),
        load: vi.fn().mockResolvedValue({ steps: new Map() }),
        delete: vi.fn(),
        list: vi.fn(),
      };

      const cache = createHydratingCache(memoryCache, mockPersistence, "run-1");

      await cache.hydrate();
      await cache.hydrate();

      expect(mockPersistence.load).toHaveBeenCalledTimes(1);
    });

    it("should handle missing persisted state", async () => {
      const memoryCache = createMemoryCache();

      const mockPersistence = {
        save: vi.fn(),
        load: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(),
        list: vi.fn(),
      };

      const cache = createHydratingCache(memoryCache, mockPersistence, "run-1");

      await cache.hydrate();

      // Should not throw, cache should be empty
      expect(cache.has("user:1")).toBe(false);
    });

    it("should delegate operations to memory cache", () => {
      const memoryCache = createMemoryCache();

      const mockPersistence = {
        save: vi.fn(),
        load: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      };

      const cache = createHydratingCache(memoryCache, mockPersistence, "run-1");

      cache.set("key1", ok("value1"));
      expect(cache.get("key1")?.ok).toBe(true);

      cache.delete("key1");
      expect(cache.has("key1")).toBe(false);

      cache.set("key2", ok("value2"));
      cache.clear();
      expect(cache.has("key2")).toBe(false);
    });
  });
});
