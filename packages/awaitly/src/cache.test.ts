/**
 * Tests for cache.ts - Caching utilities
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cached,
  cachedWithTTL,
  cachedFunction,
  once,
  createCache,
} from "./cache";

describe("Caching Utilities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("cached()", () => {
    it("should compute value once and cache it", async () => {
      let callCount = 0;
      const compute = cached(async () => {
        callCount++;
        return "result";
      });

      const result1 = await compute();
      const result2 = await compute();
      const result3 = await compute();

      expect(result1).toBe("result");
      expect(result2).toBe("result");
      expect(result3).toBe("result");
      expect(callCount).toBe(1);
    });

    it("should handle sync functions", async () => {
      let callCount = 0;
      const compute = cached(() => {
        callCount++;
        return 42;
      });

      const result1 = await compute();
      const result2 = await compute();

      expect(result1).toBe(42);
      expect(result2).toBe(42);
      expect(callCount).toBe(1);
    });

    it("should handle concurrent calls during computation", async () => {
      let callCount = 0;
      const compute = cached(async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "result";
      });

      // Start multiple concurrent calls
      const promise1 = compute();
      const promise2 = compute();
      const promise3 = compute();

      // Advance time to complete computation
      await vi.advanceTimersByTimeAsync(100);

      const [result1, result2, result3] = await Promise.all([
        promise1,
        promise2,
        promise3,
      ]);

      expect(result1).toBe("result");
      expect(result2).toBe("result");
      expect(result3).toBe("result");
      expect(callCount).toBe(1); // Only one call despite concurrent requests
    });
  });

  describe("cachedWithTTL()", () => {
    it("should cache value until TTL expires", async () => {
      let callCount = 0;
      const compute = cachedWithTTL(
        async () => {
          callCount++;
          return `result-${callCount}`;
        },
        { ttl: "5s" }
      );

      const result1 = await compute();
      expect(result1).toBe("result-1");
      expect(callCount).toBe(1);

      // Still within TTL
      vi.advanceTimersByTime(4000);
      const result2 = await compute();
      expect(result2).toBe("result-1"); // Cached
      expect(callCount).toBe(1);

      // After TTL expires
      vi.advanceTimersByTime(2000); // Now at 6s total
      const result3 = await compute();
      expect(result3).toBe("result-2"); // Recomputed
      expect(callCount).toBe(2);
    });

    it("should accept Duration objects", async () => {
      let callCount = 0;
      const compute = cachedWithTTL(
        async () => {
          callCount++;
          return "result";
        },
        { ttl: { _tag: "Duration", millis: 1000 } }
      );

      await compute();
      expect(callCount).toBe(1);

      vi.advanceTimersByTime(500);
      await compute();
      expect(callCount).toBe(1); // Still cached

      vi.advanceTimersByTime(600);
      await compute();
      expect(callCount).toBe(2); // Expired
    });

    it("should handle concurrent calls during recomputation", async () => {
      let callCount = 0;
      const compute = cachedWithTTL(
        () => {
          callCount++;
          return `result-${callCount}`;
        },
        { ttl: "1s" }
      );

      // First computation
      await compute();
      expect(callCount).toBe(1);

      // Expire the cache
      vi.advanceTimersByTime(1100);

      // Concurrent calls during recomputation (sync fn, so both should return same)
      const result1 = await compute();
      const result2 = await compute();

      expect(result1).toBe("result-2");
      expect(result2).toBe("result-2");
      expect(callCount).toBe(2); // First call recomputes, second gets cached
    });
  });

  describe("cachedFunction()", () => {
    it("should memoize by arguments", async () => {
      let callCount = 0;
      const fetchUser = cachedFunction(async (id: string) => {
        callCount++;
        return { id, name: `User ${id}` };
      });

      const user1a = await fetchUser("1");
      const user2 = await fetchUser("2");
      const user1b = await fetchUser("1"); // Cached!

      expect(user1a).toEqual({ id: "1", name: "User 1" });
      expect(user2).toEqual({ id: "2", name: "User 2" });
      expect(user1b).toEqual({ id: "1", name: "User 1" });
      expect(callCount).toBe(2); // Only 2 calls, not 3
    });

    it("should support custom key function", async () => {
      let callCount = 0;
      const fetchData = cachedFunction(
        async (opts: { userId: string; includeDeleted?: boolean }) => {
          callCount++;
          return { userId: opts.userId };
        },
        {
          keyFn: (opts) => opts.userId, // Only key by userId
        }
      );

      await fetchData({ userId: "1", includeDeleted: true });
      await fetchData({ userId: "1", includeDeleted: false }); // Same key!

      expect(callCount).toBe(1);
    });

    it("should support TTL", async () => {
      let callCount = 0;
      const fetchUser = cachedFunction(
        async (id: string) => {
          callCount++;
          return { id };
        },
        { ttl: "1s" }
      );

      await fetchUser("1");
      expect(callCount).toBe(1);

      vi.advanceTimersByTime(500);
      await fetchUser("1");
      expect(callCount).toBe(1); // Still cached

      vi.advanceTimersByTime(600);
      await fetchUser("1");
      expect(callCount).toBe(2); // Expired
    });

    it("should support maxSize with LRU eviction", async () => {
      const fetchUser = cachedFunction(
        async (id: string) => ({ id }),
        { maxSize: 2 }
      );

      await fetchUser("1");
      await fetchUser("2");
      await fetchUser("3"); // Should evict "1"

      expect(fetchUser.has("1")).toBe(false);
      expect(fetchUser.has("2")).toBe(true);
      expect(fetchUser.has("3")).toBe(true);
    });

    it("should provide cache control methods", async () => {
      const fetchUser = cachedFunction(async (id: string) => ({ id }));

      await fetchUser("1");
      await fetchUser("2");

      expect(fetchUser.has("1")).toBe(true);
      expect(fetchUser.has("2")).toBe(true);
      expect(fetchUser.has("3")).toBe(false);

      fetchUser.delete("1");
      expect(fetchUser.has("1")).toBe(false);

      fetchUser.clear();
      expect(fetchUser.has("2")).toBe(false);
    });

    it("should track statistics", async () => {
      const fetchUser = cachedFunction(async (id: string) => ({ id }));

      await fetchUser("1"); // Miss
      await fetchUser("2"); // Miss
      await fetchUser("1"); // Hit
      await fetchUser("1"); // Hit

      const stats = fetchUser.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.size).toBe(2);
    });

    it("should handle concurrent calls with same args", async () => {
      let callCount = 0;
      const fetchUser = cachedFunction(async (id: string) => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { id };
      });

      const promise1 = fetchUser("1");
      const promise2 = fetchUser("1");
      const promise3 = fetchUser("1");

      await vi.advanceTimersByTimeAsync(100);

      const [r1, r2, r3] = await Promise.all([promise1, promise2, promise3]);

      expect(r1).toEqual({ id: "1" });
      expect(r2).toEqual({ id: "1" });
      expect(r3).toEqual({ id: "1" });
      expect(callCount).toBe(1);
    });
  });

  describe("once()", () => {
    it("should execute function exactly once", async () => {
      let callCount = 0;
      const init = once(async () => {
        callCount++;
        return "initialized";
      });

      const result1 = await init();
      const result2 = await init();
      const result3 = await init();

      expect(result1).toBe("initialized");
      expect(result2).toBe("initialized");
      expect(result3).toBe("initialized");
      expect(callCount).toBe(1);
    });

    it("should provide status properties", async () => {
      const init = once(async () => "done");

      expect(init.called).toBe(false);
      expect(init.completed).toBe(false);
      expect(init.failed).toBe(false);

      await init();

      expect(init.called).toBe(true);
      expect(init.completed).toBe(true);
      expect(init.failed).toBe(false);
    });

    it("should handle errors consistently", async () => {
      let callCount = 0;
      const init = once(async () => {
        callCount++;
        throw new Error("init failed");
      });

      await expect(init()).rejects.toThrow("init failed");
      await expect(init()).rejects.toThrow("init failed");

      expect(callCount).toBe(1);
      expect(init.failed).toBe(true);
      expect(init.completed).toBe(false);
    });

    it("should support reset", async () => {
      let callCount = 0;
      const init = once(async () => {
        callCount++;
        return `call-${callCount}`;
      });

      const result1 = await init();
      expect(result1).toBe("call-1");

      init.reset();
      expect(init.called).toBe(false);

      const result2 = await init();
      expect(result2).toBe("call-2");
      expect(callCount).toBe(2);
    });

    it("should handle concurrent calls during execution", async () => {
      let callCount = 0;
      const init = once(async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "done";
      });

      const promise1 = init();
      const promise2 = init();
      const promise3 = init();

      await vi.advanceTimersByTimeAsync(100);

      const [r1, r2, r3] = await Promise.all([promise1, promise2, promise3]);

      expect(r1).toBe("done");
      expect(r2).toBe("done");
      expect(r3).toBe("done");
      expect(callCount).toBe(1);
    });
  });

  describe("createCache()", () => {
    it("should store and retrieve values", () => {
      const cache = createCache<string, number>();

      cache.set("key1", 42);
      cache.set("key2", 100);

      expect(cache.get("key1")).toBe(42);
      expect(cache.get("key2")).toBe(100);
      expect(cache.get("key3")).toBeUndefined();
    });

    it("should respect default TTL", () => {
      const cache = createCache<string, number>({ defaultTTL: "1s" });

      cache.set("key", 42);
      expect(cache.get("key")).toBe(42);

      vi.advanceTimersByTime(500);
      expect(cache.get("key")).toBe(42);

      vi.advanceTimersByTime(600);
      expect(cache.get("key")).toBeUndefined();
    });

    it("should allow per-entry TTL override", () => {
      const cache = createCache<string, number>({ defaultTTL: "1s" });

      cache.set("short", 1);
      cache.set("long", 2, { ttl: "5s" });

      vi.advanceTimersByTime(1500);

      expect(cache.get("short")).toBeUndefined(); // Expired
      expect(cache.get("long")).toBe(2); // Still valid
    });

    it("should respect maxSize", () => {
      const cache = createCache<string, number>({ maxSize: 2 });

      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3); // Should evict oldest

      expect(cache.size).toBe(2);
      expect(cache.has("a")).toBe(false);
      expect(cache.has("b")).toBe(true);
      expect(cache.has("c")).toBe(true);
    });

    it("should support has() and delete()", () => {
      const cache = createCache<string, number>();

      cache.set("key", 42);
      expect(cache.has("key")).toBe(true);
      expect(cache.has("other")).toBe(false);

      cache.delete("key");
      expect(cache.has("key")).toBe(false);
    });

    it("should support clear()", () => {
      const cache = createCache<string, number>();

      cache.set("a", 1);
      cache.set("b", 2);
      cache.clear();

      expect(cache.size).toBe(0);
    });

    it("should track statistics", () => {
      const cache = createCache<string, number>();

      cache.set("a", 1);
      cache.get("a"); // Hit
      cache.get("a"); // Hit
      cache.get("b"); // Miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(1);
    });
  });
});
