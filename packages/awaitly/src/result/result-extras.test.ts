import { describe, it, expect, vi } from "vitest";
import {
  ok,
  err,
  flatten,
  deserialize,
  DESERIALIZATION_ERROR,
} from "./index";
import { tryAsyncRetry } from "./retry";

describe("flatten", () => {
  it("flattens nested Ok", () => {
    const nested = ok(ok(42));
    const result = flatten(nested);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("flattens nested Ok(Err)", () => {
    const nested = ok(err("INNER_ERROR"));
    const result = flatten(nested);
    expect(result).toEqual({ ok: false, error: "INNER_ERROR" });
  });

  it("passes through outer Err", () => {
    const nested = err("OUTER_ERROR");
    const result = flatten(nested);
    expect(result).toEqual({ ok: false, error: "OUTER_ERROR" });
  });
});

describe("deserialize", () => {
  it("deserializes Ok values", () => {
    const result = deserialize<number, string>({ ok: true, value: 42 });
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("deserializes Err values", () => {
    const result = deserialize<number, string>({ ok: false, error: "FAIL" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("FAIL");
    }
  });

  it("deserializes Err with cause", () => {
    const result = deserialize<number, string>({
      ok: false,
      error: "FAIL",
      cause: "original",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("FAIL");
      expect(result.cause).toBe("original");
    }
  });

  it("returns DeserializationError for null", () => {
    const result = deserialize<number, string>(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        type: DESERIALIZATION_ERROR,
        value: null,
      });
    }
  });

  it("returns DeserializationError for non-object", () => {
    const result = deserialize<number, string>("not an object");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        type: DESERIALIZATION_ERROR,
        value: "not an object",
      });
    }
  });

  it("returns DeserializationError for object without ok field", () => {
    const result = deserialize<number, string>({ foo: "bar" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        type: DESERIALIZATION_ERROR,
        value: { foo: "bar" },
      });
    }
  });

  it("returns DeserializationError for invalid ok:true without value", () => {
    const result = deserialize<number, string>({ ok: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { type: string }).type).toBe(
        DESERIALIZATION_ERROR
      );
    }
  });
});

describe("tryAsyncRetry", () => {
  it("succeeds on first attempt", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const result = await tryAsyncRetry(fn, {
      retry: { times: 3, delayMs: 10 },
    });
    expect(result).toEqual({ ok: true, value: 42 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockRejectedValueOnce(new Error("fail2"))
      .mockResolvedValue(42);

    const result = await tryAsyncRetry(fn, {
      retry: { times: 3, delayMs: 1 },
    });
    expect(result).toEqual({ ok: true, value: 42 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("returns error after all retries exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    const result = await tryAsyncRetry(fn, {
      retry: { times: 2, delayMs: 1 },
    });
    expect(result.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("uses custom error mapper", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("network error"));
    const result = await tryAsyncRetry(
      fn,
      (cause) => ({
        type: "FETCH_ERROR" as const,
        message: cause instanceof Error ? cause.message : "unknown",
      }),
      { retry: { times: 1, delayMs: 1 } }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        type: "FETCH_ERROR",
        message: "network error",
      });
    }
  });

  it("respects shouldRetry predicate", async () => {
    let attempt = 0;
    const fn = vi.fn().mockImplementation(() => {
      attempt++;
      throw new Error(attempt === 1 ? "retryable" : "fatal");
    });

    const result = await tryAsyncRetry(
      fn,
      (cause) => (cause instanceof Error ? cause.message : "unknown"),
      {
        retry: {
          times: 3,
          delayMs: 1,
          shouldRetry: (e) => e === "retryable",
        },
      }
    );

    expect(result.ok).toBe(false);
    // Should stop after 2nd attempt because "fatal" doesn't pass shouldRetry
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("uses exponential backoff", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue(42);

    const start = Date.now();
    await tryAsyncRetry(fn, {
      retry: { times: 3, delayMs: 20, backoff: "exponential" },
    });
    const elapsed = Date.now() - start;
    // exponential: 20ms (attempt 0) + 40ms (attempt 1) = 60ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(50);
  });
});
