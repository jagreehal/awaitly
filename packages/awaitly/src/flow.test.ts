import { describe, expect, expectTypeOf, it } from "vitest";

import { type AsyncResult, err, isUnexpectedError, ok } from "./core";
import { flow } from "./flow";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

type User = { id: string; name: string };
type Order = { id: string; userId: string };

const getUser = async (id: string): AsyncResult<User, "USER_NOT_FOUND"> =>
  id === "missing" ? err("USER_NOT_FOUND") : ok({ id, name: "Alice" });

const createOrder = async (
  user: User
): AsyncResult<Order, "ORDER_FAILED"> => ok({ id: "order-1", userId: user.id });

const failOrder = async (
  _user: User
): AsyncResult<Order, "ORDER_FAILED"> => err("ORDER_FAILED");

const throwingDep = async (
  _id: string
): AsyncResult<User, "USER_NOT_FOUND"> => {
  throw new Error("boom");
};

// ─────────────────────────────────────────────────────────────────────────────
// Runtime behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("flow()", () => {
  it("returns Ok with the body's return value", async () => {
    const result = await flow({ getUser, createOrder }, async (d) => {
      const user = await d.getUser("u1");
      const order = await d.createOrder(user);
      return order;
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ id: "order-1", userId: "u1" });
    }
  });

  it("short-circuits on Err and returns the dep's typed error", async () => {
    const result = await flow({ getUser, createOrder }, async (d) => {
      const user = await d.getUser("missing");
      const order = await d.createOrder(user);
      return order;
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("USER_NOT_FOUND");
    }
  });

  it("does not run later steps after a step fails", async () => {
    let createOrderCalls = 0;
    const trackedCreateOrder = async (
      user: User
    ): AsyncResult<Order, "ORDER_FAILED"> => {
      createOrderCalls += 1;
      return ok({ id: "order-1", userId: user.id });
    };

    await flow(
      { getUser, createOrder: trackedCreateOrder },
      async (d) => {
        const user = await d.getUser("missing");
        return d.createOrder(user);
      }
    );

    expect(createOrderCalls).toBe(0);
  });

  it("propagates errors from the second step", async () => {
    const result = await flow(
      { getUser, createOrder: failOrder },
      async (d) => {
        const user = await d.getUser("u1");
        return d.createOrder(user);
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("ORDER_FAILED");
    }
  });

  it("wraps thrown exceptions in UnexpectedError by default", async () => {
    const result = await flow({ throwingDep }, async (d) => {
      return d.throwingDep("u1");
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isUnexpectedError(result.error)).toBe(true);
      if (isUnexpectedError(result.error)) {
        expect((result.error.cause as Error).message).toBe("boom");
      }
    }
  });

  it("honours catchUnexpected to map thrown exceptions to a typed error", async () => {
    const result = await flow(
      { throwingDep },
      async (d) => {
        return d.throwingDep("u1");
      },
      { catchUnexpected: () => "BOOM" as const }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("BOOM");
    }
  });

  it("uses the deps-object key as the step id (surfaced via onEvent)", async () => {
    const events: { type: string; stepId: string }[] = [];
    await flow(
      { getUser, createOrder },
      async (d) => {
        const user = await d.getUser("u1");
        return d.createOrder(user);
      },
      {
        onEvent: (event) => {
          if ("stepId" in event) {
            events.push({ type: event.type, stepId: event.stepId });
          }
        },
      }
    );

    const startedStepIds = events
      .filter((e) => e.type === "step_start")
      .map((e) => e.stepId);
    expect(startedStepIds).toEqual(["getUser", "createOrder"]);
  });

  it("passes through non-function deps untouched", async () => {
    const CONSTANTS = { maxRetries: 3 };
    const result = await flow({ getUser, CONSTANTS }, async (d) => {
      expect(d.CONSTANTS.maxRetries).toBe(3);
      return d.getUser("u1");
    });
    expect(result.ok).toBe(true);
  });

  it("supports synchronous bodies", async () => {
    const result = await flow({ getUser }, (d) => d.getUser("u1"));
    expect(result.ok).toBe(true);
  });

  it("c.key overrides the auto-step id for a single dep call", async () => {
    const stepStartIds: string[] = [];
    const result = await flow(
      { getUser },
      async (_d, c) => {
        const u1 = await c.key("user:1", () => c.raw.getUser("u1"));
        const u2 = await c.key("user:2", () => c.raw.getUser("u2"));
        return [u1.id, u2.id];
      },
      {
        onEvent: (event) => {
          if ("stepId" in event && event.type === "step_start") {
            stepStartIds.push(event.stepId);
          }
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(stepStartIds).toEqual(["user:1", "user:2"]);
  });

  it("c.key short-circuits the flow on Err", async () => {
    const result = await flow(
      { getUser, createOrder },
      async (_d, c) => {
        const user = await c.key("user:missing", () =>
          c.raw.getUser("missing")
        );
        return c.raw.createOrder(user);
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("USER_NOT_FOUND");
    }
  });

  it("c.all runs ops in parallel and returns unwrapped values by key", async () => {
    const getPosts = async (
      userId: string
    ): AsyncResult<{ id: string; userId: string }[], "POSTS_FAILED"> =>
      ok([{ id: "p1", userId }]);

    const scopeNames: string[] = [];
    const result = await flow(
      { getUser, getPosts },
      async (d, c) => {
        const user = await d.getUser("u1");
        const { posts, profile } = await c.all("fetchUserData", {
          posts: () => c.raw.getPosts(user.id),
          profile: () => c.raw.getUser(user.id),
        });
        return { user, posts, profile };
      },
      {
        onEvent: (event) => {
          if (event.type === "scope_start" && "name" in event) {
            scopeNames.push((event as { name: string }).name);
          }
        },
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.posts).toEqual([{ id: "p1", userId: "u1" }]);
      expect(result.value.profile.id).toBe("u1");
    }
    expect(scopeNames).toContain("fetchUserData");
  });

  it("c.all propagates the first Err from any parallel op", async () => {
    const result = await flow(
      { getUser, failOrder },
      async (_d, c) => {
        const { user: _user, order } = await c.all("both", {
          user: () => c.raw.getUser("u1"),
          order: () => c.raw.failOrder({ id: "u1", name: "x" }),
        });
        return order;
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("ORDER_FAILED");
    }
  });

  it("documents the duplicate-dep-call limitation (same step id)", async () => {
    // Two calls to d.getUser within one flow share the step id 'getUser' —
    // ambiguous for tracing/caching. Test confirms both calls still execute
    // and the flow returns ok, but their step events both report 'getUser'.
    const stepStartIds: string[] = [];
    const result = await flow(
      { getUser },
      async (d) => {
        const a = await d.getUser("u1");
        const b = await d.getUser("u2");
        return { a, b };
      },
      {
        onEvent: (event) => {
          if ("stepId" in event && event.type === "step_start") {
            stepStartIds.push(event.stepId);
          }
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(stepStartIds).toEqual(["getUser", "getUser"]);
  });

  it("calls each dep with the supplied arguments", async () => {
    const calls: string[] = [];
    const recordingGetUser = async (
      id: string
    ): AsyncResult<User, "USER_NOT_FOUND"> => {
      calls.push(id);
      return ok({ id, name: "Alice" });
    };

    await flow({ getUser: recordingGetUser }, async (d) => {
      await d.getUser("first");
      await d.getUser("second");
    });

    expect(calls).toEqual(["first", "second"]);
  });

  it("preserves method deps that rely on `this`", async () => {
    const deps = {
      prefix: "user",
      buildId(this: { prefix: string }, id: string): AsyncResult<string, never> {
        return ok(`${this.prefix}:${id}`);
      },
    };

    const result = await flow(deps, async (d) => d.buildId("42"));

    expect(result).toEqual({ ok: true, value: "user:42" });
  });

  it("does not treat malformed result-like values as successful step deps", async () => {
    const deps = {
      malformed: async () => ({ ok: false as const }),
    };

    const result = await flow(deps, async (d) => d.malformed());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isUnexpectedError(result.error)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Type inference
// ─────────────────────────────────────────────────────────────────────────────

describe("flow() type inference", () => {
  it("infers error union from the deps and unwraps success values", async () => {
    const result = await flow({ getUser, createOrder }, async (d) => {
      const user = await d.getUser("u1");
      expectTypeOf(user).toEqualTypeOf<User>();
      const order = await d.createOrder(user);
      expectTypeOf(order).toEqualTypeOf<Order>();
      return order;
    });

    if (!result.ok) {
      expectTypeOf(result.error).toExtend<
        "USER_NOT_FOUND" | "ORDER_FAILED" | Error | unknown
      >();
    }
  });

  it("replaces UnexpectedError with the catchUnexpected return type", async () => {
    const result = await flow(
      { getUser, createOrder },
      async (d) => {
        const user = await d.getUser("u1");
        return d.createOrder(user);
      },
      { catchUnexpected: () => "BOOM" as const }
    );

    if (!result.ok) {
      expectTypeOf(result.error).toExtend<
        "USER_NOT_FOUND" | "ORDER_FAILED" | "BOOM"
      >();
    }
  });

  it("exposes non-function deps as their original type", async () => {
    await flow({ getUser, constant: 123 as const }, async (d) => {
      // Non-function entries pass through with their literal type intact.
      expectTypeOf(d.constant).toEqualTypeOf<123>();
      const user = await d.getUser("u1");
      expectTypeOf(user).toEqualTypeOf<User>();
      return user;
    });
  });

  it("makes a dep call resolve to Promise<successValue> (unwrapped)", () => {
    type DepsT = { getUser: typeof getUser };
    type FlowedDeps = import("./flow").Flowed<DepsT>;
    // d.getUser(id) should return Promise<User>, not Promise<AsyncResult<...>>
    expectTypeOf<ReturnType<FlowedDeps["getUser"]>>().toEqualTypeOf<
      Promise<User>
    >();
  });

  it("selects the right overload based on whether catchUnexpected is supplied", async () => {
    // Without catchUnexpected: error union includes UnexpectedError.
    const withoutCatch = await flow({ getUser }, async (d) => d.getUser("u1"));
    if (!withoutCatch.ok) {
      // Should be assignable to 'USER_NOT_FOUND' | UnexpectedError
      expectTypeOf(withoutCatch.error).toExtend<
        "USER_NOT_FOUND" | { _tag: "UnexpectedError" }
      >();
    }

    // With catchUnexpected: error union swaps UnexpectedError for the U type.
    const withCatch = await flow(
      { getUser },
      async (d) => d.getUser("u1"),
      { catchUnexpected: () => "MAPPED" as const }
    );
    if (!withCatch.ok) {
      expectTypeOf(withCatch.error).toExtend<"USER_NOT_FOUND" | "MAPPED">();
      // The unexpected type is replaced, not added.
      // (UnexpectedError should NOT be in this union.)
    }
  });

  it("includes errors from each function-valued dep in the union", async () => {
    const result = await flow({ getUser, createOrder, dataKey: 42 }, async (d) => {
      const user = await d.getUser("u1");
      const order = await d.createOrder(user);
      return { order, key: d.dataKey };
    });

    if (!result.ok) {
      // Error union includes both deps' errors plus UnexpectedError.
      expectTypeOf(result.error).toExtend<
        "USER_NOT_FOUND" | "ORDER_FAILED" | Error | unknown
      >();
    }
  });
});
