/**
 * Companion to the Recipes page (apps/docs-site/src/content/docs/reference/quick-reference.md).
 *
 * Every snippet on that page comes from here. The page is the entry point of the
 * docs, so a snippet that does not compile, or that quietly does something other
 * than what the prose claims, is worse than no page at all. Four such bugs shipped
 * before this file existed: a saga `compensate` one-liner that did not typecheck,
 * a rollback failure reported as success, a `key` that cached nothing without a
 * `cache`, and a resume that replayed the recorded failure.
 *
 * These overlap with the unit tests on purpose. The unit tests answer "does the
 * library work". This file answers "does the documented code do what we say".
 * When you change a recipe here, update the page, and vice versa.
 */
import { describe, expect, it } from "vitest";

import {
  allAsync,
  allSettledAsync,
  anyAsync,
  createCircuitBreaker,
  createWorkflow,
  deserializeResumeState,
  err,
  fallback,
  isCircuitOpenError,
  isTimeoutError,
  isUnexpectedError,
  isWorkflowCancelled,
  match,
  ok,
  processInBatches,
  retry,
  run,
  serializeResumeState,
  singleflight,
  timeout,
  type AsyncResult,
  type WorkflowFn,
} from "./index";
import { createSagaWorkflow, isSagaCompensationError } from "./saga";

type User = { id: string; name: string };
type Order = { id: number; total: number };

const getUser = async (
  id: string
): AsyncResult<User, "NOT_FOUND" | "VALIDATION_ERROR"> => {
  if (id === "") return err("VALIDATION_ERROR");
  return id === "1" ? ok({ id: "1", name: "Alice" }) : err("NOT_FOUND");
};

const getOrders = async (_userId: string): AsyncResult<Order[], "FETCH_ERROR"> =>
  ok([{ id: 1, total: 99.99 }]);

/** Fails `failures` times, then succeeds. Lets a recipe prove a retry ran. */
const flaky = (failures: number) => {
  let calls = 0;
  const fn = async (_userId?: string): AsyncResult<Order[], "FETCH_ERROR"> => {
    calls += 1;
    return calls > failures ? ok([{ id: 1, total: 99.99 }]) : err("FETCH_ERROR");
  };
  return Object.assign(fn, { calls: () => calls });
};

const slow = async (ms: number): AsyncResult<"done", never> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return ok("done");
};

// ============================================================================
// Start here
// ============================================================================

describe("recipes: start here", () => {
  it("returns a typed error instead of throwing", async () => {
    expect(await getUser("1")).toEqual({
      ok: true,
      value: { id: "1", name: "Alice" },
    });
    expect(await getUser("2")).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("chains calls without an if-check after every one", async () => {
    const result = await run({ getUser, getOrders }, async (s) => {
      const user = await s.getUser("1");
      const orders = await s.getOrders(user.id);
      return { user, orders };
    });

    expect(result.ok).toBe(true);

    // A failing step exits the run, so getOrders never executes.
    const missing = await run({ getUser, getOrders }, async (s) => {
      const user = await s.getUser("404");
      return s.getOrders(user.id);
    });
    expect(missing).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("accepts a plain throwing function as a dep", async () => {
    const parseConfig = async (raw: string) => JSON.parse(raw) as { port: number };

    const good = await run({ parseConfig }, async (s) => s.parseConfig('{"port":8080}'));
    expect(good).toEqual({ ok: true, value: { port: 8080 } });

    const bad = await run({ parseConfig }, async (s) => s.parseConfig("not json"));
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(isUnexpectedError(bad.error)).toBe(true);
    if (!isUnexpectedError(bad.error)) return;
    expect(bad.error.cause).toBeInstanceOf(SyntaxError);
  });
});

describe("recipes: reading the result at the boundary", () => {
  const failing = () =>
    run({ getUser, getOrders }, async (s) => {
      const user = await s.getUser("404");
      return { user, orders: await s.getOrders(user.id) };
    });

  it("dispatches one arm per error with match", async () => {
    const result = await failing();
    const seen: string[] = [];

    match(result, {
      ok: () => seen.push("ok"),
      NOT_FOUND: () => seen.push("not-found"),
      VALIDATION_ERROR: () => seen.push("bad-input"),
      FETCH_ERROR: () => seen.push("fetch"),
      UnexpectedError: () => seen.push("unexpected"),
    });

    expect(seen).toEqual(["not-found"]);
  });

  it("works as an expression when the ok arm is annotated", async () => {
    const result = await failing();
    type Response = { status: number; body: unknown };

    // Without the annotation on `ok`, TypeScript locks the return type to the
    // first arm and rejects every sibling that puts a string in `body`.
    const response = match(result, {
      ok: (value): Response => ({ status: 200, body: value }),
      NOT_FOUND: () => ({ status: 404, body: "No such user" }),
      VALIDATION_ERROR: () => ({ status: 400, body: "Bad input" }),
      FETCH_ERROR: () => ({ status: 502, body: "Upstream failed" }),
      UnexpectedError: () => ({ status: 500, body: "Internal error" }),
    });

    expect(response).toEqual({ status: 404, body: "No such user" });
  });

  it("narrows on result.ok before touching result.error", async () => {
    const result = await failing();

    const status = (): number => {
      if (result.ok) return 200;
      if (isUnexpectedError(result.error)) return 500;
      switch (result.error) {
        case "NOT_FOUND":
          return 404;
        case "VALIDATION_ERROR":
          return 400;
        case "FETCH_ERROR":
          return 502;
      }
    };

    expect(status()).toBe(404);
    // The trap the page warns about: isUnexpectedError takes the error, never
    // the Result. Passing the Result compiles and is false every time.
    expect(isUnexpectedError(result)).toBe(false);
  });
});

// ============================================================================
// Make it survive a bad day
// ============================================================================

describe("recipes: resilience", () => {
  it("retries every call to one dependency", async () => {
    const dep = flaky(2);
    const result = await run(
      { getUser, getOrders: retry(dep, { attempts: 3, delay: 1, backoff: "exponential" }) },
      async (s) => {
        const user = await s.getUser("1");
        return s.getOrders(user.id);
      }
    );

    expect(result.ok).toBe(true);
    expect(dep.calls()).toBe(3);
  });

  it("propagates the original error once attempts are exhausted", async () => {
    const doomed = flaky(99);
    const result = await run(
      { getOrders: retry(doomed, { attempts: 2, delay: 1 }) },
      async (s) => s.getOrders("1")
    );

    expect(result).toEqual({ ok: false, error: "FETCH_ERROR" });
    expect(doomed.calls()).toBe(2);
  });

  it("gives a dependency a deadline", async () => {
    const result = await run({ slow: timeout(slow, 10) }, async (s) => s.slow(200));
    expect(result.ok).toBe(false);
    expect(!result.ok && isTimeoutError(result.error)).toBe(true);

    const fast = await run({ slow: timeout(slow, 200) }, async (s) => s.slow(1));
    expect(fast).toEqual({ ok: true, value: "done" });
  });

  it("consumes a dependency's errors with a fallback", async () => {
    const dep = flaky(99);
    let seen: unknown;

    const result = await run(
      {
        getOrders: fallback(dep, (failure) => {
          seen = failure;
          return [] as Order[];
        }),
      },
      async (s) => s.getOrders("1")
    );

    expect(result).toEqual({ ok: true, value: [] });
    expect(seen).toBe("FETCH_ERROR");
  });

  it("takes options for one call from the second callback argument", async () => {
    const dep = flaky(1);
    const result = await run({ getUser, getOrders: dep }, async (s, { step }) => {
      const user = await s.getUser("1");
      const orders = await step("getOrders", () => dep(user.id), {
        retry: { attempts: 3, initialDelay: 1, backoff: "exponential" },
        timeout: { ms: 1000 }, // the { ms } object, not a bare number
      });
      return { user, orders };
    });

    expect(result.ok).toBe(true);
    expect(dep.calls()).toBe(2);
  });

  it("accepts either spelling of the retry options", async () => {
    const withPolicySpelling = flaky(1);
    const a = await run(
      { getOrders: retry(withPolicySpelling, { attempts: 2, delay: 1 }) },
      async (s) => s.getOrders("1")
    );

    const withStepSpelling = flaky(1);
    const b = await run(
      { getOrders: retry(withStepSpelling, { attempts: 2, initialDelay: 1 }) },
      async (s) => s.getOrders("1")
    );

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(withPolicySpelling.calls()).toBe(2);
    expect(withStepSpelling.calls()).toBe(2);
  });
});

// ============================================================================
// Do several things at once
// ============================================================================

describe("recipes: concurrency", () => {
  it("runs independent calls together", async () => {
    const both = await allAsync([getUser("1"), getOrders("1")]);
    expect(both.ok).toBe(true);

    const failover = await anyAsync([getUser("404"), getUser("1")]);
    expect(failover).toEqual({ ok: true, value: { id: "1", name: "Alice" } });

    const settled = await allSettledAsync([getUser("404"), getUser(""), getUser("1")]);
    expect(settled.ok).toBe(false);
    expect(!settled.ok && settled.error.map((e) => e.error)).toEqual([
      "NOT_FOUND",
      "VALIDATION_ERROR",
    ]);
  });

  it("names each branch with step.all", async () => {
    const result = await run({ getUser, getOrders }, async (s, { step }) => {
      const { user, orders } = await step.all("fetchAll", {
        user: () => getUser("1"),
        orders: () => getOrders("1"),
      });
      return { user, orders };
    });

    expect(result.ok).toBe(true);
  });

  it("caps concurrency when processing a large list", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `user-${i}`);
    let peak = 0;
    let inFlight = 0;

    const load = async (id: string): AsyncResult<string, "FETCH_ERROR"> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return ok(id.toUpperCase());
    };

    const result = await processInBatches(ids, load, { batchSize: 10, concurrency: 3 });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.length).toBe(25);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("collapses concurrent duplicate calls with singleflight", async () => {
    let calls = 0;
    const fetchUser = async (id: string): AsyncResult<{ id: string }, never> => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return ok({ id });
    };
    const once = singleflight(fetchUser, { key: (id) => `user:${id}` });

    const [a, b, c] = await Promise.all([once("1"), once("1"), once("1")]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);

    // Sequential calls are not deduped. Singleflight shares in-flight work; it
    // is not a cache.
    await once("1");
    expect(calls).toBe(2);
  });

  it("fails fast once the circuit is open", async () => {
    let calls = 0;
    let healthy = false;
    const chargeApi = async (): AsyncResult<{ id: string }, "DECLINED"> => {
      calls += 1;
      return healthy ? ok({ id: "ch_1" }) : err("DECLINED");
    };
    const breaker = createCircuitBreaker("payment-api", {
      failureThreshold: 3,
      resetTimeout: 50,
    });

    for (let i = 0; i < 3; i++) await breaker.executeResult(chargeApi);
    expect(calls).toBe(3);

    const blocked = await breaker.executeResult(chargeApi);
    expect(!blocked.ok && isCircuitOpenError(blocked.error)).toBe(true);
    expect(calls).toBe(3); // the call never reached the API

    healthy = true;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await breaker.executeResult(chargeApi)).ok).toBe(true);
    expect(calls).toBe(4);
  });
});

// ============================================================================
// Reach for a workflow
// ============================================================================

describe("recipes: workflows", () => {
  it("caches a keyed step when a cache is configured", async () => {
    let charges = 0;
    const charge = async (_amount: number): AsyncResult<{ id: string }, "DECLINED"> => {
      charges += 1;
      return ok({ id: `ch_${charges}` });
    };

    const cache = new Map();
    const checkout = createWorkflow("checkout", { charge }, { cache });

    const first = await checkout.run(async ({ step, deps }) =>
      step("charge", () => deps.charge(100), { key: "order-1" })
    );
    const second = await checkout.run(async ({ step, deps }) =>
      step("charge", () => deps.charge(100), { key: "order-1" })
    );

    expect(charges).toBe(1);
    expect(first).toEqual(second);
  });

  it("cancels from outside and skips the remaining steps", async () => {
    let emailsSent = 0;
    const fetchUser = async (): AsyncResult<{ email: string }, never> => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return ok({ email: "alice@example.com" });
    };
    const sendEmail = async (_to: string): AsyncResult<"sent", never> => {
      emailsSent += 1;
      return ok("sent");
    };

    const controller = new AbortController();
    const workflow = createWorkflow(
      "notify",
      { fetchUser, sendEmail },
      { signal: controller.signal }
    );

    const pending = workflow.run(async ({ step, deps }) => {
      const user = await step("fetchUser", () => deps.fetchUser(), { key: "user" });
      await step("sendEmail", () => deps.sendEmail(user.email), { key: "email" });
      return user;
    });

    setTimeout(() => controller.abort("user navigated away"), 5);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(!result.ok && isWorkflowCancelled(result.cause)).toBe(true);
    expect(emailsSent).toBe(0);
  });

  it("rolls back completed steps when a later one fails", async () => {
    const log: string[] = [];
    const charge = async (_amount: number): AsyncResult<{ id: string }, "DECLINED"> => {
      log.push("charge");
      return ok({ id: "ch_1" });
    };
    const refund = async (_id: string): AsyncResult<"refunded", never> => {
      log.push("refund");
      return ok("refunded");
    };
    const reserve = async (): AsyncResult<{ id: string }, "OUT_OF_STOCK"> => {
      log.push("reserve");
      return err("OUT_OF_STOCK");
    };

    const saga = createSagaWorkflow("checkout", { charge, refund, reserve });
    const result = await saga.run(async ({ step, deps }) => {
      const payment = await step("charge", () => deps.charge(100), {
        compensate: (p) => deps.refund(p.id),
      });
      const reservation = await step("reserve", () => deps.reserve());
      return { payment, reservation };
    });

    expect(result).toEqual({ ok: false, error: "OUT_OF_STOCK" });
    expect(log).toEqual(["charge", "reserve", "refund"]);
  });

  it("reports a rollback that fails rather than swallowing it", async () => {
    const charge = async (): AsyncResult<{ id: string }, "DECLINED"> => ok({ id: "ch_1" });
    const reserve = async (): AsyncResult<{ id: string }, "OUT_OF_STOCK"> =>
      err("OUT_OF_STOCK");
    const refund = async (_id: string): AsyncResult<"refunded", "REFUND_FAILED"> =>
      err("REFUND_FAILED");

    const saga = createSagaWorkflow("checkout", { charge, reserve, refund });
    const result = await saga.run(async ({ step, deps }) => {
      await step("charge", () => deps.charge(), {
        compensate: (p) => deps.refund(p.id),
      });
      return step("reserve", () => deps.reserve());
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSagaCompensationError(result.error)).toBe(true);
    if (!isSagaCompensationError(result.error)) return;
    expect(result.error.originalError).toBe("OUT_OF_STOCK");
    expect(result.error.compensationErrors).toEqual([
      { stepName: "charge", error: "REFUND_FAILED" },
    ]);
  });

  it("saves and resumes, and replays recorded failures until you drop them", async () => {
    const store = new Map<string, string>();
    const calls: string[] = [];
    let gatewayUp = false;

    const charge = async (_amount: number): AsyncResult<{ id: string }, "GATEWAY_DOWN"> => {
      calls.push("charge");
      return gatewayUp ? ok({ id: "ch_1" }) : err("GATEWAY_DOWN");
    };
    const reserveStock = async (): AsyncResult<{ id: string }, never> => {
      calls.push("reserveStock");
      return ok({ id: "res_1" });
    };

    const deps = { reserveStock, charge };
    const checkout = createWorkflow("checkout", deps);

    type Checkout = { reservation: { id: string }; payment: { id: string } };
    const flow: WorkflowFn<Checkout, "GATEWAY_DOWN", typeof deps> = async ({
      step,
      deps,
    }) => {
      const reservation = await step("reserveStock", () => deps.reserveStock(), {
        key: "res",
      });
      const payment = await step("charge", () => deps.charge(100), { key: "pay" });
      return { reservation, payment };
    };

    const first = await checkout.runWithState(flow);
    expect(first.result).toEqual({ ok: false, error: "GATEWAY_DOWN" });
    expect(calls).toEqual(["reserveStock", "charge"]);

    // steps is a Map, so JSON.stringify silently writes {}. Round-trip through
    // the serialize helpers instead.
    expect(first.resumeState.steps).toBeInstanceOf(Map);
    expect(JSON.stringify(first.resumeState)).toBe('{"steps":{}}');
    store.set("order-1", JSON.stringify(serializeResumeState(first.resumeState)));

    const loaded = deserializeResumeState(JSON.parse(store.get("order-1")!));
    expect([...loaded.steps.keys()]).toEqual(["res", "pay"]);

    // The failed step was recorded too, so a naive resume replays the failure.
    gatewayUp = true;
    calls.length = 0;
    const naive = await checkout.run(flow, { resumeState: loaded });
    expect(naive.ok).toBe(false);
    expect(calls).toEqual([]);

    // Drop the failures and the resume does what you wanted.
    const retryable = {
      steps: new Map([...loaded.steps].filter(([, entry]) => entry.result.ok)),
    };
    calls.length = 0;
    const resumed = await checkout.run(flow, { resumeState: retryable });
    expect(resumed.ok).toBe(true);
    expect(calls).toEqual(["charge"]);
  });
});
