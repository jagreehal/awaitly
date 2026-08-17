/**
 * Per-dependency policies: retry, timeout, fallback.
 *
 * Policies wrap dependency functions in the deps object so call sites stay
 * clean. Each test locks both runtime semantics and the error-union math.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type AsyncResult,
  err,
  fallback,
  isUnexpectedError,
  ok,
  retry,
  run,
  timeout,
  UnexpectedError,
} from "./index";
import { TimeoutError } from "../errors";
import { Duration } from "../duration";
import { createWorkflow } from "../workflow";

type User = { id: string; name: string };
type UserNotFound = { type: "USER_NOT_FOUND"; userId: string };
type ChargeDeclined = { type: "CHARGE_DECLINED"; reason: string };

const flaky = (failures: number) => {
  let calls = 0;
  const fn = async (id: string): AsyncResult<User, UserNotFound> => {
    calls++;
    if (calls <= failures) return err({ type: "USER_NOT_FOUND", userId: id });
    return ok({ id, name: `after-${calls}` });
  };
  return { fn, calls: () => calls };
};

describe("retry", () => {
  it("succeeds after transient failures without changing the error union", async () => {
    const { fn, calls } = flaky(2);
    const resilient = retry(fn, { attempts: 3 });

    const result = await resilient("u-1");
    expect(result).toEqual({ ok: true, value: { id: "u-1", name: "after-3" } });
    expect(calls()).toBe(3);

    if (!result.ok) {
      expectTypeOf(result.error).toEqualTypeOf<UserNotFound>();
    }
  });

  it("returns the last typed error when attempts are exhausted", async () => {
    const { fn, calls } = flaky(10);
    const result = await retry(fn, { attempts: 2 })("u-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ type: "USER_NOT_FOUND", userId: "u-1" });
    }
    expect(calls()).toBe(2);
  });

  it("retries untagged errors returned through Result", async () => {
    let calls = 0;
    const fn = async (): AsyncResult<number, Error> => {
      calls++;
      return calls === 1 ? err(new Error("temporary")) : ok(42);
    };

    await expect(retry(fn, { attempts: 2 })()).resolves.toEqual({
      ok: true,
      value: 42,
    });
    expect(calls).toBe(2);
  });

  it("does not retry throwing plain functions by default", async () => {
    let calls = 0;
    const throwing = async () => {
      calls++;
      throw new Error(`boom-${calls}`);
    };

    await expect(retry(throwing, { attempts: 3 })()).rejects.toThrow("boom-1");
    expect(calls).toBe(1);
  });

  it("retries throws when retryIf returns true", async () => {
    let calls = 0;
    const throwing = async () => {
      calls++;
      throw new Error(`boom-${calls}`);
    };

    await expect(
      retry(throwing, { attempts: 3, retryIf: () => true })()
    ).rejects.toThrow("boom-3");
    expect(calls).toBe(3);
  });

  it("stops early when retryIf returns false", async () => {
    const { fn, calls } = flaky(10);
    const result = await retry(fn, {
      attempts: 5,
      retryIf: (failure) => (failure as UserNotFound).type !== "USER_NOT_FOUND",
    })("u-1");

    expect(result.ok).toBe(false);
    expect(calls()).toBe(1);
  });

  it("reports each re-attempt via onRetry", async () => {
    const { fn } = flaky(2);
    const seen: number[] = [];
    await retry(fn, { attempts: 3, onRetry: ({ attempt }) => seen.push(attempt) })("u-1");
    expect(seen).toEqual([1, 2]);
  });

  it("normalizes plain values to ok()", async () => {
    const add = (a: number, b: number) => a + b;
    const result = await retry(add, { attempts: 2 })(2, 3);
    expect(result).toEqual({ ok: true, value: 5 });
  });
});

describe("timeout", () => {
  const slowUser = async (id: string): AsyncResult<User, UserNotFound> => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return ok({ id, name: "slow" });
  };

  it("passes fast results through unchanged", async () => {
    const fast = async (id: string): AsyncResult<User, UserNotFound> => ok({ id, name: "fast" });
    const result = await timeout(fast, 1000)("u-1");
    expect(result).toEqual({ ok: true, value: { id: "u-1", name: "fast" } });
  });

  it("returns err(TimeoutError) when the deadline passes", async () => {
    const result = await timeout(slowUser, 10)("u-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(TimeoutError);
      expectTypeOf(result.error).toEqualTypeOf<UserNotFound | TimeoutError>();
    }
  });

  it("names the operation after the wrapped function", async () => {
    const result = await timeout(slowUser, 10)("u-1");
    if (!result.ok && result.error instanceof TimeoutError) {
      expect(result.error.operation).toBe("slowUser");
    }
  });
});

describe("fallback", () => {
  const failUser = async (id: string): AsyncResult<User, UserNotFound> =>
    err({ type: "USER_NOT_FOUND", userId: id });

  it("consumes the base error union entirely", async () => {
    const recovered = fallback(failUser, (failure, id) => ({ id, name: `guest-${id}` }));
    const result = await recovered("u-9");

    expect(result).toEqual({ ok: true, value: { id: "u-9", name: "guest-u-9" } });
    if (!result.ok) {
      // handler returns a plain value — no typed errors remain
      expectTypeOf(result.error).toEqualTypeOf<never>();
    }
  });

  it("receives the typed failure and original arguments", async () => {
    const seen: unknown[] = [];
    await fallback(failUser, (failure, id) => {
      seen.push(failure, id);
      return null;
    })("u-9");

    expect(seen).toEqual([{ type: "USER_NOT_FOUND", userId: "u-9" }, "u-9"]);
  });

  it("wraps thrown failures as UnexpectedError before the handler sees them", async () => {
    const throwing = async (): Promise<User> => {
      throw new Error("db down");
    };
    let seen: unknown;
    await fallback(throwing, (failure) => {
      seen = failure;
      return null;
    })();

    expect(isUnexpectedError(seen)).toBe(true);
  });

  it("surfaces the handler's own typed errors", async () => {
    const charge = async (_amount: number): AsyncResult<{ txId: string }, ChargeDeclined> =>
      err({ type: "CHARGE_DECLINED", reason: "limit" });
    const backup = async (): AsyncResult<{ txId: string }, { type: "BACKUP_DOWN" }> =>
      err({ type: "BACKUP_DOWN" });

    const result = await fallback(charge, () => backup())(100);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ type: "BACKUP_DOWN" });
    }
  });
});

describe("composition", () => {
  it("retry(timeout(fn)) unions TimeoutError and retries timeouts", async () => {
    let calls = 0;
    const sometimesSlow = async (id: string): AsyncResult<User, UserNotFound> => {
      calls++;
      if (calls < 3) await new Promise((resolve) => setTimeout(resolve, 50));
      return ok({ id, name: `call-${calls}` });
    };

    const resilient = retry(timeout(sometimesSlow, 10), { attempts: 3 });
    const result = await resilient("u-1");

    expect(result.ok).toBe(true);
    expect(calls).toBe(3);
    if (!result.ok) {
      expectTypeOf(result.error).toEqualTypeOf<UserNotFound | TimeoutError>();
    }
  });
});

describe("integration with run(deps, fn)", () => {
  it("policies declared in the deps literal flow into the inferred union", async () => {
    const getUser = async (id: string): AsyncResult<User, UserNotFound> =>
      ok({ id, name: "Alice" });
    const { fn: charge } = flaky(1);

    const names: string[] = [];
    const result = await run(
      {
        getUser,
        charge: retry(timeout(charge, 1000), { attempts: 2 }),
      },
      async (s) => {
        const user = await s.getUser("u-1");
        const charged = await s.charge(user.id);
        return charged.name;
      },
      {
        onEvent: (event) => {
          if (event.type === "step_start") names.push(event.name ?? "");
        },
      }
    );

    expect(result).toEqual({ ok: true, value: "after-2" });
    // the policy preserved the dep's function name for events/diagrams
    expect(names).toEqual(["getUser", "charge"]);
    if (!result.ok) {
      expectTypeOf(result.error).toEqualTypeOf<
        UserNotFound | TimeoutError | UnexpectedError
      >();
    }
  });

  it("works identically inside createWorkflow steps", async () => {
    const { fn: charge, calls } = flaky(2);
    const workflow = createWorkflow("pay", {
      charge: retry(charge, { attempts: 3 }),
    });

    const result = await workflow.run(async ({ steps }) => steps.charge("u-1"));

    expect(result.ok).toBe(true);
    expect(calls()).toBe(3);
  });
});

describe("retry option vocabulary and validation", () => {
  const flaky = (failures: number) => {
    let calls = 0;
    const fn = async (): AsyncResult<"done", "FETCH_ERROR"> => {
      calls += 1;
      return calls > failures ? ok("done") : err("FETCH_ERROR");
    };
    return Object.assign(fn, { calls: () => calls });
  };

  it("accepts initialDelay as an alias for delay", async () => {
    const fn = flaky(1);
    const result = await retry(fn, { attempts: 2, initialDelay: 1 })();
    expect(result).toEqual({ ok: true, value: "done" });
    expect(fn.calls()).toBe(2);
  });

  it("accepts shouldRetry as an alias for retryIf", async () => {
    const fn = flaky(5);
    const result = await retry(fn, {
      attempts: 3,
      shouldRetry: (failure) => failure !== "FETCH_ERROR",
    })();
    expect(result).toEqual({ ok: false, error: "FETCH_ERROR" });
    expect(fn.calls()).toBe(1); // stopped after the predicate said no
  });

  it("passes the attempt number to retryIf", async () => {
    const seen: number[] = [];
    const fn = flaky(5);
    await retry(fn, {
      attempts: 3,
      retryIf: (_failure, attempt) => {
        seen.push(attempt);
        return true;
      },
    })();
    expect(seen).toEqual([1, 2, 3]);
  });

  it("rejects invalid attempts at construction, not at call time", () => {
    expect(() => retry(flaky(0), { attempts: Number.NaN })).toThrow(
      /attempts must be a finite number >= 1/
    );
    expect(() => retry(flaky(0), { attempts: 0 })).toThrow(/attempts/);
    expect(() => retry(flaky(0), { attempts: Infinity })).toThrow(/attempts/);
  });

  it("rejects invalid delays", () => {
    expect(() => retry(flaky(0), { attempts: 2, delay: Number.NaN })).toThrow(
      /delay must be a finite, non-negative duration/
    );
    expect(() => retry(flaky(0), { attempts: 2, maxDelay: -1 })).toThrow(/maxDelay/);
  });

  it("accepts Duration.infinity as an explicit maxDelay", () => {
    expect(() =>
      retry(flaky(0), { attempts: 2, maxDelay: Duration.infinity })
    ).not.toThrow();
  });

  it("forwards delay and retryIf through workflow step.retry", async () => {
    const fn = flaky(5);
    const workflow = createWorkflow("retry-aliases", { fn });

    const result = await workflow.run(async ({ step, deps }) =>
      step.retry("fn", () => deps.fn(), {
        attempts: 3,
        delay: 0,
        retryIf: () => false,
      })
    );

    expect(result).toEqual({ ok: false, error: "FETCH_ERROR" });
    expect(fn.calls()).toBe(1);
  });

  it("forwards delay and retryIf through core step.retry", async () => {
    const fn = flaky(5);

    const result = await run(async ({ step }) =>
      step.retry("fn", fn, {
        attempts: 3,
        delay: 0,
        retryIf: () => false,
      })
    );

    expect(result).toEqual({ ok: false, error: "FETCH_ERROR" });
    expect(fn.calls()).toBe(1);
  });
});
