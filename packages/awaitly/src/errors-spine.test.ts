import { describe, it, expect } from "vitest";
import {
  TimeoutError,
  RetryExhaustedError,
  RateLimitError,
  CircuitBreakerOpenError,
  CompensationError,
  UnexpectedError,
  ValidationError,
  NotFoundError,
} from "./errors";
import { isAwaitlySlug } from "./slugs";

describe("pre-built awaitly-system errors carry the spine", () => {
  it("TimeoutError has the runtime-step-timeout slug", () => {
    const e = new TimeoutError({ operation: "fetchUser", ms: 5000 });
    expect(e.code).toBe("runtime-step-timeout");
    expect(typeof e.hint).toBe("string");
    expect(e.hint!.length).toBeGreaterThan(0);
    expect(e.docsUrl).toBe("https://jagreehal.github.io/awaitly/rules/#runtime-step-timeout");
  });

  it("RetryExhaustedError has the runtime-retry-exhausted slug", () => {
    const e = new RetryExhaustedError({ operation: "send", attempts: 3 });
    expect(e.code).toBe("runtime-retry-exhausted");
  });

  it("RateLimitError has the runtime-rate-limit slug", () => {
    const e = new RateLimitError({ retryAfterMs: 1000 });
    expect(e.code).toBe("runtime-rate-limit");
  });

  it("CircuitBreakerOpenError has the runtime-circuit-open slug", () => {
    const e = new CircuitBreakerOpenError({ circuitName: "db" });
    expect(e.code).toBe("runtime-circuit-open");
  });

  it("CompensationError has the runtime-saga-compensation slug", () => {
    const e = new CompensationError({ step: "chargeCard" });
    expect(e.code).toBe("runtime-saga-compensation");
  });

  it("UnexpectedError has the runtime-unexpected slug", () => {
    const e = new UnexpectedError({ cause: new Error("boom") });
    expect(e.code).toBe("runtime-unexpected");
  });

  it("every system error's hint is one short sentence (≤ 160 chars)", () => {
    const errs = [
      new TimeoutError({ operation: "x", ms: 1 }),
      new RetryExhaustedError({ operation: "x", attempts: 1 }),
      new RateLimitError({ retryAfterMs: 1 }),
      new CircuitBreakerOpenError({ circuitName: "x" }),
      new CompensationError({ step: "x" }),
      new UnexpectedError({ cause: "x" }),
    ];
    for (const e of errs) {
      expect(e.hint!.length).toBeLessThanOrEqual(160);
    }
  });

  it("every system error's code is a valid slug", () => {
    const errs = [
      new TimeoutError({ operation: "x", ms: 1 }),
      new RetryExhaustedError({ operation: "x", attempts: 1 }),
      new RateLimitError({ retryAfterMs: 1 }),
      new CircuitBreakerOpenError({ circuitName: "x" }),
      new CompensationError({ step: "x" }),
      new UnexpectedError({ cause: "x" }),
    ];
    for (const e of errs) {
      expect(isAwaitlySlug(e.code!)).toBe(true);
    }
  });

  it("user-domain convenience errors deliberately have no spine", () => {
    const v = new ValidationError({ field: "email", reason: "required" });
    const n = new NotFoundError({ resource: "User", id: "1" });
    expect((v as unknown as { code?: string }).code).toBeUndefined();
    expect((n as unknown as { code?: string }).code).toBeUndefined();
  });

  it("no system error throws during construction (hint is always present)", () => {
    expect(() => new TimeoutError({ ms: 1 })).not.toThrow();
    expect(() => new RetryExhaustedError({ attempts: 1 })).not.toThrow();
    expect(() => new RateLimitError({})).not.toThrow();
    expect(() => new CircuitBreakerOpenError({ circuitName: "x" })).not.toThrow();
    expect(() => new CompensationError({ step: "x" })).not.toThrow();
    expect(() => new UnexpectedError({ cause: "x" })).not.toThrow();
  });

  it("every system error's docsUrl matches the canonical URL for its code", () => {
    const errs = [
      new TimeoutError({ operation: "x", ms: 1 }),
      new RetryExhaustedError({ operation: "x", attempts: 1 }),
      new RateLimitError({ retryAfterMs: 1 }),
      new CircuitBreakerOpenError({ circuitName: "x" }),
      new CompensationError({ step: "x" }),
      new UnexpectedError({ cause: "x" }),
    ];
    for (const e of errs) {
      expect(e.docsUrl).toBe(`https://jagreehal.github.io/awaitly/rules/#${e.code}`);
    }
  });

  it("spine fields appear in JSON.stringify output", () => {
    const e = new RetryExhaustedError({ operation: "send", attempts: 2 });
    const json = JSON.parse(JSON.stringify(e));
    expect(json.code).toBe("runtime-retry-exhausted");
    expect(typeof json.hint).toBe("string");
    expect(json.hint.length).toBeGreaterThan(0);
    expect(json.docsUrl).toBe("https://jagreehal.github.io/awaitly/rules/#runtime-retry-exhausted");
  });
});
