/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Tests for all code examples in .claude/skills/awaitly-patterns/SKILL.md
 * This file verifies that all code examples work correctly and pass type checking.
 */
import { describe, it, expect } from "vitest";
import {
  ok,
  err,
  type AsyncResult,
  unwrapOr,
  unwrapOrElse,
  map,
  mapError,
  andThen,
  orElse,
  fromNullable,
  from,
  fromPromise,
  allAsync,
  isOk,
  isErr,
  tap,
  tapError,
  UNEXPECTED_ERROR,
  type UnexpectedError,
} from "./index";
import { run } from "./run-entry";
import { createWorkflow } from "./workflow-entry";
import { unwrapOk, unwrapErr } from "./testing";

describe("Skill Examples", () => {
  describe("R1: step() requires explicit ID", () => {
    it("run() with explicit step ID", async () => {
      async function getUser(id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> {
        return id === "1" ? ok({ id, name: "Alice" }) : err("NOT_FOUND");
      }

      const result = await run(async (step) => {
        // Explicit ID form - step('id', () => fn())
        const user = await step('getUser', () => getUser("1"));
        return user;
      });

      const value = unwrapOk(result);
      expect(value.name).toBe("Alice");
    });

    it("createWorkflow() with explicit step ID", async () => {
      const deps = {
        getUser: async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
          return id === "1" ? ok({ id, name: "Alice" }) : err("NOT_FOUND");
        },
      };

      const workflow = createWorkflow(deps);

      const result = await workflow(async (step, deps) => {
        // Explicit ID form - step('id', () => deps.fn())
        const user = await step('getUser', () => deps.getUser("1"));
        return user;
      });

      const value = unwrapOk(result);
      expect(value.name).toBe("Alice");
    });
  });

  describe("R2: On err, step() immediately returns that error", () => {
    it("exits workflow on first error", async () => {
      const callOrder: string[] = [];

      const deps = {
        getUser: async (id: string): AsyncResult<{ id: string }, "NOT_FOUND"> => {
          callOrder.push("getUser");
          return err("NOT_FOUND");
        },
        createOrder: async (user: { id: string }): AsyncResult<{ orderId: string }, "ORDER_FAILED"> => {
          callOrder.push("createOrder");
          return ok({ orderId: "123" });
        },
      };

      const workflow = createWorkflow(deps);

      const result = await workflow(async (step, deps) => {
        const user = await step('getUser', () => deps.getUser("1"));
        const order = await step('createOrder', () => deps.createOrder(user));
        return order;
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NOT_FOUND");
      }
      // createOrder should never be called
      expect(callOrder).toEqual(["getUser"]);
    });
  });

  describe("R3: Normalize errors with error.type ?? error", () => {
    it("handles string errors", async () => {
      const deps = {
        getUser: async (): AsyncResult<{ id: string }, "NOT_FOUND"> => err("NOT_FOUND"),
      };

      const workflow = createWorkflow(deps);
      const result = await workflow(async (step, deps) => {
        return await step('getUser', () => deps.getUser());
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const normalized = (result.error as { type?: string }).type ?? result.error;
        expect(normalized).toBe("NOT_FOUND");
      }
    });

    it("handles object errors with type field", async () => {
      type UserError = { type: "NOT_FOUND"; userId: string };

      const deps = {
        getUser: async (id: string): AsyncResult<{ id: string }, UserError> =>
          err({ type: "NOT_FOUND", userId: id }),
      };

      const workflow = createWorkflow(deps);
      const result = await workflow(async (step, deps) => {
        return await step('getUser', () => deps.getUser("123"));
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const normalized = (result.error as { type?: string }).type ?? result.error;
        expect(normalized).toBe("NOT_FOUND");
      }
    });
  });

  describe("R4: Handle UnexpectedError at boundaries", () => {
    it("catches thrown exceptions as UnexpectedError", async () => {
      const deps = {
        badOperation: async (): AsyncResult<void, never> => {
          throw new Error("Something broke");
        },
      };

      const workflow = createWorkflow(deps);
      const result = await workflow(async (step, deps) => {
        return await step('badOperation', () => deps.badOperation());
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const errorType = (result.error as { type?: string }).type ?? result.error;
        expect(errorType).toBe(UNEXPECTED_ERROR);
      }
    });
  });

  describe("R5: All async work inside workflows must go through step()", () => {
    it("step.try converts throwing functions to typed errors", async () => {
      const deps = {};
      const workflow = createWorkflow(deps);

      const result = await workflow(async (step) => {
        const data = await step.try(
          "parse",
          () => JSON.parse('{"valid": true}'),
          { error: "PARSE_ERROR" as const }
        );
        return data;
      });

      const value = unwrapOk(result);
      expect(value.valid).toBe(true);
    });

    it("step.try returns error on throw", async () => {
      const deps = {};
      const workflow = createWorkflow(deps);

      const result = await workflow(async (step) => {
        const data = await step.try(
          "parse",
          () => JSON.parse("not valid json"),
          { error: "PARSE_ERROR" as const }
        );
        return data;
      });

      const error = unwrapErr(result);
      expect(error).toBe("PARSE_ERROR");
    });

    it("step.try returns unwrapped value, not Result (same control-flow as step)", async () => {
      const deps = {};
      const workflow = createWorkflow(deps);

      const result = await workflow(async (step) => {
        // step.try returns the unwrapped value directly, NOT a Result
        const parsed = await step.try(
          "parse",
          () => JSON.parse('{"name": "Alice", "age": 30}'),
          { error: "PARSE_ERROR" as const }
        );

        // We can access properties directly - no .ok check needed
        // If this were a Result, TypeScript would error on .name access
        return { name: parsed.name, age: parsed.age };
      });

      const value = unwrapOk(result);
      expect(value.name).toBe("Alice");
      expect(value.age).toBe(30);
    });
  });

  describe("Migration: run() for simple cases (Step 2a)", () => {
    it("run() workflow with closures", async () => {
      type User = { id: string; name: string };
      type Order = { id: string; total: number };

      async function getUser(id: string): AsyncResult<User, "NOT_FOUND"> {
        if (id === "user-1") return ok({ id, name: "Alice" });
        return err("NOT_FOUND");
      }

      async function createOrder(user: User): AsyncResult<Order, "ORDER_FAILED"> {
        return ok({ id: "order-123", total: 100 });
      }

      // Simple workflow using closures
      const result = await run(async (step) => {
        const user = await step('getUser', () => getUser("user-1"));
        const order = await step('createOrder', () => createOrder(user));
        return order;
      });

      const value = unwrapOk(result);
      expect(value.id).toBe("order-123");
      expect(value.total).toBe(100);
    });

    it("run() exits on first error (wrapped as UnexpectedError)", async () => {
      const callOrder: string[] = [];

      async function getUser(): AsyncResult<{ id: string }, "NOT_FOUND"> {
        callOrder.push("getUser");
        return err("NOT_FOUND");
      }

      async function createOrder(): AsyncResult<{ orderId: string }, "ORDER_FAILED"> {
        callOrder.push("createOrder");
        return ok({ orderId: "123" });
      }

      // Without options, run() wraps all errors as UnexpectedError
      const result = await run(async (step) => {
        const user = await step('getUser', () => getUser());
        const order = await step('createOrder', () => createOrder());
        return order;
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Error is UnexpectedError - access original via cause
        expect(result.error.type).toBe(UNEXPECTED_ERROR);
        const cause = result.error.cause as { type: string; error: unknown };
        expect(cause.type).toBe("STEP_FAILURE");
        expect(cause.error).toBe("NOT_FOUND");
      }
      expect(callOrder).toEqual(["getUser"]);
    });

    it("run() with catchUnexpected for typed errors", async () => {
      const callOrder: string[] = [];

      async function getUser(): AsyncResult<{ id: string }, "NOT_FOUND"> {
        callOrder.push("getUser");
        return err("NOT_FOUND");
      }

      async function createOrder(): AsyncResult<{ orderId: string }, "ORDER_FAILED"> {
        callOrder.push("createOrder");
        return ok({ orderId: "123" });
      }

      type MyErrors = "NOT_FOUND" | "ORDER_FAILED" | "UNEXPECTED";

      // With catchUnexpected, errors are typed
      const result = await run<{ orderId: string }, MyErrors>(
        async (step) => {
          const user = await step('getUser', () => getUser());
          const order = await step('createOrder', () => createOrder());
          return order;
        },
        { catchUnexpected: () => "UNEXPECTED" as const }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NOT_FOUND");
      }
      expect(callOrder).toEqual(["getUser"]);
    });

    it("run() with step.try for throwing APIs", async () => {
      const result = await run(async (step) => {
        const parsed = await step.try(
          "parse",
          () => JSON.parse('{"name": "Alice"}'),
          { error: "PARSE_ERROR" as const }
        );
        return parsed;
      });

      const value = unwrapOk(result);
      expect(value.name).toBe("Alice");
    });

    it("run() complete template with boundary handling (typed errors)", async () => {
      type User = { id: string; name: string };
      type Order = { id: string; total: number };
      type MyErrors = "NOT_FOUND" | "ORDER_FAILED" | "UNEXPECTED";

      async function getUser(id: string): AsyncResult<User, "NOT_FOUND"> {
        if (id === "user-1") return ok({ id, name: "Alice" });
        return err("NOT_FOUND");
      }

      async function createOrder(user: User): AsyncResult<Order, "ORDER_FAILED"> {
        return ok({ id: "order-123", total: 100 });
      }

      // Simulate HTTP handler with typed errors via catchUnexpected
      async function handleRequest(userId: string) {
        const result = await run<Order, MyErrors>(
          async (step) => {
            const user = await step('getUser', () => getUser(userId));
            const order = await step('createOrder', () => createOrder(user));
            return order;
          },
          { catchUnexpected: () => "UNEXPECTED" as const }
        );

        if (result.ok) {
          return { status: 200, body: result.value };
        }

        switch (result.error) {
          case "NOT_FOUND":
            return { status: 404 };
          case "ORDER_FAILED":
            return { status: 400 };
          case "UNEXPECTED":
            return { status: 500 };
        }
      }

      // Success case
      const successResponse = await handleRequest("user-1");
      expect(successResponse.status).toBe(200);
      expect(successResponse.body).toEqual({ id: "order-123", total: 100 });

      // Not found case
      const notFoundResponse = await handleRequest("unknown");
      expect(notFoundResponse.status).toBe(404);
    });

    it("run() without options (UnexpectedError handling)", async () => {
      type User = { id: string; name: string };

      async function getUser(id: string): AsyncResult<User, "NOT_FOUND"> {
        if (id === "user-1") return ok({ id, name: "Alice" });
        return err("NOT_FOUND");
      }

      // Without options, errors are UnexpectedError
      const result = await run(async (step) => {
        const user = await step('getUser', () => getUser("unknown"));
        return user;
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe(UNEXPECTED_ERROR);
        // Access original error via cause
        const cause = result.error.cause as { type: string; error: unknown };
        expect(cause.type).toBe("STEP_FAILURE");
        expect(cause.error).toBe("NOT_FOUND");
      }
    });
  });

  describe("Migration: createWorkflow(deps) for DI cases (Step 2b)", () => {
    it("full workflow with deps and boundary handling including STEP_TIMEOUT", async () => {
      type User = { id: string; name: string };
      type Order = { id: string; total: number };

      const deps = {
        getUser: async (id: string): AsyncResult<User, "NOT_FOUND"> => {
          if (id === "user-1") return ok({ id, name: "Alice" });
          if (id === "slow-user") {
            await new Promise((r) => setTimeout(r, 1000));
            return ok({ id, name: "Slow" });
          }
          return err("NOT_FOUND");
        },
        createOrder: async (user: User): AsyncResult<Order, "ORDER_FAILED"> => {
          return ok({ id: "order-123", total: 100 });
        },
      };

      const processOrder = createWorkflow(deps);

      // Simulate HTTP handler with complete boundary error handling
      async function handleRequest(userId: string, useTimeout = false) {
        const result = await processOrder(async (step, deps) => {
          const user = useTimeout
            ? await step.withTimeout('getUser', () => deps.getUser(userId), { ms: 50 })
            : await step('getUser', () => deps.getUser(userId));
          const order = await step('createOrder', () => deps.createOrder(user));
          return order;
        });

        if (result.ok) {
          return { status: 200, body: result.value };
        }

        // Boundary error handling - normalize and switch
        const errorType = (result.error as { type?: string }).type ?? result.error;
        switch (errorType) {
          case "NOT_FOUND":
            return { status: 404 };
          case "ORDER_FAILED":
            return { status: 400 };
          case "STEP_TIMEOUT":
            return { status: 504 };
          case UNEXPECTED_ERROR:
            return { status: 500 };
          default:
            return { status: 500 };
        }
      }

      // Success case
      const successResponse = await handleRequest("user-1");
      expect(successResponse.status).toBe(200);
      expect(successResponse.body).toEqual({ id: "order-123", total: 100 });

      // Not found case
      const notFoundResponse = await handleRequest("unknown");
      expect(notFoundResponse.status).toBe(404);

      // Timeout case - STEP_TIMEOUT returns 504
      const timeoutResponse = await handleRequest("slow-user", true);
      expect(timeoutResponse.status).toBe(504);
    });
  });

  describe("Step helpers", () => {
    it("step.retry retries on failure", async () => {
      let attempts = 0;

      const deps = {
        fetchData: async (): AsyncResult<{ data: string }, "NETWORK_ERROR"> => {
          attempts++;
          if (attempts < 3) return err("NETWORK_ERROR");
          return ok({ data: "success" });
        },
      };

      const workflow = createWorkflow(deps);

      const result = await workflow(async (step, deps) => {
        return await step.retry('fetchData', () => deps.fetchData(), { attempts: 3 });
      });

      const value = unwrapOk(result);
      expect(value.data).toBe("success");
      expect(attempts).toBe(3);
    });

    it("step.withTimeout completes fast operations", async () => {
      const deps = {
        fastOperation: async (): AsyncResult<string, never> => {
          return ok("done");
        },
      };

      const workflow = createWorkflow(deps);

      const result = await workflow(async (step, deps) => {
        return await step.withTimeout('fastOperation', () => deps.fastOperation(), { ms: 5000 });
      });

      const value = unwrapOk(result);
      expect(value).toBe("done");
    });

    it("step.withTimeout returns STEP_TIMEOUT on timeout", async () => {
      const deps = {
        slowOperation: async (): AsyncResult<string, never> => {
          await new Promise((r) => setTimeout(r, 1000));
          return ok("slow");
        },
      };

      const workflow = createWorkflow(deps);

      const result = await workflow(async (step, deps) => {
        return await step.withTimeout('slowOperation', () => deps.slowOperation(), { ms: 50 });
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const errorType = (result.error as { type?: string }).type ?? result.error;
        expect(errorType).toBe("STEP_TIMEOUT");
      }
    });
  });

  describe("Error types", () => {
    it("string errors work", async () => {
      const deps = {
        op: async (): AsyncResult<void, "NOT_FOUND" | "FORBIDDEN"> => err("FORBIDDEN"),
      };

      const workflow = createWorkflow(deps);
      const result = await workflow(async (step, deps) => step('op', () => deps.op()));

      const error = unwrapErr(result);
      expect(error).toBe("FORBIDDEN");
    });

    it("object errors with type field work", async () => {
      type MyError = { type: "NOT_FOUND"; userId: string };

      const deps = {
        op: async (): AsyncResult<void, MyError> => err({ type: "NOT_FOUND", userId: "123" }),
      };

      const workflow = createWorkflow(deps);
      const result = await workflow(async (step, deps) => step('op', () => deps.op()));

      const error = unwrapErr(result);
      expect(error).toEqual({ type: "NOT_FOUND", userId: "123" });
    });
  });

  describe("Synchronous computation allowed", () => {
    it("pure logic works without step()", async () => {
      const deps = {
        getData: async (): AsyncResult<number[], never> => ok([1, 2, 3, 4, 5]),
      };

      const workflow = createWorkflow(deps);

      const result = await workflow(async (step, deps) => {
        const numbers = await step('getData', () => deps.getData());
        // Synchronous computation - no step() needed
        const doubled = numbers.map((n) => n * 2);
        const sum = doubled.reduce((a, b) => a + b, 0);
        const formatted = `Total: ${sum}`;
        return { doubled, sum, formatted };
      });

      const value = unwrapOk(result);
      expect(value.doubled).toEqual([2, 4, 6, 8, 10]);
      expect(value.sum).toBe(30);
      expect(value.formatted).toBe("Total: 30");
    });
  });

  describe("Concurrency with allAsync", () => {
    it("parallel fetch with allAsync wrapped in step", async () => {
      const deps = {
        getUser: async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
          return ok({ id, name: "Alice" });
        },
        getPosts: async (id: string): AsyncResult<{ id: string; title: string }[], "FETCH_ERROR"> => {
          return ok([{ id: "p1", title: "First Post" }]);
        },
      };

      const workflow = createWorkflow(deps);

      const result = await workflow(async (step, deps) => {
        const [user, posts] = await step('fetchUserAndPosts', () => allAsync([
          deps.getUser("1"),
          deps.getPosts("1"),
        ]));

        return { user, posts };
      });

      const value = unwrapOk(result);
      expect(value.user.name).toBe("Alice");
      expect(value.posts).toHaveLength(1);
      expect(value.posts[0].title).toBe("First Post");
    });
  });

  describe("Common Patterns (outside workflows)", () => {
    describe("Default values", () => {
      it("unwrapOr returns value on Ok", () => {
        const result = ok("Alice");
        expect(unwrapOr(result, "Anonymous")).toBe("Alice");
      });

      it("unwrapOr returns default on Err", () => {
        const result = err("NOT_FOUND");
        expect(unwrapOr(result, "Anonymous")).toBe("Anonymous");
      });

      it("unwrapOrElse computes default only on Err", () => {
        let called = false;
        const computeDefault = () => { called = true; return "Guest"; };

        const okResult = ok("Alice");
        expect(unwrapOrElse(okResult, computeDefault)).toBe("Alice");
        expect(called).toBe(false);

        const errResult = err("NOT_FOUND");
        expect(unwrapOrElse(errResult, computeDefault)).toBe("Guest");
        expect(called).toBe(true);
      });
    });

    describe("Transform values", () => {
      it("map transforms Ok value", () => {
        const result = ok({ name: "alice" });
        const upper = map(result, user => user.name.toUpperCase());
        expect(unwrapOk(upper)).toBe("ALICE");
      });

      it("map passes through Err", () => {
        const result = err("NOT_FOUND") as AsyncResult<{ name: string }, "NOT_FOUND">;
        const upper = map(result, user => user.name.toUpperCase());
        expect(unwrapErr(upper)).toBe("NOT_FOUND");
      });

      it("mapError transforms Err value", () => {
        const result = err("NOT_FOUND");
        const mapped = mapError(result, e => ({ code: 404, original: e }));
        expect(unwrapErr(mapped)).toEqual({ code: 404, original: "NOT_FOUND" });
      });
    });

    describe("Chain operations", () => {
      it("andThen chains on Ok", () => {
        const getUser = (id: string) => ok({ id, name: "Alice" });
        const getOrders = (user: { id: string }) => ok([{ userId: user.id, total: 100 }]);

        const result = andThen(getUser("1"), getOrders);
        expect(unwrapOk(result)).toEqual([{ userId: "1", total: 100 }]);
      });

      it("andThen short-circuits on Err", () => {
        const getUser = () => err("NOT_FOUND") as AsyncResult<{ id: string }, "NOT_FOUND">;
        let ordersCalled = false;
        const getOrders = () => { ordersCalled = true; return ok([]); };

        const result = andThen(getUser(), getOrders);
        expect(unwrapErr(result)).toBe("NOT_FOUND");
        expect(ordersCalled).toBe(false);
      });

      it("orElse provides fallback on Err", () => {
        const primary = err("FAILED");
        const fallback = () => ok("fallback value");

        const result = orElse(primary, fallback);
        expect(unwrapOk(result)).toBe("fallback value");
      });
    });

    describe("Convert nullable", () => {
      it("fromNullable converts value to Ok", () => {
        const user = { name: "Alice" };
        const result = fromNullable(user, () => "NOT_FOUND");
        expect(unwrapOk(result)).toEqual({ name: "Alice" });
      });

      it("fromNullable converts null to Err", () => {
        const user = null;
        const result = fromNullable(user, () => "NOT_FOUND");
        expect(unwrapErr(result)).toBe("NOT_FOUND");
      });

      it("fromNullable converts undefined to Err", () => {
        const user = undefined;
        const result = fromNullable(user, () => "NOT_FOUND");
        expect(unwrapErr(result)).toBe("NOT_FOUND");
      });
    });

    describe("Wrap throwing code", () => {
      it("from wraps sync success", () => {
        const result = from(() => JSON.parse('{"a":1}'), () => "PARSE_ERROR");
        expect(unwrapOk(result)).toEqual({ a: 1 });
      });

      it("from wraps sync throw", () => {
        const result = from(() => JSON.parse("invalid"), () => "PARSE_ERROR");
        expect(unwrapErr(result)).toBe("PARSE_ERROR");
      });

      it("fromPromise wraps async success", async () => {
        const result = await fromPromise(Promise.resolve("data"), () => "FETCH_ERROR");
        expect(unwrapOk(result)).toBe("data");
      });

      it("fromPromise wraps async rejection", async () => {
        const result = await fromPromise(Promise.reject(new Error("fail")), () => "FETCH_ERROR");
        expect(unwrapErr(result)).toBe("FETCH_ERROR");
      });
    });

    describe("Type guards", () => {
      it("isOk narrows type on Ok", () => {
        const result = ok("value") as AsyncResult<string, "ERROR">;
        if (isOk(result)) {
          expect(result.value).toBe("value");
        } else {
          throw new Error("Expected Ok");
        }
      });

      it("isErr narrows type on Err", () => {
        const result = err("ERROR") as AsyncResult<string, "ERROR">;
        if (isErr(result)) {
          expect(result.error).toBe("ERROR");
        } else {
          throw new Error("Expected Err");
        }
      });
    });

    describe("Side effects", () => {
      it("tap calls function on Ok without changing result", () => {
        let logged: string | null = null;
        const result = ok("value");
        const tapped = tap(result, v => { logged = v; });

        expect(unwrapOk(tapped)).toBe("value");
        expect(logged).toBe("value");
      });

      it("tap does not call function on Err", () => {
        let called = false;
        const result = err("ERROR");
        tap(result, () => { called = true; });

        expect(called).toBe(false);
      });

      it("tapError calls function on Err without changing result", () => {
        let logged: string | null = null;
        const result = err("ERROR");
        const tapped = tapError(result, e => { logged = e; });

        expect(unwrapErr(tapped)).toBe("ERROR");
        expect(logged).toBe("ERROR");
      });
    });
  });
});
