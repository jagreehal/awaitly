import { describe, it, expect, vi } from "vitest";
import { ok, err, type AsyncResult, isOk, isErr } from "./core";
import { createResolver } from "./resolver";

interface User {
  id: number;
  name: string;
}

const makeUsers = (...ids: number[]): User[] =>
  ids.map((id) => ({ id, name: `User-${id}` }));

describe("createResolver", () => {
  it("batching: two loads in same tick → batchFn called once with both keys", async () => {
    const batchFn = vi.fn(
      async (keys: number[]): AsyncResult<User[], "QUERY_ERROR"> =>
        ok(makeUsers(...keys))
    );

    const resolver = createResolver({
      name: "getUserById",
      batchFn,
      find: (user, key) => user.id === key,
    });

    const [r1, r2] = await Promise.all([resolver.load(1), resolver.load(2)]);

    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(batchFn).toHaveBeenCalledWith([1, 2]);

    expect(isOk(r1)).toBe(true);
    if (r1.ok) expect(r1.value).toEqual({ id: 1, name: "User-1" });
    expect(isOk(r2)).toBe(true);
    if (r2.ok) expect(r2.value).toEqual({ id: 2, name: "User-2" });
  });

  it("dedup: two loads with same key → same promise, batchFn sees unique keys only", async () => {
    const batchFn = vi.fn(
      async (keys: number[]): AsyncResult<User[], "QUERY_ERROR"> =>
        ok(makeUsers(...keys))
    );

    const resolver = createResolver({
      name: "getUserById",
      batchFn,
      find: (user, key) => user.id === key,
    });

    const p1 = resolver.load(1);
    const p2 = resolver.load(1);

    // Same promise reference for dedup
    expect(p1).toBe(p2);

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(batchFn).toHaveBeenCalledWith([1]); // Unique keys only
    expect(r1).toBe(r2); // Same result
  });

  it("across ticks: loads in different ticks → separate batches", async () => {
    const batchFn = vi.fn(
      async (keys: number[]): AsyncResult<User[], "QUERY_ERROR"> =>
        ok(makeUsers(...keys))
    );

    const resolver = createResolver({
      name: "getUserById",
      batchFn,
      find: (user, key) => user.id === key,
    });

    // First tick
    const _r1 = await resolver.load(1);
    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(batchFn).toHaveBeenCalledWith([1]);

    // Second tick (after first await)
    const _r2 = await resolver.load(2);
    expect(batchFn).toHaveBeenCalledTimes(2);
    expect(batchFn).toHaveBeenCalledWith([2]);
  });

  it("not found: batch ok but missing key → RESOLVER_NOT_FOUND", async () => {
    const resolver = createResolver({
      name: "getUserById",
      batchFn: async (keys: number[]): AsyncResult<User[], "QUERY_ERROR"> => {
        // Only return user 1, not user 999
        return ok(makeUsers(...keys.filter((k) => k === 1)));
      },
      find: (user, key) => user.id === key,
    });

    const [r1, r2] = await Promise.all([
      resolver.load(1),
      resolver.load(999),
    ]);

    expect(isOk(r1)).toBe(true);
    if (r1.ok) expect(r1.value).toEqual({ id: 1, name: "User-1" });

    expect(isErr(r2)).toBe(true);
    if (!r2.ok) expect(r2.error).toBe("RESOLVER_NOT_FOUND");
  });

  it("batch error: batch returns err(E) → all pending keys resolve to that error", async () => {
    const resolver = createResolver({
      name: "getUserById",
      batchFn: async (_keys: number[]): AsyncResult<User[], "QUERY_ERROR"> =>
        err("QUERY_ERROR"),
      find: (user, key) => user.id === key,
    });

    const [r1, r2] = await Promise.all([resolver.load(1), resolver.load(2)]);

    expect(isErr(r1)).toBe(true);
    if (!r1.ok) expect(r1.error).toBe("QUERY_ERROR");

    expect(isErr(r2)).toBe(true);
    if (!r2.ok) expect(r2.error).toBe("QUERY_ERROR");
  });

  it("batchFn throws → maps to UNEXPECTED_ERROR", async () => {
    const resolver = createResolver({
      name: "getUserById",
      batchFn: async (_keys: number[]): AsyncResult<User[], "QUERY_ERROR"> => {
        throw new Error("database connection lost");
      },
      find: (user, key) => user.id === key,
    });

    const r1 = await resolver.load(1);

    expect(isErr(r1)).toBe(true);
    if (!r1.ok) expect(r1.error).toBe("UNEXPECTED_ERROR");
  });

  it("loadMany: results array matches input order including duplicates", async () => {
    const batchFn = vi.fn(
      async (keys: number[]): AsyncResult<User[], "QUERY_ERROR"> =>
        ok(makeUsers(...keys))
    );

    const resolver = createResolver({
      name: "getUserById",
      batchFn,
      find: (user, key) => user.id === key,
    });

    const results = await resolver.loadMany([3, 1, 2, 1]);

    expect(results).toHaveLength(4);
    expect(isOk(results[0])).toBe(true);
    if (results[0].ok) expect(results[0].value.id).toBe(3);
    expect(isOk(results[1])).toBe(true);
    if (results[1].ok) expect(results[1].value.id).toBe(1);
    expect(isOk(results[2])).toBe(true);
    if (results[2].ok) expect(results[2].value.id).toBe(2);
    // Duplicate key should still resolve
    expect(isOk(results[3])).toBe(true);
    if (results[3].ok) expect(results[3].value.id).toBe(1);
  });

  it("cache: second load for same key (after flush) returns cached result", async () => {
    const batchFn = vi.fn(
      async (keys: number[]): AsyncResult<User[], "QUERY_ERROR"> =>
        ok(makeUsers(...keys))
    );

    const resolver = createResolver({
      name: "getUserById",
      batchFn,
      find: (user, key) => user.id === key,
      cache: true,
    });

    // First load
    const r1 = await resolver.load(1);
    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(isOk(r1)).toBe(true);

    // Second load (should be cached, no new batch call)
    const r2 = await resolver.load(1);
    expect(batchFn).toHaveBeenCalledTimes(1); // Still only 1 call
    expect(isOk(r2)).toBe(true);
    if (r2.ok) expect(r2.value).toEqual({ id: 1, name: "User-1" });
  });

  it("cache: only ok values cached, not errors", async () => {
    let callCount = 0;
    const resolver = createResolver({
      name: "getUserById",
      batchFn: async (keys: number[]): AsyncResult<User[], "QUERY_ERROR"> => {
        callCount++;
        // Only return user 1, never user 999
        return ok(makeUsers(...keys.filter((k) => k === 1)));
      },
      find: (user, key) => user.id === key,
      cache: true,
    });

    // First load — 999 gets RESOLVER_NOT_FOUND
    const r1 = await resolver.load(999);
    expect(isErr(r1)).toBe(true);
    expect(callCount).toBe(1);

    // Second load — should NOT be cached (was an error), so batchFn called again
    const r2 = await resolver.load(999);
    expect(isErr(r2)).toBe(true);
    expect(callCount).toBe(2);
  });

  it("clear(key) / clearAll() eviction works", async () => {
    const batchFn = vi.fn(
      async (keys: number[]): AsyncResult<User[], "QUERY_ERROR"> =>
        ok(makeUsers(...keys))
    );

    const resolver = createResolver({
      name: "getUserById",
      batchFn,
      find: (user, key) => user.id === key,
      cache: true,
    });

    // Load and cache
    await resolver.load(1);
    await resolver.load(2);
    expect(batchFn).toHaveBeenCalledTimes(2);

    // Cached — no new calls
    await resolver.load(1);
    expect(batchFn).toHaveBeenCalledTimes(2);

    // Clear single key
    resolver.clear(1);
    await resolver.load(1);
    expect(batchFn).toHaveBeenCalledTimes(3); // New call for evicted key

    // Key 2 still cached
    await resolver.load(2);
    expect(batchFn).toHaveBeenCalledTimes(3);

    // Clear all
    resolver.clearAll();
    await resolver.load(2);
    expect(batchFn).toHaveBeenCalledTimes(4); // New call after clearAll
  });

  it("custom key function: deduplicates by extracted key", async () => {
    const batchFn = vi.fn(
      async (keys: string[]): AsyncResult<User[], "QUERY_ERROR"> =>
        ok(keys.map((k) => ({ id: parseInt(k, 10), name: `User-${k}` })))
    );

    const resolver = createResolver({
      name: "getUserByStringId",
      batchFn,
      key: (input: string) => input,
      find: (user, key) => user.id === parseInt(key, 10),
    });

    // Two loads with same key → single batchFn call
    const [r1, r2] = await Promise.all([resolver.load("42"), resolver.load("42")]);

    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(batchFn).toHaveBeenCalledWith(["42"]);
    expect(isOk(r1)).toBe(true);
    if (r1.ok) expect(r1.value.id).toBe(42);
    expect(isOk(r2)).toBe(true);
  });
});
