/**
 * The circuit breaker branches the suite never reached.
 *
 * Mutation testing left three uncovered: the guard that refuses to lapse a
 * breaker which is not OPEN, and `executeResult`'s handling of an operation
 * that throws rather than returning err. A breaker that miscounts either one
 * keeps sending traffic at a provider that is already failing.
 *
 * `execute` is the generic path and treats any non-throwing return as a
 * success. `executeResult` is the Result-aware one, and it is the path a
 * workflow step takes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCircuitBreaker } from "./circuit-breaker";
import { ok, err } from "./core";

describe("circuit breaker gaps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays CLOSED no matter how much time passes without failures", () => {
    const breaker = createCircuitBreaker("payments", { resetTimeout: 1000 });

    vi.advanceTimersByTime(10_000);

    // getState() asks whether an OPEN breaker should lapse to HALF_OPEN. One
    // that never opened must not be walked through that transition.
    expect(breaker.getState()).toBe("CLOSED");
  });

  it("counts a returned err as a failure", async () => {
    const breaker = createCircuitBreaker("payments", { failureThreshold: 1 });

    const result = await breaker.executeResult(async () => err("DECLINED"));

    expect(result.ok).toBe(false);
    expect(breaker.getState()).toBe("OPEN");
    expect(breaker.getStats().failureCount).toBe(1);
  });

  it("counts a thrown error as a failure and rethrows it", async () => {
    const breaker = createCircuitBreaker("payments", { failureThreshold: 1 });

    await expect(
      breaker.executeResult(async () => {
        throw new Error("socket hang up");
      })
    ).rejects.toThrow("socket hang up");

    // A provider that drops the connection has failed just as surely as one
    // that returns a refusal.
    expect(breaker.getState()).toBe("OPEN");
    expect(breaker.getStats().failureCount).toBe(1);
  });

  it("counts a returned ok as a success", async () => {
    const breaker = createCircuitBreaker("payments", { failureThreshold: 1 });

    const result = await breaker.executeResult(async () => ok("charged"));

    expect(result.ok).toBe(true);
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.getStats().successCount).toBe(1);
  });

  it("refuses further calls with a CircuitOpenError once OPEN", async () => {
    const breaker = createCircuitBreaker("payments", {
      failureThreshold: 1,
      resetTimeout: 30_000,
    });
    await breaker.executeResult(async () => err("DECLINED"));

    const attempted = vi.fn(async () => ok("charged"));
    const result = await breaker.executeResult(attempted);

    expect(result.ok).toBe(false);
    // The point of the breaker is that the provider is not called at all.
    expect(attempted).not.toHaveBeenCalled();
  });

  it("lapses from OPEN to HALF_OPEN once the reset timeout passes", async () => {
    const breaker = createCircuitBreaker("payments", {
      failureThreshold: 1,
      resetTimeout: 1000,
    });

    await breaker.executeResult(async () => err("DECLINED"));
    expect(breaker.getState()).toBe("OPEN");

    vi.advanceTimersByTime(999);
    expect(breaker.getState()).toBe("OPEN");

    vi.advanceTimersByTime(2);
    expect(breaker.getState()).toBe("HALF_OPEN");
  });

  it("reopens on the first failure while HALF_OPEN", async () => {
    const breaker = createCircuitBreaker("payments", {
      failureThreshold: 1,
      resetTimeout: 1000,
    });

    await breaker.executeResult(async () => err("DECLINED"));
    vi.advanceTimersByTime(1001);
    expect(breaker.getState()).toBe("HALF_OPEN");

    await breaker.executeResult(async () => err("DECLINED"));

    // A single probe failure means the provider is still down; it does not
    // need to reach the threshold again.
    expect(breaker.getState()).toBe("OPEN");
  });
});
