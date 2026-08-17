/**
 * Clock seam: systemClock abort, test-clock parking, and control-flow
 * waits (retry / sleep / timeout) driven by createTestClock.
 */
import { describe, expect, it } from "vitest";
import {
  ok,
  err,
  run,
  retry,
  timeout,
  TimeoutError,
  isStepTimeoutError,
} from "./index";
import { retryAsync } from "./core";
import { createTestClock } from "./testing";
import { systemClock } from "./clock";
import { createCircuitBreaker } from "./circuit-breaker";
import type { AsyncResult } from "./index";

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

const flush = async (): Promise<void> => {
  for (let i = 0; i < 25; i++) await tick();
};

describe("systemClock", () => {
  it("resolves sleep immediately when the signal is already aborted", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const start = Date.now();
    await systemClock.sleep(60_000, ctl.signal);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("resolves sleep when the signal aborts mid-wait", async () => {
    const ctl = new AbortController();
    const pending = systemClock.sleep(60_000, ctl.signal);
    ctl.abort();
    await pending;
  });
});

describe("createTestClock sleep", () => {
  it("parks until advance reaches the deadline", async () => {
    const clock = createTestClock(0);
    let done = false;
    const pending = clock.sleep(1000).then(() => {
      done = true;
    });
    expect(done).toBe(false);
    clock.advance(999);
    expect(done).toBe(false);
    clock.advance(1);
    await pending;
    expect(done).toBe(true);
    expect(clock.now()).toBe(1000);
  });

  it("resolves pending sleep on abort without advancing", async () => {
    const clock = createTestClock(0);
    const ctl = new AbortController();
    const pending = clock.sleep(1000, ctl.signal);
    ctl.abort();
    await pending;
    expect(clock.now()).toBe(0);
  });
});

describe("clock-driven retry / timeout / sleep", () => {
  it("retry delays complete via advance, not wall time", async () => {
    const clock = createTestClock(0);
    let calls = 0;
    const flaky = async (): AsyncResult<number, "TRANSIENT"> => {
      calls++;
      return calls < 3 ? err("TRANSIENT") : ok(1);
    };

    const pending = retry(flaky, {
      attempts: 3,
      delay: 1000,
      backoff: "fixed",
      clock,
    })();

    await flush();
    expect(calls).toBe(1);
    clock.advance(1000);
    await flush();
    expect(calls).toBe(2);
    clock.advance(1000);
    await expect(pending).resolves.toEqual({ ok: true, value: 1 });
    expect(calls).toBe(3);
  });

  it("retryAsync retries untagged errors returned through Result", async () => {
    const clock = createTestClock(0);
    let calls = 0;
    const pending = retryAsync(
      async () => {
        calls++;
        return calls === 1 ? err(new Error("temporary")) : ok(42);
      },
      { attempts: 2, initialDelay: 100, jitter: false, clock }
    );

    await flush();
    clock.advance(100);
    await expect(pending).resolves.toEqual({ ok: true, value: 42 });
    expect(calls).toBe(2);
  });

  it("step.retry retries untagged errors returned through Result", async () => {
    const clock = createTestClock(0);
    let calls = 0;
    const pending = run(
      async ({ step }) =>
        step.retry(
          "flaky",
          async () => {
            calls++;
            return calls === 1 ? err(new Error("temporary")) : ok(42);
          },
          { attempts: 2, delay: 100, jitter: false }
        ),
      { clock }
    );

    await flush();
    clock.advance(100);
    await expect(pending).resolves.toEqual({ ok: true, value: 42 });
    expect(calls).toBe(2);
  });

  it("timeout fires when the test clock advances past the deadline", async () => {
    const clock = createTestClock(0);
    const hang = (): Promise<never> => new Promise(() => {});
    const pending = timeout(hang, 500, { clock })();

    await flush();
    clock.advance(499);
    clock.advance(1);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(TimeoutError);
    }
  });

  it("run({ clock }) drives step.sleep", async () => {
    const clock = createTestClock(0);
    let slept = false;
    const pending = run(
      async ({ step }) => {
        await step.sleep("wait", "1s");
        slept = true;
        return "done";
      },
      { clock }
    );

    await flush();
    expect(slept).toBe(false);
    clock.advance(1000);
    const result = await pending;
    expect(result).toEqual({ ok: true, value: "done" });
    expect(slept).toBe(true);
  });

  it("run({ clock }) drives step.withTimeout", async () => {
    const clock = createTestClock(0);
    const pending = run(
      async ({ step }) =>
        step.withTimeout("hang", () => new Promise<string>(() => {}), { ms: 500 }),
      { clock }
    );

    await flush();
    clock.advance(500);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isStepTimeoutError(result.error)).toBe(true);
    }
  });
});

describe("circuit breaker clock", () => {
  it("transitions OPEN to HALF_OPEN when the test clock advances resetTimeout", async () => {
    const clock = createTestClock(0);
    const breaker = createCircuitBreaker("api", {
      failureThreshold: 1,
      resetTimeout: 30_000,
      clock,
    });

    await expect(
      breaker.execute(() => {
        throw new Error("down");
      })
    ).rejects.toThrow();
    expect(breaker.getState()).toBe("OPEN");

    clock.advance(29_999);
    expect(breaker.getState()).toBe("OPEN");
    clock.advance(1);
    expect(breaker.getState()).toBe("HALF_OPEN");
  });
});
