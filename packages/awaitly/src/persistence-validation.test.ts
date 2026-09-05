/**
 * Snapshot validation, cause serialization and cache expiry.
 *
 * Mutation testing reported every individual validation branch uncovered: the
 * suite proved a good snapshot passes and a nonsense one fails, and nothing
 * in between. `validateSnapshot` is what stands between a corrupted row and a
 * workflow restarting from the top, so each rejection it can make is asserted
 * here by the message it produces.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  validateSnapshot,
  serializeThrown,
  serializeError,
  createMemoryCache,
} from "./persistence";
import { ok } from "./core";

const validSnapshot = () => ({
  formatVersion: 1,
  steps: { "step:a": { ok: true, value: 1 } },
  execution: { status: "completed", lastUpdated: new Date().toISOString() },
});

/** The messages a rejection produced, for assertions that read as prose. */
function errorsFor(obj: unknown): string[] {
  const result = validateSnapshot(obj);
  expect(result.valid).toBe(false);
  return result.valid ? [] : result.errors;
}

describe("validateSnapshot accepts a well-formed snapshot", () => {
  it("passes and hands back the snapshot", () => {
    const snapshot = validSnapshot();
    const result = validateSnapshot(snapshot);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.snapshot).toBe(snapshot);
  });

  it("accepts each legal execution status", () => {
    for (const status of ["running", "completed", "failed"]) {
      const result = validateSnapshot({ ...validSnapshot(), execution: { status, lastUpdated: "t" } });
      expect(result.valid, `status ${status} should be legal`).toBe(true);
    }
  });

  it("accepts an error step carrying both error and cause", () => {
    const result = validateSnapshot({
      ...validSnapshot(),
      steps: { "step:a": { ok: false, error: "DECLINED", cause: null } },
    });

    expect(result.valid).toBe(true);
  });

  it("accepts a snapshot with no steps recorded yet", () => {
    expect(validateSnapshot({ ...validSnapshot(), steps: {} }).valid).toBe(true);
  });
});

describe("validateSnapshot rejects what it cannot trust", () => {
  it.each([
    ["null", null],
    ["a string", "snapshot"],
    ["a number", 42],
    ["undefined", undefined],
  ])("rejects %s outright", (_label, input) => {
    expect(errorsFor(input)).toEqual(["Snapshot must be an object"]);
  });

  it("names a missing formatVersion", () => {
    const { formatVersion: _, ...rest } = validSnapshot();
    expect(errorsFor(rest)).toContain("Missing required field: formatVersion");
  });

  it("names a formatVersion it does not understand", () => {
    // A future version means fields this code has never seen; reading it
    // anyway is how a resume acts on state it misunderstands.
    expect(errorsFor({ ...validSnapshot(), formatVersion: 2 })).toContain(
      "Invalid formatVersion: expected 1, got 2"
    );
  });

  it("names a missing steps field", () => {
    const { steps: _, ...rest } = validSnapshot();
    expect(errorsFor(rest)).toContain("Missing required field: steps");
  });

  it.each([
    ["a string", "not-steps"],
    ["null", null],
  ])("rejects steps that is %s", (_label, steps) => {
    expect(errorsFor({ ...validSnapshot(), steps })).toContain("steps must be an object");
  });

  it("names the step whose entry is not an object", () => {
    expect(errorsFor({ ...validSnapshot(), steps: { "step:a": "oops" } })).toContain(
      'steps["step:a"] must be an object'
    );
  });

  it("names the step missing its ok field", () => {
    expect(errorsFor({ ...validSnapshot(), steps: { "step:a": { value: 1 } } })).toContain(
      'steps["step:a"] missing required field: ok'
    );
  });

  it("names the step whose ok is not a boolean", () => {
    expect(errorsFor({ ...validSnapshot(), steps: { "step:a": { ok: "yes" } } })).toContain(
      'steps["step:a"].ok must be a boolean'
    );
  });

  it("names a failed step missing its error field", () => {
    expect(errorsFor({ ...validSnapshot(), steps: { "step:a": { ok: false, cause: null } } })).toContain(
      'steps["step:a"] is error result but missing error field'
    );
  });

  it("names a failed step missing its cause field", () => {
    expect(errorsFor({ ...validSnapshot(), steps: { "step:a": { ok: false, error: "E" } } })).toContain(
      'steps["step:a"] is error result but missing cause field'
    );
  });

  it("reports both missing fields on a failed step at once", () => {
    const errors = errorsFor({ ...validSnapshot(), steps: { "step:a": { ok: false } } });
    expect(errors).toHaveLength(2);
  });

  it("does not demand error and cause from a successful step", () => {
    expect(validateSnapshot({ ...validSnapshot(), steps: { "step:a": { ok: true } } }).valid).toBe(true);
  });

  it("names a missing execution field", () => {
    const { execution: _, ...rest } = validSnapshot();
    expect(errorsFor(rest)).toContain("Missing required field: execution");
  });

  it.each([
    ["a string", "running"],
    ["null", null],
  ])("rejects execution that is %s", (_label, execution) => {
    expect(errorsFor({ ...validSnapshot(), execution })).toContain("execution must be an object");
  });

  it("names a missing execution status", () => {
    expect(errorsFor({ ...validSnapshot(), execution: { lastUpdated: "t" } })).toContain(
      "execution missing required field: status"
    );
  });

  it("names an execution status outside the known set", () => {
    expect(
      errorsFor({ ...validSnapshot(), execution: { status: "cancelled", lastUpdated: "t" } })
    ).toContain("execution.status must be one of: running, completed, failed");
  });

  it("names a missing lastUpdated", () => {
    expect(errorsFor({ ...validSnapshot(), execution: { status: "running" } })).toContain(
      "execution missing required field: lastUpdated"
    );
  });

  it("names a lastUpdated that is not a string", () => {
    expect(
      errorsFor({ ...validSnapshot(), execution: { status: "running", lastUpdated: 1712 } })
    ).toContain("execution.lastUpdated must be a string (ISO timestamp)");
  });

  it("collects every problem rather than stopping at the first", () => {
    // An operator reading the log should see the whole story in one line.
    const errors = errorsFor({ formatVersion: 3, steps: { a: 1 }, execution: {} });

    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors.join(" ")).toContain("Invalid formatVersion");
    expect(errors.join(" ")).toContain("execution missing required field: status");
  });
});

describe("serializeThrown", () => {
  it("records a plain string throw with its type and value", () => {
    expect(serializeThrown("boom")).toEqual({
      type: "thrown",
      originalType: "string",
      stringRepresentation: "boom",
      value: "boom",
    });
  });

  it("names null as null rather than object", () => {
    expect(serializeThrown(null).originalType).toBe("null");
  });

  it("uses an object's constructor name", () => {
    class PaymentFailure {}
    expect(serializeThrown(new PaymentFailure()).originalType).toBe("PaymentFailure");
  });

  it("falls back to Object when a value has no constructor", () => {
    expect(serializeThrown(Object.create(null)).originalType).toBe("Object");
  });

  it("truncates an oversized string representation and says so", () => {
    const long = "x".repeat(20_000);
    const serialized = serializeThrown(long);

    // An unbounded throw value would otherwise be written to the snapshot row
    // in full.
    expect(serialized.truncated).toBe(true);
    expect(serialized.stringRepresentation.length).toBeLessThan(long.length);
  });

  it("leaves a short value unmarked", () => {
    expect(serializeThrown("short").truncated).toBeUndefined();
  });

  it("survives a value whose toString throws", () => {
    const hostile = {
      toString() {
        throw new Error("no");
      },
    };

    expect(serializeThrown(hostile).stringRepresentation).toBe("[unable to convert to string]");
  });

  it("omits value for something JSON cannot represent", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const serialized = serializeThrown(circular);
    expect(serialized.value).toBeUndefined();
    expect(serialized.stringRepresentation).toBe("[object Object]");
  });

  it("keeps a JSON-representable object as value", () => {
    expect(serializeThrown({ code: 42 }).value).toEqual({ code: 42 });
  });
});

describe("serializeError", () => {
  it("records name, message and stack", () => {
    const serialized = serializeError(new TypeError("bad input"));

    expect(serialized.name).toBe("TypeError");
    expect(serialized.message).toBe("bad input");
    expect(serialized.stack).toBeDefined();
  });

  it("recurses into an Error cause", () => {
    const serialized = serializeError(new Error("outer", { cause: new Error("inner") }));

    expect((serialized.cause as { message: string }).message).toBe("inner");
    expect((serialized.cause as { type: string }).type).toBe("error");
  });

  it("serializes a non-Error cause as a thrown value", () => {
    const serialized = serializeError(new Error("outer", { cause: "just a string" }));

    expect((serialized.cause as { type: string }).type).toBe("thrown");
    expect((serialized.cause as { stringRepresentation: string }).stringRepresentation).toBe(
      "just a string"
    );
  });

  it("omits cause when there is none", () => {
    expect(serializeError(new Error("plain")).cause).toBeUndefined();
  });
});

describe("createMemoryCache expiry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports an expired entry as absent from both get and has", () => {
    vi.useFakeTimers();
    const cache = createMemoryCache({ ttl: 1000 });
    cache.set("k", ok("v"));

    expect(cache.has("k")).toBe(true);
    expect(cache.get("k")).toEqual(ok("v"));

    vi.advanceTimersByTime(1500);

    // A stale step result restored after its ttl is a resume acting on state
    // the caller already declared too old to trust.
    expect(cache.has("k")).toBe(false);
    expect(cache.get("k")).toBeUndefined();
  });

  it("lets a per-entry ttl override the cache default", () => {
    vi.useFakeTimers();
    const cache = createMemoryCache({ ttl: 10_000 });
    cache.set("short", ok("v"), { ttl: 500 });

    vi.advanceTimersByTime(1000);

    expect(cache.has("short")).toBe(false);
  });

  it("keeps entries indefinitely with no ttl configured", () => {
    vi.useFakeTimers();
    const cache = createMemoryCache();
    cache.set("k", ok("v"));

    vi.advanceTimersByTime(10_000_000);

    expect(cache.has("k")).toBe(true);
  });

  it("evicts the oldest entry once maxSize is reached", () => {
    const cache = createMemoryCache({ maxSize: 2 });
    cache.set("a", ok(1));
    cache.set("b", ok(2));
    cache.set("c", ok(3));

    expect(cache.has("a")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });
});
