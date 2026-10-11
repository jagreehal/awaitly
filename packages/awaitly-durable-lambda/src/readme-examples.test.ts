/**
 * Executable README examples.
 *
 * Every test mirrors a README section, named after it, and checks that the
 * snippet it mirrors is still in the README. Together they show the failure
 * model end to end: expected failures, thrown failures, serialization, and
 * replay. If an example changes, change it here too; if this file stops
 * compiling or a mirrored line goes missing, the README is wrong.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { err, ok, type AsyncResult } from "awaitly";
import {
  durableFunction,
  replayDiagnostics,
  validateEvent,
  withDurableExecution,
  type HandlerResult,
  type ReplayDiagnostic,
} from "./index";
import { LocalDurableTestRunner, WaitingOperationStatus } from "./testing";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const mirrors = (snippet: string) => expect(readme, `README no longer contains: ${snippet}`).toContain(snippet);

type User = { id: string; name: string };
type Receipt = { receipt: string };

const calls = { getUser: 0, charge: 0 };
const getUser = async (id: string): AsyncResult<User, "NOT_FOUND"> => {
  calls.getUser += 1;
  return id === "missing" ? err("NOT_FOUND") : ok({ id, name: "Ada" });
};
const charge = async (user: User): AsyncResult<Receipt, "DECLINED"> => {
  calls.charge += 1;
  return user.id === "broke" ? err("DECLINED") : ok({ receipt: `r-${user.id}` });
};

// ## Quick start
export const checkout = withDurableExecution(async (event: { userId: string }, context) => {
  const user = await context.step("getUser", () => getUser(event.userId));
  if (!user.ok) return user;

  await context.wait("coolingOff", { minutes: 5 });

  return context.step("charge", () => charge(user.value));
});

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }));
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

const runCheckout = (userId: string) => new LocalDurableTestRunner({ handlerFunction: checkout }).run({ payload: { userId } });

describe("README: Quick start", () => {
  it("compiles, runs, and infers every failure a caller must handle", async () => {
    mirrors('const user = await context.step("getUser", () => getUser(event.userId));');
    mirrors("if (!user.ok) return user;");

    expectTypeOf<Extract<HandlerResult<typeof checkout>, { ok: false }>["error"]>().toEqualTypeOf<"NOT_FOUND" | "DECLINED">();
    expect((await runCheckout("u1")).getResult()).toEqual({ ok: true, value: { receipt: "r-u1" } });
  });
});

describe("README: How failures behave", () => {
  it("records an expected failure once: an err is a value, not retried", async () => {
    mirrors('| `return err("DECLINED")` | Checkpoints the Result, with **no retry** |');
    calls.charge = 0;

    const execution = await runCheckout("broke");

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({ ok: false, error: "DECLINED" });
    expect(calls.charge).toBe(1);
  });

  it("retries a thrown failure, then fails the execution", async () => {
    mirrors("| `throw new Error(...)` | Retries with the step's `retryStrategy`");
    let attempts = 0;
    const flaky = withDurableExecution(async (_event: void, context) =>
      context.step(
        "callApi",
        async (): Promise<string> => {
          attempts += 1;
          throw new Error("ECONNRESET");
        },
        { retryStrategy: (_error, attempt) => (attempt < 3 ? { shouldRetry: true, delay: { seconds: 1 } } : { shouldRetry: false }) }
      )
    );

    const execution = await new LocalDurableTestRunner({ handlerFunction: flaky }).run();

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError().errorMessage).toContain("ECONNRESET");
    expect(attempts).toBe(3);
  });

  it("stores Results as JSON, on the first run as well as on replay", async () => {
    mirrors('const result = await context.step("stamp", async () => ok({ at: new Date() }));');
    const stamped = withDurableExecution(async (_event: void, context) => {
      const result = await context.step("stamp", async () => ok({ at: new Date() }));
      return typeof result.value.at;
    });

    expect((await new LocalDurableTestRunner({ handlerFunction: stamped }).run()).getResult()).toBe("string");
  });
});

describe("README: Replay", () => {
  it("replays a value computed in a step instead of computing it again", async () => {
    mirrors('const id = await context.step("newId", async () => crypto.randomUUID());');
    const ids: string[] = [];
    const ordered = withDurableExecution(async (_event: void, context) => {
      const id = await context.step("newId", async () => crypto.randomUUID());
      ids.push(id);
      await context.waitForCallback("approve", async () => {}, { timeout: { hours: 1 } });
      return id;
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: ordered });
    const pending = runner.run();
    await (await runner.getOperation("approve").waitForData(WaitingOperationStatus.SUBMITTED)).sendCallbackSuccess('"ok"');
    const execution = await pending;

    expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids).size).toBe(1);
    expect(execution.getResult()).toBe(ids[0]);
  });
});

describe("README: Validate the event", () => {
  it("parses with the schema, or returns INVALID_EVENT without running", async () => {
    mirrors("const Order = z.object({ orderId: z.string().min(1), amount: z.coerce.number().positive() });");
    const Order = z.object({ orderId: z.string().min(1), amount: z.coerce.number().positive() });
    const order = withDurableExecution(
      validateEvent(Order, async (event, context) => context.step("charge", async () => ok(event.amount)))
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: order });

    expect((await runner.run({ payload: { orderId: "o1", amount: "5" } })).getResult()).toEqual({ ok: true, value: 5 });
    expect((await runner.run({ payload: { orderId: "", amount: 5 } })).getResult()).toMatchObject({
      ok: false,
      error: { type: "INVALID_EVENT", issues: [{ path: "orderId" }] },
    });
  });
});

describe("README: Typed invoke", () => {
  it("types the result by the invoked handler", async () => {
    mirrors('const receipt = await context.invoke("pay", payments, event);');
    const paymentHandler = withDurableExecution(async (event: { orderId: string; amount: number }) =>
      event.amount > 100 ? err("DECLINED" as const) : ok({ receipt: `r-${event.orderId}` })
    );
    const payments = durableFunction<typeof paymentHandler>("payments:live");
    const order = withDurableExecution(async (event: { orderId: string; amount: number }, context) => {
      const receipt = await context.invoke("pay", payments, event);
      expectTypeOf(receipt).toEqualTypeOf<HandlerResult<typeof paymentHandler>>();
      return receipt;
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: order });
    runner.registerDurableFunction(payments, paymentHandler);

    expect((await runner.run({ payload: { orderId: "o1", amount: 5 } })).getResult()).toEqual({
      ok: true,
      value: { receipt: "r-o1" },
    });
  });
});

describe("README: Testing", () => {
  it("declines without retrying", async () => {
    mirrors('const execution = await runner.run({ payload: { userId: "broke" } }); // payload type-checked');
    const runner = new LocalDurableTestRunner({ handlerFunction: checkout });
    const execution = await runner.run({ payload: { userId: "broke" } });

    expect(execution.getResult()).toEqual({ ok: false, error: "DECLINED" });
  });
});

describe("README: Replay diagnostics", () => {
  it("explains a replay violation with what to change", async () => {
    mirrors("{ plugins: [replayDiagnostics()] }");
    const logged: ReplayDiagnostic[] = [];
    let invocation = 0;
    const handler = withDurableExecution(
      async (_event: void, context) => {
        invocation += 1;
        // Only the first run takes the step: on replay the callback comes first.
        if (invocation === 1) await context.step("probe", async () => 1);
        await context.waitForCallback("approve", async () => {}, { timeout: { hours: 1 } });
        return "done";
      },
      { plugins: [replayDiagnostics({ log: (d) => logged.push(d) })] }
    );

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const pending = runner.run();
    await (await runner.getOperation("approve").waitForData(WaitingOperationStatus.SUBMITTED)).sendCallbackSuccess('"ok"');
    await pending;

    expect(logged[0]).toMatchObject({ kind: "type-mismatch", expected: "STEP" });
    expect(logged[0]?.explanation).toContain("Compute it inside context.step(...)");
  });
});
