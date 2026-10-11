import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import * as native from "@aws/durable-execution-sdk-js";
import * as nativeTesting from "@aws/durable-execution-sdk-js-testing";
import { LocalDurableTestRunner, WaitingOperationStatus } from "./testing";
import * as testing from "./testing";
import { err, ok, type AsyncResult, type Result } from "awaitly";
import * as dropIn from "./index";
import {
  durableFunction,
  validateEvent,
  withDurableExecution,
  type InvalidEventError,
  type DurableContext,
  type DurablePromise,
  type HandlerEvent,
  type HandlerResult,
} from "./index";

type User = { id: string; name: string };

/** Counts real executions, so retries and replays are observable. */
function createServices() {
  const calls = { getUser: 0, charge: 0 };
  return {
    calls,
    getUser: async (id: string): AsyncResult<User, "NOT_FOUND"> => {
      calls.getUser += 1;
      return id === "missing" ? err("NOT_FOUND") : ok({ id, name: "Ada" });
    },
    charge: async (user: User): AsyncResult<{ receipt: string }, "DECLINED"> => {
      calls.charge += 1;
      return user.id === "broke" ? err("DECLINED") : ok({ receipt: `r-${user.id}` });
    },
  };
}

function checkoutHandler() {
  const services = createServices();
  const handler = withDurableExecution(async (event: { userId: string }, context) => {
    const user = await context.step("getUser", () => services.getUser(event.userId));
    if (!user.ok) return user;
    await context.wait("coolingOff", { seconds: 5 });
    return context.step("charge", () => services.charge(user.value));
  });
  return { handler, calls: services.calls };
}

beforeAll(async () => {
  await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
});

afterAll(async () => {
  await LocalDurableTestRunner.teardownTestEnvironment();
});

describe("drop-in", () => {
  it("re-exports every export of the native SDK", () => {
    for (const name of Object.keys(native)) {
      expect(dropIn, name).toHaveProperty(name);
    }
  });

  it("compiles handlers that relied on the native any-typed event", () => {
    // Switching the import must not break existing handlers.
    const handler = withDurableExecution(async (event, context) =>
      context.step("read", async () => event.userId.toUpperCase())
    );
    expectTypeOf(handler).toExtend<native.DurableLambdaHandler>();
  });

  it("keeps the native handler and context signatures", () => {
    expectTypeOf(withDurableExecution).parameter(0).toExtend<native.DurableExecutionHandler<never, unknown>>();
    expectTypeOf(withDurableExecution).returns.toExtend<native.DurableLambdaHandler>();
    withDurableExecution(async (_event: unknown, context) => {
      expectTypeOf(context).toEqualTypeOf<DurableContext>();
      return null;
    });
  });
});

describe("Result-returning steps", () => {
  it("checkpoints each step and returns the typed Result", async () => {
    const { handler, calls } = checkoutHandler();
    const execution = await new LocalDurableTestRunner({ handlerFunction: handler }).run({
      payload: { userId: "u1" },
    });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({ ok: true, value: { receipt: "r-u1" } });
    expect(calls).toEqual({ getUser: 1, charge: 1 });
  });

  it("records an expected failure once instead of retrying it", async () => {
    const { handler, calls } = checkoutHandler();
    const execution = await new LocalDurableTestRunner({ handlerFunction: handler }).run({
      payload: { userId: "broke" },
    });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({ ok: false, error: "DECLINED" });
    expect(calls.charge).toBe(1);
  });

  it("still retries a step that throws", async () => {
    let attempts = 0;
    const handler = withDurableExecution(async (_event: unknown, context) =>
      context.step(
        "callApi",
        async (): AsyncResult<string, never> => {
          attempts += 1;
          if (attempts < 3) throw new Error("ECONNRESET");
          return ok("done");
        },
        { retryStrategy: (_error, attempt) => ({ shouldRetry: attempt < 3, delay: { seconds: 1 } }) }
      )
    );

    const execution = await new LocalDurableTestRunner({ handlerFunction: handler }).run();

    expect(execution.getResult()).toEqual({ ok: true, value: "done" });
    expect(attempts).toBe(3);
  });

  it("replays completed steps after a callback suspends the execution", async () => {
    const services = createServices();
    const handler = withDurableExecution(async (event: { userId: string }, context) => {
      const user = await context.step("getUser", () => services.getUser(event.userId));
      if (!user.ok) return user;
      await context.waitForCallback("approve", async () => {}, { timeout: { hours: 1 } });
      return context.step("charge", () => services.charge(user.value));
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const pending = runner.run({ payload: { userId: "u2" } });
    const callback = await runner.getOperation("approve").waitForData(WaitingOperationStatus.SUBMITTED);
    await callback.sendCallbackSuccess(JSON.stringify("approved"));
    const execution = await pending;

    expect(execution.getResult()).toEqual({ ok: true, value: { receipt: "r-u2" } });
    expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);
    expect(services.calls).toEqual({ getUser: 1, charge: 1 });
  });

  it("stores step Results as JSON: values must be JSON-safe", async () => {
    // Native default serdes: what the workflow sees after a step is the JSON
    // round trip, on the first run as well as on replay.
    const handler = withDurableExecution(async (_event: unknown, context) => {
      const result = await context.step("stamp", async () => ok({ at: new Date(0) }));
      return result.ok ? typeof result.value.at : "error";
    });

    const execution = await new LocalDurableTestRunner({ handlerFunction: handler }).run();

    expect(execution.getResult()).toBe("string");
  });

  it("types the handler's event and its union of Results", () => {
    type Handler = ReturnType<typeof checkoutHandler>["handler"];

    expectTypeOf<HandlerEvent<Handler>>().toEqualTypeOf<{ userId: string }>();
    type Output = HandlerResult<Handler>;
    expectTypeOf<Output>().toExtend<Result<{ receipt: string }, "NOT_FOUND" | "DECLINED">>();
    // TypeScript unions the handler's returns: every failure a caller must handle.
    expectTypeOf<Extract<Output, { ok: false }>["error"]>().toEqualTypeOf<"NOT_FOUND" | "DECLINED">();
  });
});

describe("typed invoke", () => {
  const paymentHandler = withDurableExecution(async (event: { orderId: string; amount: number }, context) =>
    context.step("charge", async () =>
      event.amount > 100 ? err("DECLINED" as const) : ok({ receipt: `r-${event.orderId}` })
    )
  );
  const payments = durableFunction<typeof paymentHandler>("payments:live");

  it("checks the input and types the result from the target's handler", () => {
    withDurableExecution(async (_event: unknown, context) => {
      const receipt = context.invoke("pay", payments, { orderId: "o1", amount: 5 });
      expectTypeOf(receipt).toEqualTypeOf<DurablePromise<HandlerResult<typeof paymentHandler>>>();
      // @ts-expect-error amount must be a number
      void context.invoke("pay", payments, { orderId: "o1", amount: "5" });
      // A plain string still resolves to the native, untyped signature.
      expectTypeOf(context.invoke("pay", "payments:live", {})).toEqualTypeOf<DurablePromise<unknown>>();
      return null;
    });
  });

  it("invokes the branded function at runtime and returns its Result", async () => {
    const checkout = withDurableExecution(async (event: { orderId: string; amount: number }, context) =>
      context.invoke("pay", payments, event)
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: checkout });
    runner.registerDurableFunction("payments:live", paymentHandler);

    const paid = await runner.run({ payload: { orderId: "o1", amount: 5 } });
    expect(paid.getResult()).toEqual({ ok: true, value: { receipt: "r-o1" } });

    const declined = await runner.run({ payload: { orderId: "o2", amount: 500 } });
    expect(declined.getResult()).toEqual({ ok: false, error: "DECLINED" });
  });
});

describe("typed test runner", () => {
  const { handler: checkout } = checkoutHandler();

  it("re-exports every export of the native testing SDK", () => {
    for (const name of Object.keys(nativeTesting)) {
      expect(testing, name).toHaveProperty(name);
    }
  });

  it("infers the payload and result types from the handler", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: checkout });

    expectTypeOf(runner.run).toBeCallableWith({ payload: { userId: "u1" } });
    // @ts-expect-error the payload must match the event
    expectTypeOf(runner.run).toBeCallableWith({ payload: { userId: 1 } });
    // @ts-expect-error the payload is required
    expectTypeOf(runner.run).toBeCallableWith();

    const execution = await runner.run({ payload: { userId: "u1" } });
    expectTypeOf(execution.getResult()).toEqualTypeOf<HandlerResult<typeof checkout> | undefined>();
  });

  it("checks a registered handler against its durableFunction brand", () => {
    const payments = durableFunction<typeof checkout>("payments:live");
    const other = withDurableExecution(async (event: { sku: number }) => event.sku);
    const runner = new LocalDurableTestRunner({ handlerFunction: checkout });

    runner.registerDurableFunction(payments, checkout);
    // @ts-expect-error a different handler is not the one this ARN was branded with
    runner.registerDurableFunction(payments, other);
    runner.registerDurableFunction("untyped:live", other);
  });
});

describe("handlers without a payload", () => {
  const ping = withDurableExecution(async (_event: void, context) => context.step("pong", async () => ok("pong")));
  const pings = durableFunction<typeof ping>("ping:live");

  it("lets run() and invoke() omit the payload", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: ping });
    expectTypeOf(runner.run).toBeCallableWith();

    withDurableExecution(async (_event: unknown, context) => {
      expectTypeOf(context.invoke(pings)).toEqualTypeOf<DurablePromise<HandlerResult<typeof ping>>>();
      expectTypeOf(context.invoke("ping", pings)).toEqualTypeOf<DurablePromise<HandlerResult<typeof ping>>>();
      return null;
    });

    expect((await runner.run()).getResult()).toEqual({ ok: true, value: "pong" });
  });
});

describe("native runner compatibility", () => {
  it("keeps the native result generic", () => {
    const untyped = withDurableExecution(async (event, context) => context.step("n", async () => Number(event)));
    const runner = new LocalDurableTestRunner<number>({ handlerFunction: untyped });

    expectTypeOf(runner.run).toBeCallableWith({ payload: 1 });
    expectTypeOf<Awaited<ReturnType<typeof runner.run>>>().toEqualTypeOf<nativeTesting.TestResult<number>>();
    expectTypeOf(testing.CloudDurableTestRunner<number>).toBeConstructibleWith({ functionName: "f:live" });
  });
});

describe("validateEvent", () => {
  /** A minimal Standard Schema: { orderId: string, amount: number (string accepted) } -> parsed amount. */
  const OrderEvent = {
    "~standard": {
      version: 1 as const,
      vendor: "test",
      types: undefined as unknown as { input: { orderId: string; amount: number | string }; output: { orderId: string; amount: number } },
      validate: (value: unknown) => {
        const v = value as { orderId?: unknown; amount?: unknown } | null;
        const amount = Number(v?.amount);
        const issues = [
          ...(typeof v?.orderId === "string" ? [] : [{ message: "Expected a string", path: ["orderId"] }]),
          ...(Number.isFinite(amount) ? [] : [{ message: "Expected a number", path: [{ key: "amount" }] }]),
        ];
        return issues.length > 0 ? { issues } : { value: { orderId: v?.orderId as string, amount } };
      },
    },
  };

  let ran = 0;
  const order = withDurableExecution(
    validateEvent(OrderEvent, async (event, context) => {
      ran += 1;
      expectTypeOf(event).toEqualTypeOf<{ orderId: string; amount: number }>();
      return context.step("total", async () => ok(event.amount * 2));
    })
  );

  it("runs the handler with the parsed event", async () => {
    const execution = await new LocalDurableTestRunner({ handlerFunction: order }).run({
      payload: { orderId: "o1", amount: "21" },
    });
    expect(execution.getResult()).toEqual({ ok: true, value: 42 });
  });

  it("returns INVALID_EVENT with every issue, without running the handler", async () => {
    ran = 0;
    const execution = await new LocalDurableTestRunner({ handlerFunction: order }).run({
      // @ts-expect-error a wrong payload is also a compile error for typed callers
      payload: { orderId: 7, amount: "lots" },
    });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({
      ok: false,
      error: {
        type: "INVALID_EVENT",
        message: "Invalid event: orderId: Expected a string; amount: Expected a number",
        issues: [
          { message: "Expected a string", path: "orderId" },
          { message: "Expected a number", path: "amount" },
        ],
      },
    });
    expect(ran).toBe(0);
  });

  it("types callers by the schema's input and adds INVALID_EVENT to the result", () => {
    expectTypeOf<HandlerEvent<typeof order>>().toEqualTypeOf<{ orderId: string; amount: number | string }>();
    expectTypeOf<Extract<HandlerResult<typeof order>, { ok: false }>["error"]>().toEqualTypeOf<InvalidEventError>();
  });
});

