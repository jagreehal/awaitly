/**
 * Tests for bound steps parity in createWorkflow ({ steps }) and
 * loop safety via auto-suffixed step keys (getUser, getUser#2, ...).
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { type AsyncResult, err, ok, run, UnexpectedError } from "./core";
import { createWorkflow } from "./workflow";

type User = { id: string; name: string };
type UserNotFound = { type: "USER_NOT_FOUND"; userId: string };
type ChargeDeclined = { type: "CHARGE_DECLINED"; reason: string };

const makeDeps = () => {
  let calls = 0;
  return {
    calls: () => calls,
    deps: {
      getUser: async (id: string): AsyncResult<User, UserNotFound> => {
        calls++;
        return id.startsWith("u-")
          ? ok({ id, name: `user-${calls}` })
          : err({ type: "USER_NOT_FOUND", userId: id });
      },
      charge: async (amount: number): AsyncResult<{ txId: string }, ChargeDeclined> =>
        amount <= 500 ? ok({ txId: `tx-${amount}` }) : err({ type: "CHARGE_DECLINED", reason: "limit" }),
    },
  };
};

describe("createWorkflow bound steps ({ steps })", () => {
  it("runs bound steps with unwrapped values and inferred errors", async () => {
    const { deps } = makeDeps();
    const workflow = createWorkflow("checkout", deps);

    const result = await workflow.run(async ({ steps }) => {
      const user = await steps.getUser("u-1");
      const payment = await steps.charge(100);
      return { name: user.name, txId: payment.txId };
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.txId).toBe("tx-100");
    } else {
      expectTypeOf(result.error).toEqualTypeOf<
        UserNotFound | ChargeDeclined | UnexpectedError
      >();
    }
  });

  it("early-exits on a typed error from a bound step", async () => {
    const { deps } = makeDeps();
    const workflow = createWorkflow("checkout", deps);

    const result = await workflow.run(async ({ steps }) => {
      const user = await steps.getUser("missing");
      return steps.charge(user.id.length);
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ type: "USER_NOT_FOUND", userId: "missing" });
    }
  });

  it("coexists with classic step and deps in the same callback", async () => {
    const { deps } = makeDeps();
    const workflow = createWorkflow("checkout", deps);

    const result = await workflow.run(async ({ steps, step, deps: d }) => {
      const user = await steps.getUser("u-1");
      const direct = await step("charge-direct", () => d.charge(50));
      return { user: user.name, tx: direct.txId };
    });

    expect(result.ok).toBe(true);
  });

  it("does not cache-collide when a dep is called in a loop", async () => {
    const { deps, calls } = makeDeps();
    const workflow = createWorkflow("loop", deps);

    const result = await workflow.run(async ({ steps }) => {
      const names: string[] = [];
      for (const id of ["u-1", "u-2", "u-3"]) {
        const user = await steps.getUser(id);
        names.push(user.name);
      }
      return names;
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Each iteration must be a fresh call, not a cache hit of the first
      expect(result.value).toEqual(["user-1", "user-2", "user-3"]);
    }
    expect(calls()).toBe(3);
  });

  it("emits suffixed step names for repeat invocations", async () => {
    const { deps } = makeDeps();
    const names: string[] = [];
    const workflow = createWorkflow("loop", deps, {
      onEvent: (event) => {
        if (event.type === "step_start") names.push(event.name ?? "");
      },
    });

    const result = await workflow.run(async ({ steps }) => {
      await steps.getUser("u-1");
      await steps.getUser("u-2");
      await steps.getUser("u-3");
      return null;
    });

    expect(result.ok).toBe(true);
    expect(names).toEqual(["getUser", "getUser#2", "getUser#3"]);
  });
});

describe("run(deps, fn) loop safety", () => {
  it("suffixes repeat invocations in core run events too", async () => {
    const { deps } = makeDeps();
    const names: string[] = [];

    const result = await run(
      deps,
      async (s) => {
        await s.getUser("u-1");
        await s.getUser("u-2");
        return null;
      },
      {
        onEvent: (event) => {
          if (event.type === "step_start") names.push(event.name ?? "");
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(names).toEqual(["getUser", "getUser#2"]);
  });
});
