/**
 * Tests for awaitly/functional
 */
import { describe, it, expect, vi } from "vitest";
import {
  // Composition
  pipe,
  flow,
  compose,
  identity,

  // Result combinators (sync)
  map,
  flatMap,
  bimap,
  mapError,
  tap,
  tapError,
  match,
  recover,
  recoverWith,
  getOrElse,
  getOrElseLazy,

  // Result combinators (async)
  mapAsync,
  flatMapAsync,
  tapAsync,
  tapErrorAsync,

  // Collection utilities
  all,
  allAsync,
  allSettled,
  allSettledAsync,
  any,
  anyAsync,
  race,
  traverse,
  traverseAsync,
  traverseParallel,

  // Pipeable namespace
  R,
} from ".";
import { ok, err, PROMISE_REJECTED, type Result, type AsyncResult, type PromiseRejectedError } from "../core";

// =============================================================================
// Composition Tests
// =============================================================================

describe("Composition", () => {
  describe("pipe", () => {
    it("returns value unchanged with no functions", () => {
      expect(pipe(5)).toBe(5);
    });

    it("applies single function", () => {
      expect(pipe(5, (x) => x * 2)).toBe(10);
    });

    it("applies multiple functions left-to-right", () => {
      expect(
        pipe(
          5,
          (x) => x * 2,
          (x) => x + 1
        )
      ).toBe(11);
    });

    it("works with many functions", () => {
      expect(
        pipe(
          1,
          (x) => x + 1, // 2
          (x) => x * 2, // 4
          (x) => x + 3, // 7
          (x) => x * 2, // 14
          (x) => x - 4 // 10
        )
      ).toBe(10);
    });

    it("works with different types", () => {
      expect(
        pipe(
          5,
          (x) => `number: ${x}`,
          (s) => s.length
        )
      ).toBe(9);
    });
  });

  describe("flow", () => {
    it("creates a function from a single function", () => {
      const double = flow((x: number) => x * 2);
      expect(double(5)).toBe(10);
    });

    it("composes multiple functions left-to-right", () => {
      const transform = flow(
        (x: number) => x * 2,
        (x) => x + 1
      );
      expect(transform(5)).toBe(11);
    });

    it("creates reusable pipelines", () => {
      const processNumber = flow(
        (x: number) => x * 2,
        (x) => `Result: ${x}`
      );
      expect(processNumber(5)).toBe("Result: 10");
      expect(processNumber(10)).toBe("Result: 20");
    });
  });

  describe("compose", () => {
    it("creates a function from a single function", () => {
      const double = compose((x: number) => x * 2);
      expect(double(5)).toBe(10);
    });

    it("composes multiple functions right-to-left", () => {
      const transform = compose(
        (x: number) => x + 1,
        (x: number) => x * 2
      );
      // x * 2 first, then + 1
      expect(transform(5)).toBe(11);
    });

    it("is equivalent to flow in reverse order", () => {
      const f1 = (x: number) => x * 2;
      const f2 = (x: number) => x + 1;

      const flowResult = flow(f1, f2)(5);
      const composeResult = compose(f2, f1)(5);

      expect(flowResult).toBe(composeResult);
    });
  });

  describe("identity", () => {
    it("returns the same value", () => {
      expect(identity(5)).toBe(5);
      expect(identity("hello")).toBe("hello");
      const obj = { a: 1 };
      expect(identity(obj)).toBe(obj);
    });
  });
});

// =============================================================================
// Result Combinator Tests (sync)
// =============================================================================

describe("Result Combinators (sync)", () => {
  describe("map", () => {
    it("transforms success value", () => {
      const result = map(ok(5), (x) => x * 2);
      expect(result).toEqual(ok(10));
    });

    it("passes through error unchanged", () => {
      const result = map(err("not found"), (x: number) => x * 2);
      expect(result).toEqual(err("not found"));
    });

    it("preserves cause on error", () => {
      const cause = new Error("original");
      const result = map(err("not found", { cause }), (x: number) => x * 2);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.cause).toBe(cause);
      }
    });
  });

  describe("flatMap", () => {
    const divide = (a: number, b: number): Result<number, "DIVISION_BY_ZERO"> =>
      b === 0 ? err("DIVISION_BY_ZERO") : ok(a / b);

    it("chains successful operations", () => {
      const result = flatMap(ok(10), (x) => divide(x, 2));
      expect(result).toEqual(ok(5));
    });

    it("short-circuits on first error", () => {
      const result = flatMap(ok(10), (x) => divide(x, 0));
      expect(result).toEqual(err("DIVISION_BY_ZERO"));
    });

    it("passes through original error", () => {
      const result = flatMap(err("NOT_FOUND" as const), (_: number) => divide(10, 2));
      expect(result).toEqual(err("NOT_FOUND"));
    });

    it("can chain multiple flatMaps in pipe", () => {
      const result = pipe(
        ok(100) as Result<number, "NOT_FOUND" | "DIVISION_BY_ZERO">,
        R.flatMap((x) => divide(x, 2)),
        R.flatMap((x) => divide(x, 5))
      );
      expect(result).toEqual(ok(10));
    });
  });

  describe("bimap", () => {
    it("transforms success value", () => {
      const result = bimap(
        ok(5),
        (x) => x * 2,
        (e: string) => `Error: ${e}`
      );
      expect(result).toEqual(ok(10));
    });

    it("transforms error value", () => {
      const result = bimap(
        err("not found"),
        (x: number) => x * 2,
        (e) => `Error: ${e}`
      );
      expect(result).toEqual(err("Error: not found"));
    });
  });

  describe("mapError", () => {
    it("transforms error value", () => {
      const result = mapError(err("not found"), (e) => ({
        type: "ERROR" as const,
        message: e,
      }));
      expect(result).toEqual(err({ type: "ERROR", message: "not found" }));
    });

    it("passes through success unchanged", () => {
      const result = mapError(ok(5), (e: string) => ({ type: "ERROR" as const, message: e }));
      expect(result).toEqual(ok(5));
    });

    it("preserves cause", () => {
      const cause = new Error("original");
      const result = mapError(err("not found", { cause }), (e) => `wrapped: ${e}`);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.cause).toBe(cause);
      }
    });
  });

  describe("tap", () => {
    it("executes side effect on success", () => {
      const sideEffect = vi.fn();
      const result = tap(ok(5), sideEffect);
      expect(sideEffect).toHaveBeenCalledWith(5);
      expect(result).toEqual(ok(5));
    });

    it("does not execute side effect on error", () => {
      const sideEffect = vi.fn();
      const result = tap(err("not found"), sideEffect);
      expect(sideEffect).not.toHaveBeenCalled();
      expect(result).toEqual(err("not found"));
    });
  });

  describe("tapError", () => {
    it("executes side effect on error", () => {
      const sideEffect = vi.fn();
      const result = tapError(err("not found"), sideEffect);
      expect(sideEffect).toHaveBeenCalledWith("not found");
      expect(result).toEqual(err("not found"));
    });

    it("does not execute side effect on success", () => {
      const sideEffect = vi.fn();
      const result = tapError(ok(5), sideEffect);
      expect(sideEffect).not.toHaveBeenCalled();
      expect(result).toEqual(ok(5));
    });
  });

  describe("match", () => {
    it("matches success case", () => {
      const result = match(ok(5), {
        ok: (x) => `Success: ${x}`,
        err: (e) => `Error: ${e}`,
      });
      expect(result).toBe("Success: 5");
    });

    it("matches error case", () => {
      const result = match(err("not found"), {
        ok: (x: number) => `Success: ${x}`,
        err: (e) => `Error: ${e}`,
      });
      expect(result).toBe("Error: not found");
    });

    it("provides cause to error handler", () => {
      const cause = new Error("original");
      const result = match(err("not found", { cause }), {
        ok: (x: number) => `Success: ${x}`,
        err: (e, c) => `Error: ${e}, cause: ${c instanceof Error ? c.message : "unknown"}`,
      });
      expect(result).toBe("Error: not found, cause: original");
    });
  });

  describe("recover", () => {
    it("returns value on success", () => {
      const result = recover(ok(5), () => 0);
      expect(result).toBe(5);
    });

    it("returns recovery value on error", () => {
      const result = recover(err("not found"), () => 0);
      expect(result).toBe(0);
    });

    it("receives error in recovery function", () => {
      const result = recover(err(42), (e) => e * 2);
      expect(result).toBe(84);
    });
  });

  describe("recoverWith", () => {
    it("returns original result on success", () => {
      const result = recoverWith(ok(5), () => ok(0));
      expect(result).toEqual(ok(5));
    });

    it("returns recovery result on error", () => {
      const result = recoverWith(err("not found"), () => ok(0));
      expect(result).toEqual(ok(0));
    });

    it("can return error from recovery", () => {
      const result = recoverWith(err("first error"), () => err("second error"));
      expect(result).toEqual(err("second error"));
    });
  });

  describe("getOrElse", () => {
    it("returns value on success", () => {
      expect(getOrElse(ok(5), 0)).toBe(5);
    });

    it("returns default on error", () => {
      expect(getOrElse(err("not found"), 0)).toBe(0);
    });
  });

  describe("getOrElseLazy", () => {
    it("returns value on success without calling fallback", () => {
      const fallback = vi.fn(() => 0);
      expect(getOrElseLazy(ok(5), fallback)).toBe(5);
      expect(fallback).not.toHaveBeenCalled();
    });

    it("calls fallback on error", () => {
      const fallback = vi.fn(() => 0);
      expect(getOrElseLazy(err("not found"), fallback)).toBe(0);
      expect(fallback).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Result Combinator Tests (async)
// =============================================================================

describe("Result Combinators (async)", () => {
  describe("mapAsync", () => {
    it("transforms success value asynchronously", async () => {
      const result = await mapAsync(ok(5), async (x) => x * 2);
      expect(result).toEqual(ok(10));
    });

    it("passes through error unchanged", async () => {
      const result = await mapAsync(err("not found"), async (x: number) => x * 2);
      expect(result).toEqual(err("not found"));
    });

    it("works with AsyncResult input", async () => {
      const asyncInput: AsyncResult<number, string> = Promise.resolve(ok(5));
      const result = await mapAsync(asyncInput, async (x) => x * 2);
      expect(result).toEqual(ok(10));
    });
  });

  describe("flatMapAsync", () => {
    const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> =>
      id === "1" ? ok({ id, name: "Alice" }) : err("NOT_FOUND");

    it("chains async operations", async () => {
      const result = await flatMapAsync(ok("1"), fetchUser);
      expect(result).toEqual(ok({ id: "1", name: "Alice" }));
    });

    it("short-circuits on error", async () => {
      const result = await flatMapAsync(ok("2"), fetchUser);
      expect(result).toEqual(err("NOT_FOUND"));
    });

    it("passes through original error", async () => {
      const result = await flatMapAsync(err("INVALID_INPUT" as const), fetchUser);
      expect(result).toEqual(err("INVALID_INPUT"));
    });
  });

  describe("tapAsync", () => {
    it("executes async side effect on success", async () => {
      const sideEffect = vi.fn(async () => {});
      const result = await tapAsync(ok(5), sideEffect);
      expect(sideEffect).toHaveBeenCalledWith(5);
      expect(result).toEqual(ok(5));
    });

    it("does not execute side effect on error", async () => {
      const sideEffect = vi.fn(async () => {});
      const result = await tapAsync(err("not found"), sideEffect);
      expect(sideEffect).not.toHaveBeenCalled();
      expect(result).toEqual(err("not found"));
    });
  });

  describe("tapErrorAsync", () => {
    it("executes async side effect on error", async () => {
      const sideEffect = vi.fn(async () => {});
      const result = await tapErrorAsync(err("not found"), sideEffect);
      expect(sideEffect).toHaveBeenCalledWith("not found");
      expect(result).toEqual(err("not found"));
    });

    it("does not execute side effect on success", async () => {
      const sideEffect = vi.fn(async () => {});
      const result = await tapErrorAsync(ok(5), sideEffect);
      expect(sideEffect).not.toHaveBeenCalled();
      expect(result).toEqual(ok(5));
    });
  });
});

// =============================================================================
// Collection Utilities Tests
// =============================================================================

describe("Collection Utilities", () => {
  describe("all", () => {
    it("combines all successes into array", () => {
      expect(all([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
    });

    it("returns first error", () => {
      expect(all([ok(1), err("a"), ok(3), err("b")])).toEqual(err("a"));
    });

    it("returns empty array for empty input", () => {
      expect(all([])).toEqual(ok([]));
    });
  });

  describe("allAsync", () => {
    it("combines all async successes", async () => {
      const result = await allAsync([
        Promise.resolve(ok(1)),
        Promise.resolve(ok(2)),
        Promise.resolve(ok(3)),
      ]);
      expect(result).toEqual(ok([1, 2, 3]));
    });

    it("returns first error", async () => {
      const result = await allAsync([
        Promise.resolve(ok(1)),
        Promise.resolve(err("a")),
        Promise.resolve(ok(3)),
      ]);
      expect(result).toEqual(err("a"));
    });

    it("fails fast without waiting on pending results", async () => {
      const never = new Promise<Result<number, string>>(() => {});
      const fast = Promise.resolve(err("fail"));

      const result = await Promise.race([
        allAsync([fast, never]),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 20)),
      ]);

      expect(result).toEqual(err("fail"));
    });

    it("does not hang on rejected promises", async () => {
      const rejection = Promise.reject(new Error("boom"));
      rejection.catch(() => {});

      const result = await Promise.race([
        allAsync([rejection]),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 20)),
      ]);

      expect(result).not.toBe("timeout");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({ type: PROMISE_REJECTED, cause: expect.any(Error) });
      }
    });

    it("returns a Result for promise rejection instead of rejecting", async () => {
      const rejection = Promise.reject("boom");
      rejection.catch(() => {});

      const result = await allAsync([
        rejection as unknown as AsyncResult<number, { type: string; cause: unknown }>
      ]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({ type: PROMISE_REJECTED, cause: "boom" });
      }
    });
  });

  describe("allSettled", () => {
    it("separates successes and failures", () => {
      const result = allSettled([ok(1), err("a"), ok(2), err("b")]);
      expect(result).toEqual({ ok: [1, 2], err: ["a", "b"] });
    });

    it("handles all successes", () => {
      const result = allSettled([ok(1), ok(2), ok(3)]);
      expect(result).toEqual({ ok: [1, 2, 3], err: [] });
    });

    it("handles all failures", () => {
      const result = allSettled([err("a"), err("b"), err("c")]);
      expect(result).toEqual({ ok: [], err: ["a", "b", "c"] });
    });
  });

  describe("allSettledAsync", () => {
    it("separates async successes and failures", async () => {
      const result = await allSettledAsync([
        Promise.resolve(ok(1)),
        Promise.resolve(err("a")),
        Promise.resolve(ok(2)),
      ]);
      expect(result).toEqual({ ok: [1, 2], err: ["a"] });
    });

    it("does not reject when an input promise rejects", async () => {
      const rejection = Promise.reject("boom");
      rejection.catch(() => {});

      const result = await Promise.race([
        allSettledAsync([
          rejection as unknown as AsyncResult<number, PromiseRejectedError>,
        ]).catch((e) => e),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 20)),
      ]);

      expect(result).not.toBe("timeout");
      expect(result).not.toBeInstanceOf(Error);
    });

    it("preserves input order for successful values", async () => {
      const slow = new Promise<Result<number, string>>((resolve) =>
        setTimeout(() => resolve(ok(1)), 20)
      );
      const fast = new Promise<Result<number, string>>((resolve) =>
        setTimeout(() => resolve(ok(2)), 5)
      );

      const result = await allSettledAsync([slow, fast]);

      expect(result).toEqual({ ok: [1, 2], err: [] });
    });
  });

  describe("any", () => {
    it("returns first success", () => {
      expect(any([err("a"), ok(1), err("b")])).toEqual(ok(1));
    });

    it("returns all errors if all fail", () => {
      expect(any([err("a"), err("b"), err("c")])).toEqual(err(["a", "b", "c"]));
    });

    it("returns first success encountered", () => {
      expect(any([err("a"), ok(1), ok(2)])).toEqual(ok(1));
    });
  });

  describe("anyAsync", () => {
    it("returns first async success", async () => {
      const result = await anyAsync([
        Promise.resolve(err("a")),
        Promise.resolve(ok(1)),
        Promise.resolve(err("b")),
      ]);
      expect(result).toEqual(ok(1));
    });

    it("returns all errors if all fail", async () => {
      const result = await anyAsync([
        Promise.resolve(err("a")),
        Promise.resolve(err("b")),
      ]);
      expect(result).toEqual(err(["a", "b"]));
    });

    it("resolves once a success is available without waiting on pending results", async () => {
      const never = new Promise<Result<number, string>>(() => {});
      const fast = Promise.resolve(ok(1));

      const result = await Promise.race([
        anyAsync([fast, never]),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 20)),
      ]);

      expect(result).toEqual(ok(1));
    });

    it("does not hang on rejected promises", async () => {
      const rejection = Promise.reject(new Error("boom"));
      rejection.catch(() => {});

      const result = await Promise.race([
        anyAsync([rejection, Promise.resolve(err("nope"))]),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 20)),
      ]);

      expect(result).not.toBe("timeout");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toHaveLength(2);
        expect(result.error[0]).toEqual({ type: PROMISE_REJECTED, cause: expect.any(Error) });
        expect(result.error[1]).toBe("nope");
      }
    });

    it("preserves input order when all results fail", async () => {
      const slow = new Promise<Result<number, string>>((resolve) =>
        setTimeout(() => resolve(err("slow")), 20)
      );
      const fast = new Promise<Result<number, string>>((resolve) =>
        setTimeout(() => resolve(err("fast")), 5)
      );

      const result = await anyAsync([slow, fast]);
 
      expect(result).toEqual(err(["slow", "fast"]));
    });
  });

  describe("race", () => {
    it("returns first result to complete", async () => {
      const fast = new Promise<Result<number, string>>((resolve) =>
        setTimeout(() => resolve(ok(1)), 10)
      );
      const slow = new Promise<Result<number, string>>((resolve) =>
        setTimeout(() => resolve(ok(2)), 100)
      );

      const result = await race([slow, fast]);
      expect(result).toEqual(ok(1));
    });

    it("can return error if error completes first", async () => {
      const fast = new Promise<Result<number, string>>((resolve) =>
        setTimeout(() => resolve(err("fast error")), 10)
      );
      const slow = new Promise<Result<number, string>>((resolve) =>
        setTimeout(() => resolve(ok(2)), 100)
      );

      const result = await race([slow, fast]);
      expect(result).toEqual(err("fast error"));
    });

    it("returns a Result when an input rejects instead of rejecting", async () => {
      const rejection = Promise.reject("boom");

      const result = await race([rejection as AsyncResult<number, never>]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({ type: PROMISE_REJECTED, cause: "boom" });
      }
    });
  });

  describe("traverse", () => {
    const validate = (x: number): Result<number, string> =>
      x > 0 ? ok(x * 2) : err("must be positive");

    it("applies function to all items", () => {
      expect(traverse([1, 2, 3], validate)).toEqual(ok([2, 4, 6]));
    });

    it("stops on first error", () => {
      expect(traverse([1, -2, 3], validate)).toEqual(err("must be positive"));
    });

    it("provides index to function", () => {
      const result = traverse([10, 20, 30], (item, index) => ok(item + index));
      expect(result).toEqual(ok([10, 21, 32]));
    });
  });

  describe("traverseAsync", () => {
    const fetchItem = async (id: number): AsyncResult<string, "NOT_FOUND"> =>
      id > 0 ? ok(`item-${id}`) : err("NOT_FOUND");

    it("applies async function to all items sequentially", async () => {
      const result = await traverseAsync([1, 2, 3], fetchItem);
      expect(result).toEqual(ok(["item-1", "item-2", "item-3"]));
    });

    it("stops on first error", async () => {
      const result = await traverseAsync([1, -2, 3], fetchItem);
      expect(result).toEqual(err("NOT_FOUND"));
    });
  });

  describe("traverseParallel", () => {
    it("executes all in parallel", async () => {
      const order: number[] = [];
      const fn = async (x: number): AsyncResult<number, never> => {
        await new Promise((r) => setTimeout(r, (4 - x) * 10));
        order.push(x);
        return ok(x * 2);
      };

      const result = await traverseParallel([1, 2, 3], fn);
      expect(result).toEqual(ok([2, 4, 6]));
      // Items complete in reverse order due to delays
      expect(order).toEqual([3, 2, 1]);
    });

    it("fails fast without waiting on pending results", async () => {
      const fn = (x: number): AsyncResult<number, string> => {
        if (x === 1) return Promise.resolve(err("fail"));
        return new Promise(() => {}); // never resolves
      };

      const result = await Promise.race([
        traverseParallel([1, 2, 3], fn),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 20)),
      ]);

      expect(result).toEqual(err("fail"));
    });
  });
});

// =============================================================================
// R Namespace (Pipeable) Tests
// =============================================================================

describe("R Namespace (Pipeable)", () => {
  it("R.map works in pipe", () => {
    const result = pipe(ok(5), R.map((x) => x * 2));
    expect(result).toEqual(ok(10));
  });

  it("R.flatMap works in pipe", () => {
    const divide = (x: number): Result<number, "DIV_ZERO"> =>
      x === 0 ? err("DIV_ZERO") : ok(100 / x);

    const result = pipe(ok(5), R.flatMap(divide));
    expect(result).toEqual(ok(20));
  });

  it("R.bimap works in pipe", () => {
    const result = pipe(
      ok(5),
      R.bimap(
        (x) => x * 2,
        (e: string) => `Error: ${e}`
      )
    );
    expect(result).toEqual(ok(10));
  });

  it("R.mapError works in pipe", () => {
    const result = pipe(
      err("not found"),
      R.mapError((e) => ({ type: "ERROR" as const, message: e }))
    );
    expect(result).toEqual(err({ type: "ERROR", message: "not found" }));
  });

  it("R.tap works in pipe", () => {
    const sideEffect = vi.fn();
    const result = pipe(ok(5), R.tap(sideEffect));
    expect(sideEffect).toHaveBeenCalledWith(5);
    expect(result).toEqual(ok(5));
  });

  it("R.tapError works in pipe", () => {
    const sideEffect = vi.fn();
    const result = pipe(err("error"), R.tapError(sideEffect));
    expect(sideEffect).toHaveBeenCalledWith("error");
    expect(result).toEqual(err("error"));
  });

  it("R.match works in pipe", () => {
    const result = pipe(
      ok(5),
      R.match({
        ok: (x) => `Success: ${x}`,
        err: (e) => `Error: ${e}`,
      })
    );
    expect(result).toBe("Success: 5");
  });

  it("R.recover works in pipe", () => {
    const result = pipe(
      err("not found"),
      R.recover(() => 0)
    );
    expect(result).toBe(0);
  });

  it("R.recoverWith works in pipe", () => {
    const result = pipe(
      err("not found"),
      R.recoverWith(() => ok(0))
    );
    expect(result).toEqual(ok(0));
  });

  it("R.getOrElse works in pipe", () => {
    const result = pipe(err("not found"), R.getOrElse(0));
    expect(result).toBe(0);
  });

  it("R.getOrElseLazy works in pipe", () => {
    const result = pipe(
      err("not found"),
      R.getOrElseLazy(() => 0)
    );
    expect(result).toBe(0);
  });

  it("complex pipeline example", () => {
    type User = { id: string; name: string; email: string };
    type Post = { id: string; title: string; authorId: string };

    const fetchUser = (id: string): Result<User, "USER_NOT_FOUND"> =>
      id === "1"
        ? ok({ id: "1", name: "Alice", email: "alice@example.com" })
        : err("USER_NOT_FOUND");

    const fetchPosts = (userId: string): Result<Post[], "POSTS_ERROR"> =>
      ok([
        { id: "p1", title: "Hello World", authorId: userId },
        { id: "p2", title: "TypeScript Tips", authorId: userId },
      ]);

    const result = pipe(
      fetchUser("1"),
      R.flatMap((user) => fetchPosts(user.id)),
      R.map((posts) => posts.length),
      R.match({
        ok: (count) => `Found ${count} posts`,
        err: (e) => `Error: ${e}`,
      })
    );

    expect(result).toBe("Found 2 posts");
  });

  it("handles error propagation correctly", () => {
    type User = { id: string };

    const fetchUser = (id: string): Result<User, "USER_NOT_FOUND"> =>
      id === "1" ? ok({ id: "1" }) : err("USER_NOT_FOUND");

    const fetchPosts = (_userId: string): Result<string[], "POSTS_ERROR"> => ok(["post1"]);

    const result = pipe(
      fetchUser("2"), // This will fail
      R.flatMap((user) => fetchPosts(user.id)),
      R.map((posts) => posts.length),
      R.match({
        ok: (count) => `Found ${count} posts`,
        err: (e) => `Error: ${e}`,
      })
    );

    expect(result).toBe("Error: USER_NOT_FOUND");
  });
});

// =============================================================================
// Type Inference Tests
// =============================================================================

describe("Type inference", () => {
  it("infers error union types in flatMap chains", () => {
    type UserError = { type: "USER_NOT_FOUND" };
    type PostError = { type: "POSTS_ERROR" };

    const fetchUser = (_id: string): Result<{ id: string }, UserError> =>
      ok({ id: "1" });

    const fetchPosts = (_userId: string): Result<string[], PostError> => ok(["post"]);

    const result = pipe(
      fetchUser("1"),
      R.flatMap((user) => fetchPosts(user.id))
    );

    // Type should be Result<string[], UserError | PostError>
    // We can verify this works at runtime
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["post"]);
    }
  });

  it("preserves generic types through flow", () => {
    const processNumber = flow(
      (x: number) => ok(x * 2),
      R.map((x) => `Result: ${x}`)
    );

    const result = processNumber(5);
    expect(result).toEqual(ok("Result: 10"));
  });
});
