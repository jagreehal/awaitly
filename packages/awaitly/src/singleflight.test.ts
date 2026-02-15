/**
 * Tests for singleflight.ts - Request coalescing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ok, err, type AsyncResult } from "./core";
import { singleflight, createSingleflightGroup } from "./singleflight";

// =============================================================================
// singleflight() wrapper tests
// =============================================================================

describe("singleflight()", () => {
  const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
    await new Promise((resolve) => setTimeout(resolve, 10)); // Simulate async
    return id !== "0" ? ok({ id, name: `User ${id}` }) : err("NOT_FOUND");
  };

  it("executes operation and returns result", async () => {
    const fetchUserOnce = singleflight(fetchUser, {
      key: (id) => `user:${id}`,
    });

    const result = await fetchUserOnce("1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ id: "1", name: "User 1" });
    }
  });

  it("returns error results correctly", async () => {
    const fetchUserOnce = singleflight(fetchUser, {
      key: (id) => `user:${id}`,
    });

    const result = await fetchUserOnce("0");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("NOT_FOUND");
    }
  });

  it("deduplicates concurrent calls with same key", async () => {
    let callCount = 0;
    const trackedFetch = async (id: string): AsyncResult<{ id: string }, "NOT_FOUND"> => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return ok({ id });
    };

    const fetchOnce = singleflight(trackedFetch, {
      key: (id) => `user:${id}`,
    });

    // Start 3 concurrent calls with same key
    const [a, b, c] = await Promise.all([
      fetchOnce("1"),
      fetchOnce("1"),
      fetchOnce("1"),
    ]);

    // Should only call the operation once
    expect(callCount).toBe(1);

    // All should get the same result
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(a.value).toEqual(b.value);
      expect(b.value).toEqual(c.value);
    }
  });

  it("allows separate calls with different keys", async () => {
    let callCount = 0;
    const trackedFetch = async (id: string): AsyncResult<{ id: string }, "NOT_FOUND"> => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return ok({ id });
    };

    const fetchOnce = singleflight(trackedFetch, {
      key: (id) => `user:${id}`,
    });

    // Start concurrent calls with different keys
    const [a, b] = await Promise.all([
      fetchOnce("1"),
      fetchOnce("2"),
    ]);

    // Should call operation twice (different keys)
    expect(callCount).toBe(2);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.id).toBe("1");
      expect(b.value.id).toBe("2");
    }
  });

  it("allows new call after previous completes", async () => {
    let callCount = 0;
    const trackedFetch = async (id: string): AsyncResult<{ id: string; count: number }, "NOT_FOUND"> => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return ok({ id, count: callCount });
    };

    const fetchOnce = singleflight(trackedFetch, {
      key: (id) => `user:${id}`,
    });

    // First call
    const result1 = await fetchOnce("1");
    expect(result1.ok).toBe(true);
    if (result1.ok) {
      expect(result1.value.count).toBe(1);
    }

    // Second call (after first completes) - should make new request
    const result2 = await fetchOnce("1");
    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.value.count).toBe(2);
    }

    expect(callCount).toBe(2);
  });

  it("shares error results across concurrent callers", async () => {
    let callCount = 0;
    const failingFetch = async (): AsyncResult<{ id: string }, "FAIL"> => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return err("FAIL");
    };

    const fetchOnce = singleflight(failingFetch, {
      key: () => "always-same",
    });

    const [a, b] = await Promise.all([
      fetchOnce(),
      fetchOnce(),
    ]);

    expect(callCount).toBe(1);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok && !b.ok) {
      expect(a.error).toBe("FAIL");
      expect(b.error).toBe("FAIL");
    }
  });

  describe("with TTL caching", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("caches successful results for TTL duration", async () => {
      let callCount = 0;
      const trackedFetch = async (id: string): AsyncResult<{ id: string; count: number }, "NOT_FOUND"> => {
        callCount++;
        return ok({ id, count: callCount });
      };

      const fetchOnce = singleflight(trackedFetch, {
        key: (id) => `user:${id}`,
        ttl: 5000, // 5 seconds
      });

      // First call
      const result1 = await fetchOnce("1");
      expect(result1.ok).toBe(true);
      if (result1.ok) {
        expect(result1.value.count).toBe(1);
      }

      // Second call within TTL - should return cached
      vi.advanceTimersByTime(3000); // 3 seconds
      const result2 = await fetchOnce("1");
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.value.count).toBe(1); // Same as first
      }
      expect(callCount).toBe(1);

      // Third call after TTL expires
      vi.advanceTimersByTime(3000); // Total 6 seconds
      const result3 = await fetchOnce("1");
      expect(result3.ok).toBe(true);
      if (result3.ok) {
        expect(result3.value.count).toBe(2); // New request
      }
      expect(callCount).toBe(2);
    });

    it("does not cache error results", async () => {
      let callCount = 0;
      const failingFetch = async (): AsyncResult<{ id: string }, "FAIL"> => {
        callCount++;
        return err("FAIL");
      };

      const fetchOnce = singleflight(failingFetch, {
        key: () => "key",
        ttl: 5000,
      });

      const result1 = await fetchOnce();
      expect(result1.ok).toBe(false);
      expect(callCount).toBe(1);

      // Should make new request (error not cached)
      const result2 = await fetchOnce();
      expect(result2.ok).toBe(false);
      expect(callCount).toBe(2);
    });
  });

  it("handles multiple arguments for key extraction", async () => {
    const fetchPage = async (userId: string, page: number): AsyncResult<{ userId: string; page: number }, "NOT_FOUND"> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return ok({ userId, page });
    };

    let callCount = 0;
    const trackedFetch = async (userId: string, page: number): AsyncResult<{ userId: string; page: number }, "NOT_FOUND"> => {
      callCount++;
      return fetchPage(userId, page);
    };

    const fetchOnce = singleflight(trackedFetch, {
      key: (userId, page) => `${userId}:${page}`,
    });

    const [a, b, c] = await Promise.all([
      fetchOnce("user1", 1),
      fetchOnce("user1", 1), // Same key
      fetchOnce("user1", 2), // Different key (different page)
    ]);

    expect(callCount).toBe(2); // Two unique keys
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(c.ok).toBe(true);
  });
});

// =============================================================================
// createSingleflightGroup() tests
// =============================================================================

describe("createSingleflightGroup()", () => {
  it("executes operation and returns result", async () => {
    const group = createSingleflightGroup<{ id: string }, "NOT_FOUND">();

    const result = await group.execute("user:1", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return ok({ id: "1" });
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ id: "1" });
    }
  });

  it("deduplicates concurrent calls", async () => {
    const group = createSingleflightGroup<{ id: string }, "NOT_FOUND">();
    let callCount = 0;

    const operation = async () => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return ok({ id: "1" });
    };

    const [a, b] = await Promise.all([
      group.execute("key", operation),
      group.execute("key", operation),
    ]);

    expect(callCount).toBe(1);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it("tracks in-flight status correctly", async () => {
    const group = createSingleflightGroup<{ id: string }, "NOT_FOUND">();
    let resolveOp: () => void;

    const operation = async () => {
      await new Promise<void>((resolve) => {
        resolveOp = resolve;
      });
      return ok({ id: "1" });
    };

    // Not in-flight before call
    expect(group.isInflight("key")).toBe(false);

    // Start operation
    const promise = group.execute("key", operation);

    // In-flight during execution
    expect(group.isInflight("key")).toBe(true);
    expect(group.size()).toBe(1);

    // Complete operation
    resolveOp!();
    await promise;

    // Not in-flight after completion
    expect(group.isInflight("key")).toBe(false);
    expect(group.size()).toBe(0);
  });

  it("clear() removes all tracking", async () => {
    const group = createSingleflightGroup<{ id: string }, "NOT_FOUND">();

    // Start multiple operations
    const op1 = group.execute("key1", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return ok({ id: "1" });
    });
    const op2 = group.execute("key2", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return ok({ id: "2" });
    });

    expect(group.size()).toBe(2);

    // Clear tracking
    group.clear();

    expect(group.size()).toBe(0);
    expect(group.isInflight("key1")).toBe(false);
    expect(group.isInflight("key2")).toBe(false);

    // Operations still complete (clear doesn't cancel)
    const [r1, r2] = await Promise.all([op1, op2]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it("clears in-flight tracking when operation throws", async () => {
    const group = createSingleflightGroup<{ id: string }, "NOT_FOUND">();

    // Operation that throws
    const throwingOperation = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("Unexpected failure");
    };

    // Start operation
    expect(group.isInflight("key")).toBe(false);
    const promise = group.execute("key", throwingOperation);
    expect(group.isInflight("key")).toBe(true);

    // Wait for rejection
    await expect(promise).rejects.toThrow("Unexpected failure");

    // In-flight tracking should be cleared after rejection
    expect(group.isInflight("key")).toBe(false);
    expect(group.size()).toBe(0);
  });

  it("allows new request after previous one threw", async () => {
    const group = createSingleflightGroup<{ id: string }, "NOT_FOUND">();
    let callCount = 0;

    const operation = async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("First call fails");
      }
      return ok({ id: "1" });
    };

    // First call throws
    const promise1 = group.execute("key", operation);
    await expect(promise1).rejects.toThrow("First call fails");
    expect(group.isInflight("key")).toBe(false);

    // Second call should work (not stuck)
    const result2 = await group.execute("key", operation);
    expect(result2.ok).toBe(true);
    expect(callCount).toBe(2);
  });
});

// =============================================================================
// singleflight() throw/rejection tests
// =============================================================================

describe("singleflight() throw handling", () => {
  it("clears in-flight tracking when operation throws", async () => {
    let callCount = 0;
    const throwingFetch = async (id: string): Promise<never> => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error(`Failed for ${id}`);
    };

    const fetchOnce = singleflight(throwingFetch as unknown as (id: string) => AsyncResult<never, never>, {
      key: (id: string) => `user:${id}`,
    });

    // First call throws
    await expect(fetchOnce("1")).rejects.toThrow("Failed for 1");

    // Second call should work (not stuck)
    await expect(fetchOnce("1")).rejects.toThrow("Failed for 1");

    // Both calls should have been made (in-flight was cleared after first rejection)
    expect(callCount).toBe(2);
  });

  it("concurrent callers all receive the rejection", async () => {
    let callCount = 0;
    const throwingFetch = async (): Promise<never> => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error("Operation failed");
    };

    const fetchOnce = singleflight(throwingFetch as () => AsyncResult<never, never>, {
      key: () => "key",
    });

    // Start multiple concurrent calls
    const promises = [fetchOnce(), fetchOnce(), fetchOnce()];

    // All should reject with the same error
    await expect(Promise.all(promises)).rejects.toThrow("Operation failed");

    // Only one call was made (deduplication worked)
    expect(callCount).toBe(1);
  });
});
