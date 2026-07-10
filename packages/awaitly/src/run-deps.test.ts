/**
 * Tests for the deps-first form: run(deps, fn) with auto-bound steps.
 *
 * s.getOrder(id) behaves exactly like step('getOrder', () => getOrder(id)):
 * unwraps ok, early-exits on err, catches throws as UnexpectedError.
 * The error union is inferred from the deps object — no type parameters.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type AsyncResult,
  err,
  isUnexpectedError,
  ok,
  run,
  UnexpectedError,
  type WorkflowEvent,
} from "./core";

type Order = { id: string; userId: string; total: number };
type User = { id: string; name: string };
type Payment = { txId: string };

type OrderNotFound = { type: "ORDER_NOT_FOUND"; orderId: string };
type UserNotFound = { type: "USER_NOT_FOUND"; userId: string };
type ChargeDeclined = { type: "CHARGE_DECLINED"; reason: string };

const getOrder = async (id: string): AsyncResult<Order, OrderNotFound> =>
  id === "o-1"
    ? ok({ id, userId: "u-1", total: 100 })
    : err({ type: "ORDER_NOT_FOUND", orderId: id });

const getUser = async (id: string): AsyncResult<User, UserNotFound> =>
  id === "u-1" ? ok({ id, name: "Alice" }) : err({ type: "USER_NOT_FOUND", userId: id });

const charge = async (amount: number): AsyncResult<Payment, ChargeDeclined> =>
  amount <= 500 ? ok({ txId: "tx-1" }) : err({ type: "CHARGE_DECLINED", reason: "limit" });

describe("run(deps, fn) — deps-first form", () => {
  it("runs the happy path with unwrapped values and no type parameters", async () => {
    const result = await run({ getOrder, getUser, charge }, async (s) => {
      const order = await s.getOrder("o-1");
      const user = await s.getUser(order.userId);
      const payment = await s.charge(order.total);
      return { userName: user.name, txId: payment.txId };
    });

    expect(result).toEqual({ ok: true, value: { userName: "Alice", txId: "tx-1" } });

    if (result.ok) {
      expectTypeOf(result.value).toEqualTypeOf<{ userName: string; txId: string }>();
    } else {
      expectTypeOf(result.error).toEqualTypeOf<
        OrderNotFound | UserNotFound | ChargeDeclined | UnexpectedError
      >();
    }
  });

  it("early-exits on a typed error without running later steps", async () => {
    let charged = false;
    const chargeSpy = async (amount: number): AsyncResult<Payment, ChargeDeclined> => {
      charged = true;
      return charge(amount);
    };

    const result = await run({ getOrder, charge: chargeSpy }, async (s) => {
      const order = await s.getOrder("missing");
      return s.charge(order.total);
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ type: "ORDER_NOT_FOUND", orderId: "missing" });
    }
    expect(charged).toBe(false);
  });

  it("accepts plain (non-Result) functions: values pass through", async () => {
    const sendEmail = async (to: string) => ({ messageId: `msg-${to}` });

    const result = await run({ getUser, sendEmail }, async (s) => {
      const user = await s.getUser("u-1");
      const receipt = await s.sendEmail(user.name);
      expectTypeOf(receipt).toEqualTypeOf<{ messageId: string }>();
      return receipt;
    });

    expect(result).toEqual({ ok: true, value: { messageId: "msg-Alice" } });
    if (!result.ok) {
      // plain dep contributes no typed errors — union stays exact
      expectTypeOf(result.error).toEqualTypeOf<UserNotFound | UnexpectedError>();
    }
  });

  it("maps a throwing plain dep to UnexpectedError", async () => {
    const sendEmail = async (): Promise<{ messageId: string }> => {
      throw new Error("smtp down");
    };

    const result = await run({ sendEmail }, async (s) => s.sendEmail());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isUnexpectedError(result.error)).toBe(true);
    }
  });

  it("supports synchronous plain deps", async () => {
    const add = (a: number, b: number) => a + b;
    const result = await run({ add }, async (s) => s.add(2, 3));
    expect(result).toEqual({ ok: true, value: 5 });
  });

  it("uses dep keys as step names in events", async () => {
    const events: string[] = [];
    const result = await run(
      { getOrder, getUser },
      async (s) => {
        const order = await s.getOrder("o-1");
        return s.getUser(order.userId);
      },
      {
        onEvent: (event: WorkflowEvent<unknown, void>) => {
          if (event.type === "step_start") events.push(event.name ?? "");
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(events).toEqual(["getOrder", "getUser"]);
  });

  it("exposes the classic step as an escape hatch in the second parameter", async () => {
    const result = await run({ getUser }, async (s, { step }) => {
      const user = await s.getUser("u-1");
      const shouted = await step("shout", async () => ok(user.name.toUpperCase()));
      return shouted;
    });

    expect(result).toEqual({ ok: true, value: "ALICE" });
  });

  it("throws a helpful TypeError when the callback is missing", async () => {
    await expect(async () =>
      // @ts-expect-error — deliberately wrong call shape
      run({ getUser })
    ).rejects.toThrow(/run\(deps, fn\) requires a callback/);
  });

  it("keeps the legacy run(fn) form working unchanged", async () => {
    const result = await run(async ({ step }) => {
      const user = await step("getUser", () => getUser("u-1"));
      return user.name;
    });

    expect(result).toEqual({ ok: true, value: "Alice" });
  });

  it("does not double-wrap a Result-shaped return from a Result dep", async () => {
    const result = await run({ getUser }, async (s) => s.getUser("u-1"));
    expect(result).toEqual({ ok: true, value: { id: "u-1", name: "Alice" } });
  });
});
