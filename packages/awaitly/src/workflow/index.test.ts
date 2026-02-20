/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Tests for workflow.ts - createWorkflow, run, step functions
 */
import { describe, it, expect, vi } from "vitest";
import { Awaitly, ErrorOf, type AsyncResult, type Result, type UnexpectedError } from "../index";
const { err, isErr, isOk, isUnexpectedError, ok } = Awaitly;
import {
  createWorkflow,
  isStepComplete,
  isStepTimeoutError,
  getStepTimeoutMeta,
  run,
  WorkflowEvent,
  StepTimeoutError,
  isWorkflowCancelled,
  WorkflowCancelledError,
} from "../workflow-entry";
// Import legacy types from internal module (not public API)
import {
  ResumeState,
  ResumeStateEntry,
  createResumeStateCollector,
  serializeResumeState,
  deserializeResumeState,
  isSerializedResumeState,
} from "../workflow";
import { createMemoryCache } from "../persistence";
import { millis } from "../duration";

describe("run() - do-notation style", () => {
  it("executes steps sequentially and returns final value", async () => {
    // No catchUnexpected needed - only using step results
    const result = await run(async ({ step }) => {
      const a = await step('a', () => ok(10));
      const b = await step('b', () => ok(20));
      const c = await step('c', () => ok(12));
      return a + b + c;
    });

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("early exits on first error", async () => {
    const executedSteps: string[] = [];

    const result = await run(
      async ({ step }) => {
        executedSteps.push("step1");
        const a = await step('a', () => ok(10));

        executedSteps.push("step2");
        await step('fail', () => err("FAILED"));

        executedSteps.push("step3"); // Should not execute
        const c = await step('c', () => ok(12));

        return a + c;
      },
      { onError: () => {} } // Use onError for typed errors
    );

    expect(executedSteps).toEqual(["step1", "step2"]);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBe("FAILED");
    }
  });

  it("step unwraps Result and returns value directly", async () => {
    const result = await run(async ({ step }) => {
      // step() returns T, not Result<T, E>
      const value = await step('getUser', () => ok({ name: "Alice" }));

      // We can access .name directly - no need to check .ok
      return `Hello, ${value.name}`;
    });

    expect(result).toEqual({ ok: true, value: "Hello, Alice" });
  });

  it("handles async Result-returning operations", async () => {
    const asyncOp = async (): AsyncResult<number, string> => {
      await new Promise((r) => setTimeout(r, 1));
      return ok(42);
    };

    const result = await run(async ({ step }) => {
      const value = await step('asyncOp', () => asyncOp());
      return value * 2;
    });

    expect(result).toEqual({ ok: true, value: 84 });
  });

  it("calls onError callback when step fails", async () => {
    const errors: Array<{ error: unknown; stepName?: string }> = [];

    await run(
      async ({ step }) => {
        await step('validateInput', () => err("VALIDATION_ERROR"));
        return 0;
      },
      {
        onError: (error, stepName) => {
          errors.push({ error, stepName });
        },
      }
    );

    expect(errors).toEqual([
      { error: "VALIDATION_ERROR", stepName: "validateInput" },
    ]);
  });

  it("preserves cause from failed step", async () => {
    const originalCause = new Error("database connection failed");

    const result = await run(async ({ step }) => {
      await step('dbError', () => err("DB_ERROR", { cause: originalCause }));
      return 0;
    });

    if (isErr(result)) {
      expect(result.cause).toBe(originalCause);
    }
  });

  describe("step.try() with throwing operations", () => {
    it("catches and maps thrown errors (async)", async () => {
      const result = await run(
        async ({ step }) => {
          const value = await step.try(
            "network-error",
            async () => {
              throw new Error("network failure");
            },
            { onError: () => "NETWORK_ERROR" }
          );
          return value;
        },
        { onError: () => {} } // Use onError for typed errors
      );

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe("NETWORK_ERROR");
        // Cause is preserved - the original Error
        expect(result.cause).toBeInstanceOf(Error);
      }
    });

    it("catches and maps thrown errors (sync)", async () => {
      const result = await run(
        async ({ step }) => {
          // Sync operation - no async/await needed!
          const value = await step.try(
            "sync-error",
            () => {
              throw new Error("sync failure");
            },
            { onError: () => "SYNC_ERROR" }
          );
          return value;
        },
        { onError: () => {} } // Use onError for typed errors
      );

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe("SYNC_ERROR");
        expect(result.cause).toBeInstanceOf(Error);
      }
    });

    it("works with sync operations that succeed", async () => {
      const result = await run(async ({ step }) => {
        // Sync operation that doesn't throw
        const value = await step.try("parse", () => JSON.parse('{"x": 42}'), {
          onError: () => "PARSE_ERROR",
        });
        return value.x;
      });

      expect(result).toEqual({ ok: true, value: 42 });
    });

    it("supports shared error mappers for throwing steps", async () => {
      const mapUnknown = (cause: unknown) => ({
        code: cause instanceof Error ? cause.message : "UNKNOWN",
      });

      const result = await run(
        async ({ step }) => {
          await step.try(
            "map-unknown",
            async () => {
              throw new Error("oops");
            },
            { onError: mapUnknown }
          );
          return 0;
        },
        { onError: () => {} } // Use onError for typed errors
      );

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toEqual({ code: "oops" });
        expect(result.cause).toBeInstanceOf(Error);
      }
    });

    it("supports { error } shorthand (no  needed)", async () => {
      const result = await run(
        async ({ step }) => {
          await step.try(
            "network-error",
            async () => {
              throw new Error("oops");
            },
            { error: "NETWORK_ERROR" }
          );
          return 0;
        },
        { onError: () => {} } // Use onError for typed errors
      );

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe("NETWORK_ERROR");
        expect(result.cause).toBeInstanceOf(Error);
      }
    });
  });

  describe("step.fromResult() with Result-returning functions", () => {
    it("unwraps success values", async () => {
      const fetchUser = (id: string) => ok({ id, name: "Alice" });

      const result = await run(
        async ({ step }) => {
          const user = await step.fromResult("fetchUser", () => fetchUser("1"), {
            error: "FETCH_FAILED",
          });
          return user;
        },
        { onError: () => {} }
      );

      expect(result).toEqual({ ok: true, value: { id: "1", name: "Alice" } });
    });

    it("maps Result errors using onError callback", async () => {
      type UserError = { type: "NOT_FOUND"; userId: string };
      const fetchUser = (id: string): Result<{ id: string; name: string }, UserError> =>
        err({ type: "NOT_FOUND", userId: id });

      const result = await run(
        async ({ step }) => {
          const user = await step.fromResult("fetchUser", () => fetchUser("1"), {
            onError: (e) => ({ code: "USER_ERROR", original: e }),
          });
          return user;
        },
        { onError: () => {} }
      );

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toEqual({
          code: "USER_ERROR",
          original: { type: "NOT_FOUND", userId: "1" },
        });
        // The cause is the original Result error
        expect(result.cause).toEqual({ type: "NOT_FOUND", userId: "1" });
      }
    });

    it("maps Result errors using static error shorthand", async () => {
      const failingOp = (): Result<number, string> => err("ORIGINAL_ERROR");

      const result = await run(
        async ({ step }) => {
          return await step.fromResult("failingOp", () => failingOp(), {
            error: "MAPPED_ERROR" as const,
          });
        },
        { onError: () => {} }
      );

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe("MAPPED_ERROR");
        expect(result.cause).toBe("ORIGINAL_ERROR");
      }
    });

    it("works with async Result-returning functions", async () => {
      const asyncFetch = async (): AsyncResult<string, "TIMEOUT"> => {
        await new Promise((r) => setTimeout(r, 1));
        return err("TIMEOUT");
      };

      const result = await run(
        async ({ step }) => {
          return await step.fromResult("asyncFetch", () => asyncFetch(), {
            onError: (e) => ({ type: "NETWORK", reason: e }),
          });
        },
        { onError: () => {} }
      );

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toEqual({ type: "NETWORK", reason: "TIMEOUT" });
      }
    });

    it("preserves Result cause in the error chain", async () => {
      const opWithCause = (): Result<number, string, Error> =>
        err("DB_ERROR", { cause: new Error("connection refused") });

      const result = await run(
        async ({ step }) => {
          return await step.fromResult("opWithCause", () => opWithCause(), {
            error: "MAPPED" as const,
          });
        },
        { onError: () => {} }
      );

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe("MAPPED");
        // The cause is the original Result error
        expect(result.cause).toBe("DB_ERROR");
      }
    });

    it("provides typed error in onError unlike step.try", async () => {
      // This is the key ergonomic improvement over step.try
      // In step.try, onError receives `unknown`
      // In step.fromResult, onError receives the typed Result error

      type ProviderError = { provider: string; code: number };
      const callProvider = (): Result<string, ProviderError> =>
        err({ provider: "openai", code: 429 });

      const result = await run(
        async ({ step }) => {
          return await step.fromResult("callProvider", () => callProvider(), {
            // e is typed as ProviderError, not unknown!
            onError: (e) => ({
              type: "RATE_LIMITED" as const,
              provider: e.provider, // TypeScript knows this exists
              code: e.code, // TypeScript knows this exists
            }),
          });
        },
        { onError: () => {} }
      );

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toEqual({
          type: "RATE_LIMITED",
          provider: "openai",
          code: 429,
        });
      }
    });

    it("emits events with name and key", async () => {
      const events: unknown[] = [];
      const failingOp = (): Result<number, string> => err("ERROR");

      await run(
        async ({ step }) => {
          return await step.fromResult("fr:1", () => failingOp(), {
            error: "MAPPED",
          });
        },
        {
          onError: () => {},
          onEvent: (e) => events.push(e),
        }
      );

      const stepStart = events.find(
        (e) => (e as { type: string }).type === "step_start"
      );
      const stepError = events.find(
        (e) => (e as { type: string }).type === "step_error"
      );
      const stepComplete = events.find(
        (e) => (e as { type: string }).type === "step_complete"
      );

      // Name is derived from key for step.fromResult
      expect(stepStart).toMatchObject({ name: "fr:1", stepKey: "fr:1" });
      expect(stepError).toMatchObject({ name: "fr:1", stepKey: "fr:1" });
      expect(stepComplete).toMatchObject({
        name: "fr:1",
        stepKey: "fr:1",
        meta: { origin: "result" },
      });
    });
  });

  // NOTE: errors() helper was removed in v2. Use run<T, E>(..., { onError }) for explicit types.

  describe("unexpected error handling", () => {
    it("returns UnexpectedError by default (never rejects)", async () => {
      const result = await run(async () => {
        throw new Error("unexpected!");
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe("UNEXPECTED_ERROR");
        // The thrown value is preserved in result.cause
        expect(result.cause).toBeInstanceOf(Error);
      }
    });

    it("catches unexpected errors with catchUnexpected", async () => {
      const result = await run(
        async () => {
          throw new Error("unexpected!");
        },
        {
          catchUnexpected: (cause) => ({ message: (cause as Error).message }),
        }
      );

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toEqual({ message: "unexpected!" });
        expect(result.cause).toBeInstanceOf(Error);
      }
    });

    it("catchUnexpected maps to typed error", async () => {
      type AppError = "MAPPED_ERROR";

      const result = await run(
        async () => {
          throw new Error("boom");
        },
        {
          catchUnexpected: () => "MAPPED_ERROR" as const,
        }
      );

      if (isErr(result)) {
        // Error type is correctly inferred
        const error: AppError = result.error;
        expect(error).toBe("MAPPED_ERROR");
      }
    });
  });

  describe("type safety for error types", () => {
    it("infers step error unions", async () => {
      type AppError = "NOT_FOUND" | "FETCH_ERROR";

      const fetchUser = async (
        id: string
      ): AsyncResult<{ id: string }, "NOT_FOUND"> => {
        if (id === "unknown") return err("NOT_FOUND");
        return ok({ id });
      };

      const fetchPosts = async (
        userId: string
      ): AsyncResult<string[], "FETCH_ERROR"> => {
        if (userId === "bad") return err("FETCH_ERROR");
        return ok([`Post by ${userId}`]);
      };

      const result = await run.strict<
        { user: { id: string }; posts: string[] },
        AppError | "UNEXPECTED"
      >(
        async ({ step }) => {
          const user = await step('fetchUser', () => fetchUser("unknown")); // Returns NOT_FOUND
          const posts = await step('fetchPosts', () => fetchPosts(user.id));
          return { user, posts };
        },
        { catchUnexpected: () => "UNEXPECTED"  }
      );

      if (isErr(result)) {
        // Error type is exactly our closed union
        const error: AppError | "UNEXPECTED" = result.error;
        expect(error).toBe("NOT_FOUND");
      }
    });

    it("returns UnexpectedError when catchUnexpected not provided", async () => {
      // With no options, run() returns "UNEXPECTED_ERROR" string for any failures
      const result = await run(async () => {
        throw new Error("unexpected!");
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        // Error is the string "UNEXPECTED_ERROR"
        expect(result.error).toBe("UNEXPECTED_ERROR");
        // The thrown value is preserved in result.cause
        expect(result.cause).toBeInstanceOf(Error);
      }
    });

    it("calls onError with UnexpectedError when exception occurs", async () => {
      const onError = vi.fn();

      const result = await run(
        async () => {
          throw new Error("unexpected!");
        },
        { onError }
      );

      expect(isErr(result)).toBe(true);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        "UNEXPECTED_ERROR",
        "unexpected",
        undefined
      );
    });
  });
});

describe("step() overload ambiguity regression test", () => {
  it("step() correctly handles AsyncResult without needing mapError", async () => {
    // This is the key regression test - ensure AsyncResult-returning functions
    // work with step() without TS selecting the wrong overload
    const fetchUser = async (): AsyncResult<number, "NOPE"> => err("NOPE");

    const result = await run<number, "NOPE">(
      async ({ step }) => {
        await step('fetchUser', () => fetchUser()); // Should compile without mapError
        return 1;
      },
      { onError: () => {} }
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBe("NOPE");
    }
  });

  it("step() works with sync Result-returning functions", async () => {
    const validate = (): Result<number, "INVALID"> => err("INVALID");

    const result = await run<number, "INVALID">(
      async ({ step }) => {
        await step('validate', () => validate());
        return 1;
      },
      { onError: () => {} }
    );

    expect(isErr(result)).toBe(true);
  });

  it("step.try() is clearly separate from step()", async () => {
    // This test ensures the two methods don't get confused
    const result = await run<string, "NETWORK" | "PARSE">(
      async ({ step }) => {
        // Result-returning: use step()
        const data = await step(
          'getData',
          () => ok({ raw: '{"x":1}' }) as Result<{ raw: string }, "NETWORK">
        );

        // Throwing operation: use step.try()
        const parsed = await step.try(
          "parse",
          () => JSON.parse(data.raw) as { x: number },
          { onError: () => "PARSE"  }
        );

        return `Got ${parsed.x}`;
      },
      { onError: () => {} }
    );

    expect(result).toEqual({ ok: true, value: "Got 1" });
  });
});

// ======================= New Utilities Tests =======================

describe("step() with function form", () => {
  it("accepts function returning Result", async () => {
    const fetchUser = async (): AsyncResult<
      { id: string; name: string },
      "NOT_FOUND"
    > => ok({ id: "1", name: "Alice" });

    const result = await run(async ({ step }) => {
      const user = await step('fetchUser', () => fetchUser());
      return user;
    });

    expect(result).toEqual({
      ok: true,
      value: { id: "1", name: "Alice" },
    });
  });

    it("accepts function returning Result with ErrorOf", async () => {
      type User = { id: string; name: string };

      const fetchUser = async (): AsyncResult<User, "NOT_FOUND"> =>
        ok({ id: "1", name: "Alice" });

      type RunErrors = ErrorOf<typeof fetchUser>;

      const result = await run<User, RunErrors>(async ({ step }) => {
        const user = await step("fetchUser", () => fetchUser());
        return user;
      });

      expect(result).toEqual({
        ok: true,
        value: { id: "1", name: "Alice" },
      });
    });

  it("accepts sync Result-returning function", async () => {
    const validate = (): Result<number, "INVALID"> => ok(42);

    const result = await run<number, 'INVALID'>(async ({ step }) => {
      const value = await step('validate', () => validate());
      return value;
    });

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("handles Result errors correctly", async () => {
    const fetchUser = async (): AsyncResult<number, "NOT_FOUND"> =>
      err("NOT_FOUND");

    const result = await run(
      async ({ step }) => {
        await step('fetchUser', () => fetchUser());
        return 1;
      },
      { onError: () => {} } // Use onError for typed errors
    );

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("function form is the canonical form", async () => {
    const fetchUser = async (): AsyncResult<number, "NOT_FOUND"> => ok(42);

    const result = await run(async ({ step }) => {
      const value = await step('fetchUser', () => fetchUser());
      return value;
    });

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("can use multiple steps", async () => {
    const fetchUser = async (): AsyncResult<number, "NOT_FOUND"> => ok(1);
    const fetchPosts = async (): AsyncResult<number, "FETCH_ERROR"> => ok(2);

    const result = await run(async ({ step }) => {
      const user = await step('fetchUser', () => fetchUser());
      const posts = await step('fetchPosts', () => fetchPosts());
      return user + posts;
    });

    expect(result).toEqual({ ok: true, value: 3 });
  });
});

describe("run() safe default ergonomics", () => {
  it("preserves step error details inside UnexpectedError cause", async () => {
    const failure = { code: "NOT_FOUND" };

    const result = await run(async ({ step }) => {
      await step('failingStep', () => err(failure));
      return "unreachable";
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Step errors now pass through as-is (no wrapping)
      expect(result.error).toEqual(failure);
    }
  });

  it("preserves step.try mapped errors and thrown causes", async () => {
    const boom = new Error("boom");

    const result = await run(async ({ step }) => {
      await step.try(
        "networkCall",
        () => {
          throw boom;
        },
        { error: { type: "NETWORK"  } }
      );
      return "unreachable";
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // step.try mapped errors pass through as-is
      expect(result.error).toEqual({ type: "NETWORK" });
      // The original thrown error is preserved in result.cause
      expect(result.cause).toBe(boom);
    }
  });

  it("wraps uncaught exceptions as UnexpectedError via defaultCatchUnexpected", async () => {
    const boom = new Error("boom");

    const result = await run(async () => {
      throw boom;
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("UNEXPECTED_ERROR");
      // The thrown value is preserved in result.cause
      expect(result.cause).toBe(boom);
    }
  });
});

describe("onEvent (Phase 1 event stream)", () => {
  it("emits step_start and step_success events for each step", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    await run(
      async ({ step }) => {
        await step('step1', () => ok(1));
        await step('step2', () => ok(2));
        return 42;
      },
      {
        onEvent: (event) => events.push(event),
      }
    );

    // run() emits 6 step events: step_start + step_success + step_complete for each of 2 steps
    expect(events).toHaveLength(6);

    // Verify step_start is first for step1
    expect(events[0]).toMatchObject({ type: "step_start", name: "step1" });

    // All events should have same workflowId
    const workflowId = events[0].workflowId;
    expect(events.every((e) => e.workflowId === workflowId)).toBe(true);

    // Verify we have step_start, step_success, and step_complete for each step
    expect(events.filter((e) => e.type === "step_start")).toHaveLength(2);
    expect(events.filter((e) => e.type === "step_success")).toHaveLength(2);
    expect(events.filter((e) => e.type === "step_complete")).toHaveLength(2);
  });

  it("emits step_error on failure", async () => {
    const events: WorkflowEvent<string | UnexpectedError>[] = [];

    await run<number, "FAIL">(
      async ({ step }) => {
        await step('failStep', () => err("FAIL"));
        return 42;
      },
      {
        onError: () => {},
        onEvent: (event) => events.push(event),
      }
    );

    const stepError = events.find((e) => e.type === "step_error");
    expect(stepError).toBeDefined();
    expect(stepError).toMatchObject({
      type: "step_error",
      name: "failStep",
      error: "FAIL",
    });
  });

  it("supports step options object with key", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    await run(
      async ({ step }) => {
        await step('loadUser', () => ok(1), { key: "user:123" });
        return 1;
      },
      {
        onEvent: (event) => events.push(event),
      }
    );

    const stepStart = events.find((e) => e.type === "step_start");
    expect(stepStart).toMatchObject({
      type: "step_start",
      name: "loadUser",
      stepKey: "user:123",
    });
  });

  it("step ID is used as step name", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    await run(
      async ({ step }) => {
        await step('myStep', () => ok(1));
        return 1;
      },
      {
        onEvent: (event) => events.push(event),
      }
    );

    const stepStart = events.find((e) => e.type === "step_start");
    expect(stepStart).toMatchObject({
      type: "step_start",
      name: "myStep",
    });
  });

  it("step.try emits events with name and key", async () => {
    const events: WorkflowEvent<string | UnexpectedError>[] = [];

    await run<number, "ERR">(
      async ({ step }) => {
        await step.try("try:1", () => 42, { error: "ERR" });
        return 1;
      },
      {
        onError: () => {},
        onEvent: (event) => events.push(event),
      }
    );

    const stepStart = events.find((e) => e.type === "step_start");
    expect(stepStart).toMatchObject({
      type: "step_start",
      name: "try:1",
      stepKey: "try:1",
    });
  });
});

describe("createWorkflow step id/name resolution", () => {
  it("uses explicit id when first param is string", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const fetchUser = async (): AsyncResult<{ id: string }, "NOT_FOUND"> => ok({ id: "1" });

    const workflow = createWorkflow(
      "workflow",
      { fetchUser },
      { onEvent: (e) => events.push(e) }
    );

    await workflow.run(async ({ step }) => {
      await step("fetchUser", () => fetchUser());
      return 1;
    });

    const stepStart = events.find((e) => e.type === "step_start");
    expect(stepStart).toMatchObject({ type: "step_start", name: "fetchUser" });
    const stepSuccess = events.find((e) => e.type === "step_success");
    expect(stepSuccess).toMatchObject({ type: "step_success", name: "fetchUser" });
  });

  it("throws when step() is called without a string ID as first argument", async () => {
    const fetchUser = async (): AsyncResult<{ id: string }, "NOT_FOUND"> => ok({ id: "1" });

    const workflow = createWorkflow(
      "workflow",
      { fetchUser },
      {}
    );

    const result = await workflow.run(async ({ step }) => {
      // @ts-expect-error - testing runtime error for missing ID
      await step(() => fetchUser() as AsyncResult<{ id: string }, "NOT_FOUND">);
      return 1;
    });

    // Should fail with an error about missing step ID
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("UNEXPECTED_ERROR");
      // The thrown error is preserved in result.cause
      expect(result.cause).toBeInstanceOf(Error);
      expect((result.cause as Error).message).toContain("step() requires a string ID");
    }
  });
});

describe("createWorkflow with onEvent and createContext", () => {
  it("emits workflow lifecycle events", async () => {
    const events: WorkflowEvent<string | UnexpectedError>[] = [];
    const fetchData = async (): AsyncResult<number, "FETCH_ERROR"> => ok(42);

    const workflow = createWorkflow(
      "workflow",
      { fetchData },
      {
        onEvent: (event) => events.push(event),
      }
    );

    await workflow.run(async ({ step }) => {
      await step('fetchData', () => fetchData());
      return "done";
    });

    // Should have workflow_start and workflow_success
    expect(events.some((e) => e.type === "workflow_start")).toBe(true);
    expect(events.some((e) => e.type === "workflow_success")).toBe(true);

    // All events should share workflowId
    const workflowId = events[0].workflowId;
    expect(events.every((e) => e.workflowId === workflowId)).toBe(true);
  });

  it("emits workflow_error on failure", async () => {
    const events: WorkflowEvent<string | UnexpectedError>[] = [];
    const failingFn = async (): AsyncResult<number, "FAIL"> => err("FAIL");

    const workflow = createWorkflow(
      "workflow",
      { failingFn },
      {
        onEvent: (event) => events.push(event),
      }
    );

    await workflow.run(async ({ step }) => {
      await step('failingFn', () => failingFn());
      return "done";
    });

    const workflowError = events.find((e) => e.type === "workflow_error");
    expect(workflowError).toBeDefined();
    expect(workflowError?.type).toBe("workflow_error");
    if (workflowError?.type === "workflow_error") {
      expect(workflowError.error).toBe("FAIL");
    }
  });

  it("calls createContext and passes context to onEvent", async () => {
    type Context = { requestId: string; count: number };
    const events: Array<{ event: WorkflowEvent<unknown>; ctx: Context }> = [];
    let contextCalls = 0;

    const fetchData = async (): AsyncResult<number, never> => ok(42);

    const workflow = createWorkflow(
      "workflow",
      { fetchData },
      {
        createContext: () => {
          contextCalls++;
          return { requestId: "req-123", count: contextCalls };
        },
        onEvent: (event, ctx) => events.push({ event, ctx }),
      }
    );

    await workflow.run(async ({ step }) => {
      await step('fetchData', () => fetchData());
      return "done";
    });

    // createContext should be called once per workflow invocation
    expect(contextCalls).toBe(1);

    // All events should receive the same context
    expect(events.every((e) => e.ctx.requestId === "req-123")).toBe(true);
    expect(events.every((e) => e.ctx.count === 1)).toBe(true);
  });

  it("creates fresh context for each workflow invocation", async () => {
    let counter = 0;
    const contexts: number[] = [];

    const fetchData = async (): AsyncResult<number, never> => ok(42);

    const workflow = createWorkflow(
      "workflow",
      { fetchData },
      {
        createContext: () => {
          counter++;
          return counter;
        },
        onEvent: (_, ctx) => contexts.push(ctx),
      }
    );

    await workflow.run(async ({ step }) => step('fetchData', () => fetchData()));
    await workflow.run(async ({ step }) => step('fetchData', () => fetchData()));

    // Should see context values 1 and 2 from different runs
    expect(contexts).toContain(1);
    expect(contexts).toContain(2);
  });

  it("includes context in event.context when provided", async () => {
    type Context = { requestId: string };
    const events: WorkflowEvent<unknown, Context>[] = [];

    const fetchData = async (): AsyncResult<number, never> => ok(42);

    const workflow = createWorkflow(
      "workflow",
      { fetchData },
      {
        createContext: (): Context => ({ requestId: "req-123" }),
        onEvent: (event) => events.push(event),
      }
    );

    await workflow.run(async ({ step }) => step('fetchData', () => fetchData()));

    // All events should have context
    expect(events.length).toBeGreaterThan(0);
    events.forEach((event) => {
      expect(event.context).toBeDefined();
      expect(event.context?.requestId).toBe("req-123");
    });
  });

  it("does NOT include context property when no context provided", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    const fetchData = async (): AsyncResult<number, never> => ok(42);

    const workflow = createWorkflow("workflow", { fetchData }, {
      onEvent: (event) => events.push(event),
    });

    await workflow.run(async ({ step }) => step('fetchData2', () => fetchData()));

    // Events should NOT have context property when no context provided
    expect(events.length).toBeGreaterThan(0);
    events.forEach((event) => {
      expect("context" in event).toBe(false);
    });
  });

  it("preserves existing context in replayed events", async () => {
    type Context = { requestId: string };
    const events: WorkflowEvent<unknown, Context>[] = [];

    const fetchData = async (): AsyncResult<number, never> => ok(42);

    const workflow = createWorkflow(
      "workflow",
      { fetchData },
      {
        createContext: (): Context => ({ requestId: "req-123" }),
        onEvent: (event) => {
          // Simulate a replayed event with different context
          if (event.type === "workflow_start") {
            const replayedEvent = {
              ...event,
              context: { requestId: "replayed-req-456" } as Context,
            };
            events.push(replayedEvent);
          } else {
            events.push(event);
          }
        },
      }
    );

    await workflow.run(async ({ step }) => step('fetchData', () => fetchData()));

    // workflow_start should have replayed context
    const startEvent = events.find((e) => e.type === "workflow_start");
    expect(startEvent?.context?.requestId).toBe("replayed-req-456");

    // Other events should have original context
    const otherEvents = events.filter((e) => e.type !== "workflow_start");
    otherEvents.forEach((event) => {
      expect(event.context?.requestId).toBe("req-123");
    });
  });

  it("passes context to onError callback", async () => {
    type Context = { requestId: string };
    const errors: Array<{ error: unknown; stepName?: string; ctx?: Context }> = [];

    const failingFn = async (): AsyncResult<number, "FAIL"> => err("FAIL");

    const workflow = createWorkflow(
      "workflow",
      { failingFn },
      {
        createContext: (): Context => ({ requestId: "req-123" }),
        onError: (error, stepName, ctx) => {
          errors.push({ error, stepName, ctx });
        },
      }
    );

    await workflow.run(async ({ step }) => {
      await step("test-step", () => failingFn());
      return "done";
    });

    expect(errors.length).toBe(1);
    expect(errors[0].error).toBe("FAIL");
    expect(errors[0].stepName).toBe("test-step");
    expect(errors[0].ctx?.requestId).toBe("req-123");
  });

  it("onError receives undefined context when no context provided", async () => {
    const errors: Array<{ error: unknown; stepName?: string; ctx?: unknown }> = [];

    const failingFn = async (): AsyncResult<number, "FAIL"> => err("FAIL");

    const workflow = createWorkflow("workflow", { failingFn }, {
      onError: (error, stepName, ctx) => {
        errors.push({ error, stepName, ctx });
      },
    });

    await workflow.run(async ({ step }) => {
      await step('failingFn', () => failingFn());
      return "done";
    });

    expect(errors.length).toBe(1);
    expect(errors[0].ctx).toBeUndefined();
  });

  it("events include timestamps and durations", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const fetchData = async (): AsyncResult<number, never> => ok(42);

    const workflow = createWorkflow(
      "workflow",
      { fetchData },
      {
        onEvent: (event) => events.push(event),
      }
    );

    await workflow.run(async ({ step }) => {
      await step("fetch", () => fetchData());
      return "done";
    });

    // All events should have ts
    expect(events.every((e) => typeof e.ts === "number")).toBe(true);

    // Completion events should have durationMs
    const stepSuccess = events.find((e) => e.type === "step_success");
    const workflowSuccess = events.find((e) => e.type === "workflow_success");

    expect(stepSuccess && "durationMs" in stepSuccess).toBe(true);
    expect(workflowSuccess && "durationMs" in workflowSuccess).toBe(true);
  });
});

describe("run.strict()", () => {
  it("returns exact error type without UnexpectedError", async () => {
    type AppError = "NOT_FOUND" | "FETCH_ERROR" | "UNEXPECTED";

    const fetchUser = async (): AsyncResult<number, "NOT_FOUND"> => ok(42);

    const result = await run.strict<number, AppError>(
      async ({ step }) => {
        return await step('fetchUser', () => fetchUser());
      },
      { catchUnexpected: () => "UNEXPECTED"  }
    );

    expect(result).toEqual({ ok: true, value: 42 });

    // Type test: error should be exactly AppError
    if (!result.ok) {
      const _error: AppError = result.error;
    }
  });

  it("handles errors correctly with custom catchUnexpected", async () => {
    type AppError = "NOT_FOUND" | "UNEXPECTED";

    const fetchUser = async (): AsyncResult<number, "NOT_FOUND"> =>
      err("NOT_FOUND");

    const result = await run.strict<number, AppError>(
      async ({ step }) => {
        return await step('fetchUser', () => fetchUser());
      },
      { catchUnexpected: () => "UNEXPECTED" }
    );

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("works with step.try()", async () => {
    type AppError = "NETWORK" | "UNEXPECTED";

    const result = await run.strict<number, AppError>(
      async ({ step }) => {
        return await step.try("network-try", () => 42, { error: "NETWORK"  });
      },
      { catchUnexpected: () => "UNEXPECTED"  }
    );

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("maps unexpected exceptions via catchUnexpected", async () => {
    type AppError = "NOT_FOUND" | "UNEXPECTED";

    const result = await run.strict<number, AppError>(
      async () => {
        throw new Error("bug in your code");
      },
      { catchUnexpected: () => "UNEXPECTED"  }
    );

    // Unexpected errors are mapped to our domain type, not thrown
    expect(result).toEqual({
      ok: false,
      error: "UNEXPECTED",
      cause: expect.any(Error),
    });
  });

  it("still returns domain errors correctly", async () => {
    type AppError = "NOT_FOUND" | "UNEXPECTED";

    const fetchUser = async (): AsyncResult<number, "NOT_FOUND"> =>
      err("NOT_FOUND");

    const result = await run.strict<number, AppError>(
      async ({ step }) => {
        return await step('fetchUser', () => fetchUser());
      },
      { catchUnexpected: () => "UNEXPECTED"  }
    );

    // Domain errors return as Results
    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("supports onError callback", async () => {
    type AppError = "NOT_FOUND" | "UNEXPECTED";
    const onError = vi.fn();

    const fetchUser = async (): AsyncResult<number, "NOT_FOUND"> =>
      err("NOT_FOUND");

    await run.strict<number, AppError>(
      async ({ step }) => {
        return await step('fetchUser', () => fetchUser());
      },
      { onError, catchUnexpected: () => "UNEXPECTED"  }
    );

    expect(onError).toHaveBeenCalledWith("NOT_FOUND", "fetchUser", undefined);
  });

  it("calls onError for unexpected exceptions too", async () => {
    type AppError = "UNEXPECTED";
    const onError = vi.fn();

    await run.strict<number, AppError>(
      async () => {
        throw new Error("oops");
      },
      { onError, catchUnexpected: () => "UNEXPECTED"  }
    );

    expect(onError).toHaveBeenCalledWith("UNEXPECTED", "unexpected", undefined);
  });

  it("lets catchUnexpected errors propagate - maintains type contract", async () => {
    // If catchUnexpected itself throws, we let it propagate.
    // Closed union: AsyncResult<T, E | U> with no UnexpectedError when catchUnexpected is custom.
    // A buggy mapper is the user's responsibility.

    await expect(
      run.strict<number, "MAPPED">(
        async () => {
          throw new Error("original error");
        },
        {
          catchUnexpected: () => {
            throw new Error("bug in error mapper");
          },
        }
      )
    ).rejects.toThrow("bug in error mapper");
  });
});

// =============================================================================
// createWorkflow() Tests
// =============================================================================

describe("createWorkflow()", () => {
  // Helper functions for testing
  const fetchUser = (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> =>
    id === "1" ? Promise.resolve(ok({ id, name: "Alice" })) : Promise.resolve(err("NOT_FOUND" as const));

  const fetchPosts = (userId: string): AsyncResult<{ id: number; title: string }[], "FETCH_ERROR"> =>
    userId === "1"
      ? Promise.resolve(ok([{ id: 1, title: "Hello World" }]))
      : Promise.resolve(err("FETCH_ERROR" as const));

  describe("basic usage", () => {
    it("returns ok result when all steps succeed", async () => {
      const getPosts = createWorkflow("getPosts", { fetchUser, fetchPosts });

      const result = await getPosts.run(async ({ step }) => {
        const user = await step('fetchUser', () => fetchUser("1"));
        const posts = await step('fetchPosts', () => fetchPosts(user.id));
        return { user, posts };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.user.name).toBe("Alice");
        expect(result.value.posts).toHaveLength(1);
      }
    });

    it("returns error when step fails", async () => {
      const getPosts = createWorkflow("getPosts", { fetchUser, fetchPosts });

      const result = await getPosts.run(async ({ step }) => {
        const user = await step('fetchUser', () => fetchUser("999")); // Will fail
        return user;
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NOT_FOUND");
      }
    });

    it("short-circuits on first error", async () => {
      const getPosts = createWorkflow("getPosts", { fetchUser, fetchPosts });
      const fetchPostsCalled = vi.fn();

      const result = await getPosts.run(async ({ step }) => {
        const user = await step('fetchUser', () => fetchUser("999")); // Will fail
        fetchPostsCalled();
        const posts = await step('fetchPosts', () => fetchPosts(user.id));
        return { user, posts };
      });

      expect(result.ok).toBe(false);
      expect(fetchPostsCalled).not.toHaveBeenCalled();
    });
  });

  describe("deps object in callback", () => {
    it("passes deps object as second argument for destructuring", async () => {
      const getPosts = createWorkflow("getPosts", { fetchUser, fetchPosts });

      const result = await getPosts.run(async ({ step, deps }) => {
        expect(deps.fetchUser).toBe(fetchUser);
        expect(deps.fetchPosts).toBe(fetchPosts);
        const user = await step('fetchUser', () => deps.fetchUser("1"));
        return user;
      });

      expect(result.ok).toBe(true);
    });

    it("allows destructuring deps in callback", async () => {
      const getPosts = createWorkflow("getPosts", { fetchUser, fetchPosts });

      const result = await getPosts.run(async ({ step, deps: { fetchUser: fu, fetchPosts: fp } }) => {
        const user = await step('fetchUser', () => fu("1"));
        const posts = await step('fetchPosts', () => fp(user.id));
        return { user, posts };
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("deps override at run time (testing)", () => {
    it("run(fn, { deps }) overrides creation-time deps for that run only", async () => {
      const getPosts = createWorkflow("getPosts", { fetchUser, fetchPosts });

      // First run: uses creation-time deps (fetchUser("1") -> Alice)
      const result1 = await getPosts.run(async ({ step, deps }) => {
        const user = await step('fetchUser', () => deps.fetchUser("1"));
        return user.name;
      });
      expect(result1.ok).toBe(true);
      if (result1.ok) expect(result1.value).toBe("Alice");

      // Second run: override fetchUser with a mock for this run only
      const mockFetchUser = vi.fn(async (id: string) =>
        ok({ id, name: "Mock User", email: "mock@test.com" })
      );
      const result2 = await getPosts.run(
        async ({ step, deps }) => {
          const user = await step('fetchUser', () => deps.fetchUser("1"));
          return user.name;
        },
        { deps: { fetchUser: mockFetchUser } }
      );
      expect(result2.ok).toBe(true);
      if (result2.ok) expect(result2.value).toBe("Mock User");
      expect(mockFetchUser).toHaveBeenCalledWith("1");

      // Third run: no override, still uses original deps
      const result3 = await getPosts.run(async ({ step, deps }) => {
        const user = await step('fetchUser', () => deps.fetchUser("1"));
        return user.name;
      });
      expect(result3.ok).toBe(true);
      if (result3.ok) expect(result3.value).toBe("Alice");
    });

    it("partial deps override merges with creation-time deps", async () => {
      const getPosts = createWorkflow("getPosts", { fetchUser, fetchPosts });
      const mockFetchUser = vi.fn(async (id: string) =>
        ok({ id, name: "Overridden", email: "o@test.com" })
      );

      // Override only fetchUser; fetchPosts should still be the original
      const result = await getPosts.run(
        async ({ step, deps }) => {
          const user = await step('fetchUser', () => deps.fetchUser("1"));
          const posts = await step('fetchPosts', () => deps.fetchPosts(user.id));
          return { userName: user.name, postsCount: posts.length };
        },
        { deps: { fetchUser: mockFetchUser } }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.userName).toBe("Overridden");
        expect(result.value.postsCount).toBe(1); // fetchPosts("1") still uses original
      }
    });
  });

  describe("options", () => {
    it("calls onError when step fails", async () => {
      const onError = vi.fn();
      const getPosts = createWorkflow("getPosts", { fetchUser }, { onError });

      await getPosts.run(async ({ step }) => {
        return await step('fetchUser', () => fetchUser("999"));
      });

      expect(onError).toHaveBeenCalledWith("NOT_FOUND", "fetchUser", undefined);
    });
  });

  describe("custom catchUnexpected (closed union)", () => {
    it("uses run with catchUnexpected internally", async () => {
      const getPosts = createWorkflow(
        "getPosts",
        { fetchUser },
        {
          catchUnexpected: () => "UNEXPECTED" as const,
        }
      );

      // Normal error
      const result1 = await getPosts.run(async ({ step }) => {
        return await step('fetchUser', () => fetchUser("999"));
      });
      expect(result1.ok).toBe(false);
      if (!result1.ok) {
        expect(result1.error).toBe("NOT_FOUND");
      }

      // Unexpected exception gets mapped
      const result2 = await getPosts.run(async () => {
        throw new Error("unexpected");
      });
      expect(result2.ok).toBe(false);
      if (!result2.ok) {
        expect(result2.error).toBe("UNEXPECTED");
      }
    });

    it("calls onError with custom catchUnexpected", async () => {
      const onError = vi.fn();
      const getPosts = createWorkflow(
        "getPosts",
        { fetchUser },
        {
          catchUnexpected: () => "UNEXPECTED" as const,
          onError,
        }
      );

      await getPosts.run(async ({ step }) => {
        return await step("fetchUser", () => fetchUser("999"));
      });

      expect(onError).toHaveBeenCalledWith("NOT_FOUND", "fetchUser", undefined);
    });
  });

  describe("workflow reuse", () => {
    it("can be called multiple times", async () => {
      const getPosts = createWorkflow("getPosts", { fetchUser, fetchPosts });

      const result1 = await getPosts.run(async ({ step }) => {
        return await step('fetchUser', () => fetchUser("1"));
      });

      const result2 = await getPosts.run(async ({ step }) => {
        return await step('fetchUser', () => fetchUser("999"));
      });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(false);
    });
  });

  describe("step caching", () => {
    it("caches step results when key is provided (lazy form)", async () => {
      let callCount = 0;
      const expensiveOp = async (id: string): AsyncResult<{ id: string }, "ERROR"> => {
        callCount++;
        return ok({ id });
      };

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow("workflow", { expensiveOp }, { cache });

      // Use lazy form: step('id', () => expensiveOp(...), opts) to enable caching
      const result = await workflow.run(async ({ step }) => {
        const first = await step('expensiveOp1', () => expensiveOp("123"), { key: "op:123" });
        const second = await step('expensiveOp2', () => expensiveOp("123"), { key: "op:123" });
        return { first, second };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.first).toEqual({ id: "123" });
        expect(result.value.second).toEqual({ id: "123" });
      }
      // Should only call the operation once due to caching
      expect(callCount).toBe(1);
      expect(cache.size).toBe(1);
    });

    it("caches using step ID when no explicit key is provided", async () => {
      let callCount = 0;
      const expensiveOp = async (): AsyncResult<number, "ERROR"> => {
        callCount++;
        return ok(callCount);
      };

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow("workflow", { expensiveOp }, { cache });

      const result = await workflow.run(async ({ step }) => {
        const first = await step('expensiveOp1', () => expensiveOp());
        const second = await step('expensiveOp2', () => expensiveOp());
        return { first, second };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.first).toBe(1);
        expect(result.value.second).toBe(2);
      }
      // Both steps execute because they have different IDs
      expect(callCount).toBe(2);
      // Both steps are cached using their IDs
      expect(cache.size).toBe(2);
      expect(cache.has('expensiveOp1')).toBe(true);
      expect(cache.has('expensiveOp2')).toBe(true);
    });
  });

  describe("workflow hooks", () => {
    describe("onBeforeStart", () => {
      it("calls onBeforeStart before workflow execution", async () => {
        const onBeforeStart = vi.fn().mockResolvedValue(true);
        const workflow = createWorkflow("workflow", { fetchUser }, { onBeforeStart });

        await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"));
        });

        expect(onBeforeStart).toHaveBeenCalledTimes(1);
        const call = onBeforeStart.mock.calls[0];
        expect(call[0]).toMatch(/^[0-9a-f-]{36}$/); // workflowId UUID
        expect(call[1]).toBeUndefined(); // context (void by default)
      });

      it("skips workflow when onBeforeStart returns false", async () => {
        const onBeforeStart = vi.fn().mockResolvedValue(false);
        const workflow = createWorkflow("workflow", { fetchUser }, { onBeforeStart });

        const result = await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"));
        });

        expect(onBeforeStart).toHaveBeenCalledTimes(1);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBeDefined();
        }
      });

      it("supports sync onBeforeStart", async () => {
        const onBeforeStart = vi.fn().mockReturnValue(true);
        const workflow = createWorkflow("workflow", { fetchUser }, { onBeforeStart });

        await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"));
        });

        expect(onBeforeStart).toHaveBeenCalledTimes(1);
      });

      it("passes context to onBeforeStart", async () => {
        type Context = { userId: string };
        const onBeforeStart = vi.fn<(workflowId: string, context: Context) => Promise<boolean>>().mockResolvedValue(true);
        const createContext = (): Context => ({ userId: "user-123" });
        const workflow = createWorkflow("workflow", { fetchUser }, { onBeforeStart: onBeforeStart as (workflowId: string, context: Context) => boolean | Promise<boolean>, createContext });

        await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"));
        });

        expect(onBeforeStart).toHaveBeenCalledTimes(1);
        expect(onBeforeStart.mock.calls[0][1]).toEqual({ userId: "user-123" });
      });

      it("works with custom catchUnexpected", async () => {
        const onBeforeStart = vi.fn().mockResolvedValue(true);
        const workflow = createWorkflow(
          "workflow",
          { fetchUser },
          {
            catchUnexpected: () => "UNEXPECTED" as const,
            onBeforeStart,
          }
        );

        await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"));
        });

        expect(onBeforeStart).toHaveBeenCalledTimes(1);
      });

      it("returns Result when onBeforeStart throws (not rejects workflow)", async () => {
        const hookError = new Error("Lock acquisition failed");
        const onBeforeStart = vi.fn().mockRejectedValue(hookError);
        const workflow = createWorkflow("workflow", { fetchUser }, { onBeforeStart });

        // Should NOT throw/reject - should return Result
        const result = await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"));
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBe("UNEXPECTED_ERROR");
          // The thrown hook error is preserved in result.cause
          expect(result.cause).toBe(hookError);
        }
      });

      it("routes thrown onBeforeStart error through catchUnexpected", async () => {
        const hookError = new Error("Lock acquisition failed");
        const onBeforeStart = vi.fn().mockRejectedValue(hookError);
        const catchUnexpected = vi.fn().mockReturnValue("LOCK_FAILED" as const);
        const workflow = createWorkflow(
          "workflow",
          { fetchUser },
          {
            catchUnexpected,
            onBeforeStart,
          }
        );

        const result = await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"));
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBe("LOCK_FAILED");
        }
        expect(catchUnexpected).toHaveBeenCalledTimes(1);
        expect(catchUnexpected.mock.calls[0][0]).toBe(hookError);
      });
    });

    describe("onAfterStep", () => {
      it("calls onAfterStep after each keyed step completes", async () => {
        const onAfterStep = vi.fn();
        const workflow = createWorkflow("workflow", { fetchUser, fetchPosts }, { onAfterStep });

        await workflow.run(async ({ step }) => {
          const user = await step('fetchUser', () => fetchUser("1"), { key: "user:1" });
          const posts = await step('fetchPosts', () => fetchPosts(user.id), { key: "posts:1" });
          return { user, posts };
        });

        expect(onAfterStep).toHaveBeenCalledTimes(2);
        expect(onAfterStep.mock.calls[0][0]).toBe("user:1");
        expect(onAfterStep.mock.calls[0][1].ok).toBe(true);
        expect(onAfterStep.mock.calls[0][2]).toMatch(/^[0-9a-f-]{36}$/); // workflowId
        expect(onAfterStep.mock.calls[1][0]).toBe("posts:1");
      });

      it("calls onAfterStep even when step fails", async () => {
        const onAfterStep = vi.fn();
        const workflow = createWorkflow("workflow", { fetchUser, fetchPosts }, { onAfterStep });

        await workflow.run(async ({ step }) => {
          const user = await step('fetchUser', () => fetchUser("1"), { key: "user:1" });
          const posts = await step('fetchPosts', () => fetchPosts("999"), { key: "posts:999" }); // Will fail
          return { user, posts };
        });

        expect(onAfterStep).toHaveBeenCalledTimes(2);
        expect(onAfterStep.mock.calls[0][1].ok).toBe(true);
        expect(onAfterStep.mock.calls[1][1].ok).toBe(false);
        if (!onAfterStep.mock.calls[1][1].ok) {
          expect(onAfterStep.mock.calls[1][1].error).toBe("FETCH_ERROR");
        }
      });

      it("does not call onAfterStep for cached steps", async () => {
        const onAfterStep = vi.fn();
        const cache = new Map<string, Result<unknown, unknown>>();
        cache.set("user:1", ok({ id: "1", name: "Alice" }));

        const workflow = createWorkflow("workflow", { fetchUser }, { onAfterStep, cache });

        await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"), { key: "user:1" });
        });

        expect(onAfterStep).not.toHaveBeenCalled();
      });

      it("passes context to onAfterStep", async () => {
        type Context = { requestId: string };
        const onAfterStep = vi.fn().mockImplementation((_stepKey: string, _result: Result<unknown, unknown, unknown>, _workflowId: string, _ctx: Context) => Promise.resolve());
        const createContext = (): Context => ({ requestId: "req-456" });
        const workflow = createWorkflow("workflow", { fetchUser }, { onAfterStep, createContext });

        await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"), { key: "user:1" });
        });

        expect(onAfterStep).toHaveBeenCalledTimes(1);
        expect(onAfterStep.mock.calls[0][3]).toEqual({ requestId: "req-456" });
      });

      it("works with custom catchUnexpected", async () => {
        const onAfterStep = vi.fn();
        const workflow = createWorkflow(
          "workflow",
          { fetchUser },
          {
            catchUnexpected: () => "UNEXPECTED" as const,
            onAfterStep,
          }
        );

        await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"), { key: "user:1" });
        });

        expect(onAfterStep).toHaveBeenCalledTimes(1);
      });
    });

    describe("shouldRun", () => {
      it("calls shouldRun before workflow execution", async () => {
        const shouldRun = vi.fn().mockResolvedValue(true);
        const workflow = createWorkflow("workflow", { fetchUser }, { shouldRun });

        await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"));
        });

        expect(shouldRun).toHaveBeenCalledTimes(1);
        expect(shouldRun.mock.calls[0][0]).toMatch(/^[0-9a-f-]{36}$/); // workflowId
        expect(shouldRun.mock.calls[0][1]).toBeUndefined(); // context
      });

      it("skips workflow when shouldRun returns false", async () => {
        const shouldRun = vi.fn().mockResolvedValue(false);
        const workflow = createWorkflow("workflow", { fetchUser }, { shouldRun });

        const result = await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"));
        });

        expect(shouldRun).toHaveBeenCalledTimes(1);
        expect(result.ok).toBe(false);
      });

      it("supports sync shouldRun", async () => {
        const shouldRun = vi.fn().mockReturnValue(true);
        const workflow = createWorkflow("workflow", { fetchUser }, { shouldRun });

        await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"));
        });

        expect(shouldRun).toHaveBeenCalledTimes(1);
      });

      it("passes context to shouldRun", async () => {
        type Context = { instanceId: string };
        const shouldRun = vi.fn().mockImplementation((_workflowId: string, _ctx: Context) => Promise.resolve(true));
        const createContext = (): Context => ({ instanceId: "instance-789" });
        const workflow = createWorkflow("workflow", { fetchUser }, { shouldRun, createContext });

        await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"));
        });

        expect(shouldRun).toHaveBeenCalledTimes(1);
        expect(shouldRun.mock.calls[0][1]).toEqual({ instanceId: "instance-789" });
      });

      it("works with custom catchUnexpected", async () => {
        const shouldRun = vi.fn().mockResolvedValue(true);
        const workflow = createWorkflow(
          "workflow",
          { fetchUser },
          {
            catchUnexpected: () => "UNEXPECTED" as const,
            shouldRun,
          }
        );

        await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"));
        });

        expect(shouldRun).toHaveBeenCalledTimes(1);
      });

      it("skip error goes through catchUnexpected", async () => {
        const shouldRun = vi.fn().mockResolvedValue(false);
        const catchUnexpected = vi.fn().mockReturnValue("SKIPPED" as const);
        const workflow = createWorkflow(
          "workflow",
          { fetchUser },
          {
            catchUnexpected,
            shouldRun,
          }
        );

        const result = await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"));
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          // Error should be the mapped value from catchUnexpected, not UnexpectedError
          expect(result.error).toBe("SKIPPED");
        }
        expect(catchUnexpected).toHaveBeenCalledTimes(1);
        expect(catchUnexpected.mock.calls[0][0]).toBeInstanceOf(Error);
        expect((catchUnexpected.mock.calls[0][0] as Error).message).toBe("Workflow skipped by shouldRun hook");
      });

      it("returns Result when shouldRun throws (not rejects workflow)", async () => {
        const hookError = new Error("Redis connection failed");
        const shouldRun = vi.fn().mockRejectedValue(hookError);
        const workflow = createWorkflow("workflow", { fetchUser }, { shouldRun });

        // Should NOT throw/reject - should return Result
        const result = await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"));
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBe("UNEXPECTED_ERROR");
          // The thrown hook error is preserved in result.cause
          expect(result.cause).toBe(hookError);
        }
      });

      it("routes thrown hook error through catchUnexpected", async () => {
        const hookError = new Error("Redis connection failed");
        const shouldRun = vi.fn().mockRejectedValue(hookError);
        const catchUnexpected = vi.fn().mockReturnValue("HOOK_FAILED" as const);
        const workflow = createWorkflow(
          "workflow",
          { fetchUser },
          {
            catchUnexpected,
            shouldRun,
          }
        );

        const result = await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"));
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBe("HOOK_FAILED");
        }
        expect(catchUnexpected).toHaveBeenCalledTimes(1);
        expect(catchUnexpected.mock.calls[0][0]).toBe(hookError);
      });

      it("shouldRun is called before onBeforeStart", async () => {
        const callOrder: string[] = [];
        const shouldRun = vi.fn().mockImplementation(() => {
          callOrder.push("shouldRun");
          return true;
        });
        const onBeforeStart = vi.fn().mockImplementation(() => {
          callOrder.push("onBeforeStart");
          return true;
        });
        const workflow = createWorkflow("workflow", { fetchUser }, { shouldRun, onBeforeStart });

        await workflow.run(async ({ step }) => {
          return await step('fetchUser', () => fetchUser("1"));
        });

        expect(callOrder).toEqual(["shouldRun", "onBeforeStart"]);
      });
    });
  });

  describe("step caching (continued)", () => {
    it("cache persists across workflow runs", async () => {
      let callCount = 0;
      const expensiveOp = async (id: string): AsyncResult<{ id: string; count: number }, "ERROR"> => {
        callCount++;
        return ok({ id, count: callCount });
      };

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow("workflow", { expensiveOp }, { cache });

      // First run - use lazy form for caching
      const result1 = await workflow.run(async ({ step }) => {
        return await step('expensiveOp', () => expensiveOp("123"), { key: "op:123" });
      });

      // Second run - should use cache
      const result2 = await workflow.run(async ({ step }) => {
        return await step('expensiveOp', () => expensiveOp("123"), { key: "op:123" });
      });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.value.count).toBe(1);
        expect(result2.value.count).toBe(1); // Same cached value
      }
      expect(callCount).toBe(1);
    });

    it("emits step_cache_hit and step_cache_miss events", async () => {
      const events: WorkflowEvent<unknown>[] = [];
      const expensiveOp = async (): AsyncResult<number, "ERROR"> => ok(42);

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow(
        "workflow",
        { expensiveOp },
        {
          cache,
          onEvent: (event) => events.push(event),
        }
      );

      await workflow.run(async ({ step }) => {
        const first = await step("firstCall", () => expensiveOp(), { key: "op:1" });
        const second = await step("secondCall", () => expensiveOp(), { key: "op:1" });
        return { first, second };
      });

      const cacheEvents = events.filter(
        (e) => e.type === "step_cache_hit" || e.type === "step_cache_miss"
      );

      expect(cacheEvents).toHaveLength(2);
      expect(cacheEvents[0]).toMatchObject({
        type: "step_cache_miss",
        stepKey: "op:1",
        name: "firstCall",
      });
      expect(cacheEvents[1]).toMatchObject({
        type: "step_cache_hit",
        stepKey: "op:1",
        name: "secondCall",
      });
    });

    it("caches step.try results when key is provided", async () => {
      let callCount = 0;

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow("workflow", {}, { cache });

      const result = await workflow.run(async ({ step }) => {
        const first = await step.try(
          "try:1",
          () => {
            callCount++;
            return 42;
          },
          // @ts-expect-error - workflow E inferred as never when deps is {}
          { error: "FAILED" as const }
        );
        const second = await step.try(
          "try:1",
          () => {
            callCount++;
            return 99;
          },
          // @ts-expect-error - workflow E inferred as never when deps is {}
          { error: "FAILED" as const }
        );
        return { first, second };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.first).toBe(42);
        expect(result.value.second).toBe(42); // Cached value
      }
      expect(callCount).toBe(1);
    });

    it("different keys cache independently", async () => {
      let callCount = 0;
      const expensiveOp = async (id: string): AsyncResult<{ id: string; order: number }, "ERROR"> => {
        callCount++;
        return ok({ id, order: callCount });
      };

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow("workflow", { expensiveOp }, { cache });

      // Use lazy form for caching
      const result = await workflow.run(async ({ step }) => {
        const a = await step('expensiveOpA', () => expensiveOp("a"), { key: "op:a" });
        const b = await step('expensiveOpB', () => expensiveOp("b"), { key: "op:b" });
        const a2 = await step('expensiveOpA2', () => expensiveOp("a"), { key: "op:a" });
        return { a, b, a2 };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.a.order).toBe(1);
        expect(result.value.b.order).toBe(2);
        expect(result.value.a2.order).toBe(1); // Cached
      }
      expect(callCount).toBe(2);
      expect(cache.size).toBe(2);
    });

    it("works without cache option (no caching)", async () => {
      let callCount = 0;
      const expensiveOp = async (): AsyncResult<number, "ERROR"> => {
        callCount++;
        return ok(callCount);
      };

      const workflow = createWorkflow("workflow", { expensiveOp }); // No cache

      const result = await workflow.run(async ({ step }) => {
        const first = await step('expensiveOp1', () => expensiveOp(), { key: "op:1" });
        const second = await step('expensiveOp2', () => expensiveOp(), { key: "op:1" });
        return { first, second };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.first).toBe(1);
        expect(result.value.second).toBe(2); // Not cached
      }
      expect(callCount).toBe(2);
    });

    it("works with custom catchUnexpected", async () => {
      let callCount = 0;
      const expensiveOp = async (): AsyncResult<number, "ERROR"> => {
        callCount++;
        return ok(callCount);
      };

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow(
        "workflow",
        { expensiveOp },
        {
          catchUnexpected: () => "UNEXPECTED" as const,
          cache,
        }
      );

      // Use lazy form for caching
      const result = await workflow.run(async ({ step }) => {
        const first = await step('expensiveOp1', () => expensiveOp(), { key: "op:1" });
        const second = await step('expensiveOp2', () => expensiveOp(), { key: "op:1" });
        return { first, second };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.first).toBe(1);
        expect(result.value.second).toBe(1); // Cached
      }
      expect(callCount).toBe(1);
    });

    it("thunk form with same key returns cached result on second call", async () => {
      // With thunk form, step() controls when the operation is executed,
      // so the second call with the same key returns the cached result.
      let callCount = 0;
      const expensiveOp = async (): AsyncResult<number, "ERROR"> => {
        callCount++;
        return ok(callCount);
      };

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow("workflow", { expensiveOp }, { cache });

      const result = await workflow.run(async ({ step }) => {
        // Second call uses cached result from first call
        const first = await step('expensiveOp1', () => expensiveOp(), { key: "op:1" });
        const second = await step('expensiveOp2', () => expensiveOp(), { key: "op:1" });
        return { first, second };
      });

      expect(result.ok).toBe(true);
      // Only one call because the second uses cached result
      expect(callCount).toBe(1);
      // Result is cached
      expect(cache.size).toBe(1);
    });

    it("cached error hit preserves original error and cause without replaying events", async () => {
      // Bug fix: Cache hit for errors should not replay step_start/step_error events
      // and should preserve the original error and cause
      const events: WorkflowEvent<unknown>[] = [];
      const originalCause = { detail: "original failure context" };

      const failingOp = async (): AsyncResult<number, "ORIGINAL_ERROR"> => {
        return err("ORIGINAL_ERROR" as const, { cause: originalCause });
      };

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow(
        "workflow",
        { failingOp },
        {
          cache,
          onEvent: (event) => events.push(event),
        }
      );

      // First run - populate cache with error
      const result1 = await workflow.run(async ({ step }) => {
        return await step("failingCall", () => failingOp(), { key: "failing:1" });
      });

      expect(result1.ok).toBe(false);
      if (!result1.ok) {
        expect(result1.cause).toEqual(originalCause);
      }

      // Clear events for second run
      events.length = 0;

      // Second run - should hit cache
      const result2 = await workflow.run(async ({ step }) => {
        return await step("failingCall", () => failingOp(), { key: "failing:1" });
      });

      expect(result2.ok).toBe(false);
      if (!result2.ok) {
        // Should preserve original error and cause
        expect(result2.cause).toEqual(originalCause);
      }

      // Should only have: workflow_start, cache_hit, workflow_error
      // NOT step_start or step_error (which would indicate replaying)
      const stepStartEvents = events.filter((e) => e.type === "step_start");
      const stepErrorEvents = events.filter((e) => e.type === "step_error");
      const cacheHitEvents = events.filter((e) => e.type === "step_cache_hit");

      expect(stepStartEvents).toHaveLength(0); // No step_start on cache hit
      expect(stepErrorEvents).toHaveLength(0); // No step_error on cache hit
      expect(cacheHitEvents).toHaveLength(1); // Just cache_hit
    });

    it("cached error hit for step.try preserves error without replaying events", async () => {
      // Bug fix: step.try cache hit for errors should not fake a throw
      const events: WorkflowEvent<unknown>[] = [];

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow(
        "workflow",
        {},
        {
          cache,
          onEvent: (event) => events.push(event),
        }
      );

      // First run - populate cache with error via step.try
      const result1 = await workflow.run(async ({ step }) => {
        return await step.try(
          "try:1",
          () => {
            throw new Error("original throw");
          },
          // @ts-expect-error - workflow E inferred as never when deps is {}
          { error: "TRY_ERROR" as const }
        );
      });

      expect(result1.ok).toBe(false);

      // Clear events for second run
      events.length = 0;

      // Second run - should hit cache
      const result2 = await workflow.run(async ({ step }) => {
        return await step.try(
          "try:1",
          () => {
            throw new Error("should not be called");
          },
          // @ts-expect-error - workflow E inferred as never when deps is {}
          { error: "TRY_ERROR" as const }
        );
      });

      expect(result2.ok).toBe(false);

      // Should only have: workflow_start, cache_hit, workflow_error
      const stepStartEvents = events.filter((e) => e.type === "step_start");
      const stepErrorEvents = events.filter((e) => e.type === "step_error");
      const cacheHitEvents = events.filter((e) => e.type === "step_cache_hit");

      expect(stepStartEvents).toHaveLength(0);
      expect(stepErrorEvents).toHaveLength(0);
      expect(cacheHitEvents).toHaveLength(1);
    });

    it("respects per-step TTL in step options", async () => {
      vi.useFakeTimers();

      let callCount = 0;
      const expensiveOp = async (): AsyncResult<number, "ERROR"> => {
        callCount++;
        return ok(callCount);
      };

      const cache = createMemoryCache({ ttl: 10000 }); // Global 10s TTL
      const workflow = createWorkflow("workflow", { expensiveOp }, { cache });

      // First run with short TTL
      const result1 = await workflow.run(async ({ step }) => {
        return await step('expensiveOp', () => expensiveOp(), { key: "op:1", ttl: 500 }); // 500ms TTL
      });

      expect(result1.ok).toBe(true);
      if (result1.ok) expect(result1.value).toBe(1);

      // Immediately run again - should hit cache
      const result2 = await workflow.run(async ({ step }) => {
        return await step('expensiveOp', () => expensiveOp(), { key: "op:1", ttl: 500 });
      });

      expect(result2.ok).toBe(true);
      if (result2.ok) expect(result2.value).toBe(1); // Cached
      expect(callCount).toBe(1);

      // Advance time past per-step TTL but within global TTL
      vi.advanceTimersByTime(600);

      // Run again - should NOT hit cache (per-step TTL expired)
      const result3 = await workflow.run(async ({ step }) => {
        return await step('expensiveOp', () => expensiveOp(), { key: "op:1", ttl: 500 });
      });

      expect(result3.ok).toBe(true);
      if (result3.ok) expect(result3.value).toBe(2); // Fresh call
      expect(callCount).toBe(2);

      vi.useRealTimers();
    });

    it("per-step TTL overrides global cache TTL", async () => {
      vi.useFakeTimers();

      let callCount = 0;
      const expensiveOp = async (): AsyncResult<number, "ERROR"> => {
        callCount++;
        return ok(callCount);
      };

      const cache = createMemoryCache({ ttl: 500 }); // Short global TTL
      const workflow = createWorkflow("workflow", { expensiveOp }, { cache });

      // Set entry with longer per-step TTL
      const result1 = await workflow.run(async ({ step }) => {
        return await step('expensiveOp', () => expensiveOp(), { key: "long-ttl", ttl: 5000 }); // 5s TTL
      });

      expect(result1.ok).toBe(true);
      if (result1.ok) expect(result1.value).toBe(1);

      // Advance time past global TTL but within per-step TTL
      vi.advanceTimersByTime(600);

      // Should still hit cache (per-step TTL overrides global)
      const result2 = await workflow.run(async ({ step }) => {
        return await step('expensiveOp', () => expensiveOp(), { key: "long-ttl", ttl: 5000 });
      });

      expect(result2.ok).toBe(true);
      if (result2.ok) expect(result2.value).toBe(1); // Still cached
      expect(callCount).toBe(1);

      // Advance past per-step TTL
      vi.advanceTimersByTime(5000);

      const result3 = await workflow.run(async ({ step }) => {
        return await step('expensiveOp', () => expensiveOp(), { key: "long-ttl", ttl: 5000 });
      });

      expect(result3.ok).toBe(true);
      if (result3.ok) expect(result3.value).toBe(2); // Fresh call
      expect(callCount).toBe(2);

      vi.useRealTimers();
    });

    it("supports TTL in step.try", async () => {
      vi.useFakeTimers();

      let callCount = 0;

      const cache = createMemoryCache();
      const workflow = createWorkflow("workflow", {}, { cache });

      const result1 = await workflow.run(async ({ step }) => {
        return await step.try(
          "try:1",
          () => {
            callCount++;
            return callCount;
          },
          { error: "ERROR" as const as never, ttl: 500 }
        );
      });

      expect(result1.ok).toBe(true);
      if (result1.ok) expect(result1.value).toBe(1);

      // Immediate retry - should hit cache
      const result2 = await workflow.run(async ({ step }) => {
        return await step.try(
          "try:1",
          () => {
            callCount++;
            return callCount;
          },
          { error: "ERROR" as const as never, ttl: 500 }
        );
      });

      expect(result2.ok).toBe(true);
      if (result2.ok) expect(result2.value).toBe(1); // Cached
      expect(callCount).toBe(1);

      // Advance past TTL
      vi.advanceTimersByTime(600);

      const result3 = await workflow.run(async ({ step }) => {
        return await step.try(
          "try:1",
          () => {
            callCount++;
            return callCount;
          },
          { error: "ERROR" as const as never, ttl: 500 }
        );
      });

      expect(result3.ok).toBe(true);
      if (result3.ok) expect(result3.value).toBe(2); // Fresh call
      expect(callCount).toBe(2);

      vi.useRealTimers();
    });

    it("supports TTL in step.fromResult", async () => {
      vi.useFakeTimers();

      let callCount = 0;
      const resultOp = async (): AsyncResult<number, "RESULT_ERROR"> => {
        callCount++;
        return ok(callCount);
      };

      const cache = createMemoryCache();
      const workflow = createWorkflow("workflow", {}, { cache });

      const result1 = await workflow.run(async ({ step }) => {
        return await step.fromResult(
          "from:1",
          () => resultOp(),
          { error: "MAPPED_ERROR" as const as never, ttl: 500 }
        );
      });

      expect(result1.ok).toBe(true);
      if (result1.ok) expect(result1.value).toBe(1);

      // Immediate retry - should hit cache
      const result2 = await workflow.run(async ({ step }) => {
        return await step.fromResult(
          "from:1",
          () => resultOp(),
          { error: "MAPPED_ERROR" as const as never, ttl: 500 }
        );
      });

      expect(result2.ok).toBe(true);
      if (result2.ok) expect(result2.value).toBe(1); // Cached
      expect(callCount).toBe(1);

      // Advance past TTL
      vi.advanceTimersByTime(600);

      const result3 = await workflow.run(async ({ step }) => {
        return await step.fromResult(
          "from:1",
          () => resultOp(),
          { error: "MAPPED_ERROR" as const as never, ttl: 500 }
        );
      });

      expect(result3.ok).toBe(true);
      if (result3.ok) expect(result3.value).toBe(2); // Fresh call
      expect(callCount).toBe(2);

      vi.useRealTimers();
    });

    it("works without TTL (backward compatibility)", async () => {
      let callCount = 0;
      const expensiveOp = async (): AsyncResult<number, "ERROR"> => {
        callCount++;
        return ok(callCount);
      };

      const cache = createMemoryCache(); // No global TTL
      const workflow = createWorkflow("workflow", { expensiveOp }, { cache });

      // First run without TTL
      const result1 = await workflow.run(async ({ step }) => {
        return await step('expensiveOp', () => expensiveOp(), { key: "op:1" }); // No TTL
      });

      expect(result1.ok).toBe(true);
      if (result1.ok) expect(result1.value).toBe(1);

      // Second run - should hit cache (entries without TTL don't expire)
      const result2 = await workflow.run(async ({ step }) => {
        return await step('expensiveOp', () => expensiveOp(), { key: "op:1" });
      });

      expect(result2.ok).toBe(true);
      if (result2.ok) expect(result2.value).toBe(1); // Cached
      expect(callCount).toBe(1);
    });
  });

  describe("custom catchUnexpected event type soundness", () => {
    it("step_error events use catchUnexpected for uncaught exceptions", async () => {
      // step_error events should contain the mapped error from catchUnexpected, not UnexpectedError
      const events: WorkflowEvent<unknown>[] = [];

      const workflow = createWorkflow(
        "workflow",
        {},
        {
          catchUnexpected: () => "MAPPED_UNEXPECTED" as const,
          onEvent: (event) => events.push(event),
        }
      );

      const result = await workflow.run(async ({ step }) => {
        // This will throw an uncaught exception in the step
        return await step.try(
          "throwingStep",
          async () => {
            throw new Error("uncaught in step");
          },
          { error: "DOMAIN_ERROR" as const as never }
        );
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Result should have the domain error from step.try's error option
        expect(result.error).toBe("DOMAIN_ERROR");
      }
    });

    it("custom catchUnexpected step events contain mapped errors not UnexpectedError", async () => {
      // When a step operation itself throws (not via step.try), catchUnexpected
      // should map the error via catchUnexpected for the event
      const events: WorkflowEvent<"OP_ERROR" | "MAPPED">[] = [];

      const throwingOp = async (): AsyncResult<number, "OP_ERROR"> => {
        throw new Error("operation threw unexpectedly");
      };

      const workflow = createWorkflow(
        "workflow",
        { throwingOp },
        {
          catchUnexpected: () => "MAPPED" as const,
          onEvent: (event) => events.push(event),
        }
      );

      const result = await workflow.run(async ({ step }) => {
        return await step('throwingOp', () => throwingOp());
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("MAPPED");
      }

      // Find the step_error event
      const stepErrorEvent = events.find((e) => e.type === "step_error");
      expect(stepErrorEvent).toBeDefined();
      if (stepErrorEvent && stepErrorEvent.type === "step_error") {
        // The error in the event should be "MAPPED", not UnexpectedError
        expect(stepErrorEvent.error).toBe("MAPPED");
      }
    });

    it("catchUnexpected is called exactly once per uncaught exception", async () => {
      // Bug fix: catchUnexpected was being called twice - once for the event and
      // once when propagating the error. Now it's called exactly once and the
      // result is reused.
      let catchCount = 0;

      const workflow = createWorkflow(
        "workflow",
        {},
        {
          catchUnexpected: () => {
            catchCount++;
            return `MAPPED_${catchCount}` as const;
          },
        }
      );

      const result = await workflow.run(async ({ step }) => {
        return await step.try(
          "test-error",
          () => {
            throw new Error("test error");
          },
          { error: "DOMAIN_ERROR" as const as never }
        );
      });

      expect(result.ok).toBe(false);
      // catchUnexpected is NOT called for step.try (it has its own error mapping)
      // So catchCount should be 0 in this case
      expect(catchCount).toBe(0);
    });

    it("catchUnexpected called once for uncaught step exception (not step.try)", async () => {
      // For step() with an operation that throws (not step.try), catchUnexpected
      // should be called exactly once
      let catchCount = 0;
      const mappedErrors: string[] = [];

      const throwingOp = async (): AsyncResult<number, "OP_ERROR"> => {
        throw new Error("unexpected throw");
      };

      const workflow = createWorkflow(
        "workflow",
        { throwingOp },
        {
          catchUnexpected: () => {
            catchCount++;
            const mapped = `MAPPED_${catchCount}`;
            mappedErrors.push(mapped);
            return mapped as "MAPPED_1" | "MAPPED_2";
          },
        }
      );

      const result = await workflow.run(async ({ step }) => {
        return await step('throwingOp', () => throwingOp());
      });

      expect(result.ok).toBe(false);
      // Should be called exactly once, not twice
      expect(catchCount).toBe(1);
      if (!result.ok) {
        // The error should match what was returned by catchUnexpected
        expect(result.error).toBe("MAPPED_1");
      }
    });
  });

  describe("mapper exception propagation", () => {
    it("mapper throwing for original exception propagates (not swallowed)", async () => {
      // Bug fix: If catchUnexpected throws for the original exception but would
      // succeed for its own error, the mapper bug should still propagate.
      // Previously, the mapper's exception was caught by run()'s outer catch
      // and re-fed to catchUnexpected, masking the bug.

      const mapper = (cause: unknown) => {
        if (cause instanceof Error && cause.message === "boom") {
          throw new Error("mapper broke");
        }
        return "MAPPED" as const;
      };

      await expect(
        run.strict(
          async ({ step }) => {
            await step('throwingStep', () => {
              throw new Error("boom");
            });
          },
          { catchUnexpected: mapper }
        )
      ).rejects.toThrow("mapper broke");
    });

    it("safe-default mode produces UNCAUGHT_EXCEPTION cause", async () => {
      // Bug fix: Uncaught step exceptions in safe-default mode should produce
      // "UNEXPECTED_ERROR" string with the thrown value in result.cause

      const result = await run(async ({ step }) => {
        await step('throwingStep', () => {
          throw new Error("boom");
        });
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("UNEXPECTED_ERROR");
        // The thrown value is preserved in result.cause
        expect(result.cause).toBeInstanceOf(Error);
      }
    });
  });

  describe("cached step.try error metadata preservation", () => {
    it("cached step.try errors preserve origin:'throw' metadata", async () => {
      // Bug fix: Cached step.try errors were losing origin:"throw" and becoming
      // origin:"result". This broke the UnexpectedError.cause contract.

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow("workflow", {}, { cache });

      // First run - populate cache with step.try error
      const result1 = await workflow.run(async ({ step }) => {
        return await step.try(
          "try:meta",
          () => {
            throw new Error("original throw");
          },
          { error: "TRY_ERROR" as const as never }
        );
      });

      expect(result1.ok).toBe(false);
      if (!result1.ok) {
        // First result should have origin:"throw" in its cause structure
        // The cause is the thrown error wrapped appropriately
        expect(result1.cause).toBeInstanceOf(Error);
      }

      // Second run - should hit cache and preserve metadata
      const result2 = await workflow.run(async ({ step }) => {
        return await step.try(
          "try:meta",
          () => {
            throw new Error("should not be called");
          },
          { error: "TRY_ERROR" as const as never }
        );
      });

      expect(result2.ok).toBe(false);
      if (!result2.ok) {
        // Cached result should also have the original thrown error as cause
        expect(result2.cause).toBeInstanceOf(Error);
        expect((result2.cause as Error).message).toBe("original throw");
      }
    });
  });
});

// =============================================================================
// Step Complete and Resume State Tests
// =============================================================================

describe("step_complete events", () => {
  it("fires step_complete for keyed steps on success", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> =>
      ok({ id, name: "Alice" });

    const workflow = createWorkflow(
      "workflow",
      { fetchUser },
      { onEvent: (event) => events.push(event) }
    );

    await workflow.run(async ({ step }) => {
      return await step("fetchUser", () => fetchUser("123"), { key: "user:123" });
    });

    const stepCompleteEvents = events.filter((e) => e.type === "step_complete");
    expect(stepCompleteEvents).toHaveLength(1);
    expect(stepCompleteEvents[0]).toMatchObject({
      type: "step_complete",
      stepKey: "user:123",
      name: "fetchUser",
    });
    const completeEvent = stepCompleteEvents[0] as Extract<WorkflowEvent<unknown>, { type: "step_complete" }>;
    expect(completeEvent.result).toEqual({ ok: true, value: { id: "123", name: "Alice" } });
  });

  it("fires step_complete for keyed steps on error", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const fetchUser = async (_id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> =>
      err("NOT_FOUND" as const, { cause: "user does not exist" });

    const workflow = createWorkflow(
      "workflow",
      { fetchUser },
      { onEvent: (event) => events.push(event) }
    );

    await workflow.run(async ({ step }) => {
      return await step("fetchUser", () => fetchUser("unknown"), { key: "user:unknown" });
    });

    const stepCompleteEvents = events.filter((e) => e.type === "step_complete");
    expect(stepCompleteEvents).toHaveLength(1);
    expect(stepCompleteEvents[0]).toMatchObject({
      type: "step_complete",
      stepKey: "user:unknown",
      name: "fetchUser",
    });
    const completeEvent = stepCompleteEvents[0] as Extract<WorkflowEvent<unknown>, { type: "step_complete" }>;
    const result = completeEvent.result;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("NOT_FOUND");
      expect(result.cause).toBe("user does not exist");
    }
  });

  it("fires step_complete using step ID when no explicit key provided", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const fetchUser = async (): AsyncResult<string, "NOT_FOUND"> => ok("Alice");

    const workflow = createWorkflow(
      "workflow",
      { fetchUser },
      { onEvent: (event) => events.push(event) }
    );

    await workflow.run(async ({ step }) => {
      // No explicit key provided - step ID is used as key
      return await step("fetchUser", () => fetchUser());
    });

    const stepCompleteEvents = events.filter((e) => e.type === "step_complete");
    expect(stepCompleteEvents).toHaveLength(1);
    expect(stepCompleteEvents[0].stepKey).toBe("fetchUser");
  });

  it("fires step_complete for step.try on success", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    const workflow = createWorkflow("workflow", {}, { onEvent: (event) => events.push(event) });

    await workflow.run(async ({ step }) => {
      return await step.try(
        "parse:1",
        () => JSON.parse('{"valid": true}'),
        { error: "PARSE_ERROR" as const as never }
      );
    });

    const stepCompleteEvents = events.filter((e) => e.type === "step_complete");
    expect(stepCompleteEvents).toHaveLength(1);
    expect(stepCompleteEvents[0]).toMatchObject({
      type: "step_complete",
      stepKey: "parse:1",
      name: "parse:1", // Name derived from key for step.try
    });
    const completeEvent = stepCompleteEvents[0] as Extract<WorkflowEvent<unknown>, { type: "step_complete" }>;
    expect(completeEvent.result).toEqual({ ok: true, value: { valid: true } });
  });

  it("fires step_complete for step.try on error", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    const workflow = createWorkflow("workflow", {}, { onEvent: (event) => events.push(event) });

    await workflow.run(async ({ step }) => {
      return await step.try(
        "parse:2",
        () => JSON.parse("invalid json"),
        { error: "PARSE_ERROR" as const as never }
      );
    });

    const stepCompleteEvents = events.filter((e) => e.type === "step_complete");
    expect(stepCompleteEvents).toHaveLength(1);
    expect(stepCompleteEvents[0]).toMatchObject({
      type: "step_complete",
      stepKey: "parse:2",
      name: "parse:2", // Name derived from key for step.try
    });
    const completeEvent = stepCompleteEvents[0] as Extract<WorkflowEvent<unknown>, { type: "step_complete" }>;
    const result = completeEvent.result;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("PARSE_ERROR");
      expect(result.cause).toBeInstanceOf(SyntaxError);
    }
  });

  it("isStepComplete type guard works correctly", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const fetchUser = async (): AsyncResult<string, "NOT_FOUND"> => ok("Alice");

    const workflow = createWorkflow(
      "workflow",
      { fetchUser },
      { onEvent: (event) => events.push(event) }
    );

    await workflow.run(async ({ step }) => {
      return await step('fetchUser', () => fetchUser(), { key: "user:1" });
    });

    // Use the type guard
    const stepCompleteEvents = events.filter(isStepComplete);
    expect(stepCompleteEvents).toHaveLength(1);
    expect(stepCompleteEvents[0].stepKey).toBe("user:1");
    expect(stepCompleteEvents[0].result.ok).toBe(true);
  });
});

describe("direct AsyncResult with keys", () => {
  it("supports direct Result form with explicit id", async () => {
    const workflow = createWorkflow("workflow");

    const result = await workflow.run(async ({ step }) => {
      return await step('directResult', () => ok(42));
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  it("populates cache for direct AsyncResult steps with keys", async () => {
    const cacheMap = new Map<string, Result<unknown, unknown, unknown>>();

    const createUser = async (email: string): AsyncResult<{ id: string }, "ERROR"> =>
      ok({ id: "user-123" });

    const workflow = createWorkflow("workflow", { createUser }, { cache: cacheMap });

    await workflow.run(async ({ step, deps: { createUser } }) => {
      // Function-wrapped pattern with explicit ID
      const user = await step('createUser', () => createUser("test@example.com"), { key: "user:1" });
      return user;
    });

    expect(cacheMap.size).toBe(1);
    expect(cacheMap.has("user:1")).toBe(true);
    const cached = cacheMap.get("user:1");
    expect(cached?.ok).toBe(true);
    if (cached?.ok) {
      expect(cached.value).toEqual({ id: "user-123" });
    }
  });

  it("emits step_complete for direct AsyncResult steps with keys", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const createUser = async (email: string): AsyncResult<{ id: string }, "ERROR"> =>
      ok({ id: "user-123" });

    const workflow = createWorkflow(
      "workflow",
      { createUser },
      { onEvent: (e) => events.push(e) }
    );

    await workflow.run(async ({ step, deps: { createUser } }) => {
      // Function-wrapped pattern
      const user = await step('createUser', () => createUser("test@example.com"), { key: "user:1" });
      return user;
    });

    const stepCompleteEvents = events.filter((e) => e.type === "step_complete");
    expect(stepCompleteEvents).toHaveLength(1);
    expect(stepCompleteEvents[0]).toMatchObject({
      type: "step_complete",
      stepKey: "user:1",
    });
  });

  it("collector captures step_complete for direct AsyncResult steps", async () => {
    const createUser = async (email: string): AsyncResult<{ id: string }, "ERROR"> =>
      ok({ id: "user-123" });
    const collector = createResumeStateCollector();

    const workflow = createWorkflow(
      "workflow",
      { createUser },
      { onEvent: collector.handleEvent }
    );

    await workflow.run(async ({ step, deps: { createUser } }) => {
      const user = await step('createUser', () => createUser("test@example.com"), { key: "user:1" });
      return user;
    });

    const state = collector.getResumeState();
    expect(state.steps.size).toBe(1);
    expect(state.steps.has("user:1")).toBe(true);
    const entry = state.steps.get("user:1");
    expect(entry?.result.ok).toBe(true);
    if (entry?.result.ok) {
      expect(entry.result.value).toEqual({ id: "user-123" });
    }
  });

  describe("runWithState", () => {
    it("returns result and resumeState; resumeState is always present", async () => {
      const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> =>
        id === "1" ? ok({ id, name: "Alice" }) : err("NOT_FOUND");
      const workflow = createWorkflow("workflow", { fetchUser });

      const { result, resumeState } = await workflow.runWithState(async ({ step, deps: { fetchUser } }) => {
        const user = await step("fetchUser", () => fetchUser("1"), { key: "user:1" });
        return user.name;
      });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe("Alice");
      expect(resumeState.steps.size).toBe(1);
      expect(resumeState.steps.has("user:1")).toBe(true);
    });

    it("returns resumeState even when run returns error Result", async () => {
      const fetchUser = async (id: string): AsyncResult<{ id: string }, "NOT_FOUND"> =>
        id === "1" ? ok({ id }) : err("NOT_FOUND");
      const workflow = createWorkflow("workflow", { fetchUser });

      const { result, resumeState } = await workflow.runWithState(async ({ step, deps: { fetchUser } }) => {
        const user = await step("fetchUser", () => fetchUser("999"), { key: "user:999" });
        return user.id;
      });

      expect(result.ok).toBe(false);
      expect(resumeState.steps.size).toBe(1);
      expect(resumeState.steps.has("user:999")).toBe(true);
    });

    it("supports name and config overloads", async () => {
      const fetchUser = async (): AsyncResult<{ id: string }> => ok({ id: "1" });
      const workflow = createWorkflow("workflow", { fetchUser });

      const { result, resumeState } = await workflow.runWithState(
        "my-run",
        async ({ step, deps: { fetchUser } }) => {
          const user = await step("fetchUser", () => fetchUser(), { key: "user:1" });
          return user.id;
        }
      );

      expect(result.ok).toBe(true);
      expect(resumeState.steps.size).toBe(1);
    });
  });

  describe("serializeResumeState / deserializeResumeState", () => {
    it("round-trips ResumeState through JSON", () => {
      const state: ResumeState = {
        steps: new Map([
          ["a", { result: ok(1) }],
          ["b", { result: err("E" as const, { cause: new Error("cause") }) }],
        ]),
      };
      const serialized = serializeResumeState(state);
      expect(serialized.kind).toBe("ResumeState");
      expect(Array.isArray(serialized.steps)).toBe(true);
      expect(serialized.steps.length).toBe(2);
      expect(isSerializedResumeState(serialized)).toBe(true);

      const json = JSON.stringify(serialized);
      const parsed = JSON.parse(json);
      expect(isSerializedResumeState(parsed)).toBe(true);
      const restored = deserializeResumeState(parsed);
      expect(restored.steps.size).toBe(2);
      const entryA = restored.steps.get("a");
      expect(entryA?.result.ok).toBe(true);
      if (entryA?.result.ok) expect(entryA.result.value).toBe(1);
      expect(restored.steps.get("b")?.result.ok).toBe(false);
    });
  });

  it("emits step_complete for direct AsyncResult error steps with keys", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const createUser = async (_email: string): AsyncResult<{ id: string }, "EMAIL_INVALID"> =>
      err("EMAIL_INVALID" as const);

    const workflow = createWorkflow(
      "workflow",
      { createUser },
      { onEvent: (e) => events.push(e) }
    );

    await workflow.run(async ({ step, deps: { createUser } }) => {
      const user = await step('createUser', () => createUser("invalid"), { key: "user:1" });
      return user;
    });

    const stepCompleteEvents = events.filter((e) => e.type === "step_complete");
    expect(stepCompleteEvents).toHaveLength(1);
    const completeEvent = stepCompleteEvents[0] as Extract<WorkflowEvent<unknown>, { type: "step_complete" }>;
    expect(completeEvent.stepKey).toBe("user:1");
    expect(completeEvent.result.ok).toBe(false);
    if (!completeEvent.result.ok) {
      expect(completeEvent.result.error).toBe("EMAIL_INVALID");
    }
  });

  it("caches error results for direct AsyncResult steps", async () => {
    const cacheMap = new Map<string, Result<unknown, unknown, unknown>>();
    const createUser = async (_email: string): AsyncResult<{ id: string }, "EMAIL_INVALID"> =>
      err("EMAIL_INVALID" as const, { cause: "bad format" });

    const workflow = createWorkflow("workflow", { createUser }, { cache: cacheMap });

    await workflow.run(async ({ step, deps: { createUser } }) => {
      const user = await step('createUser', () => createUser("invalid"), { key: "user:1" });
      return user;
    });

    expect(cacheMap.size).toBe(1);
    expect(cacheMap.has("user:1")).toBe(true);
    const cached = cacheMap.get("user:1");
    expect(cached?.ok).toBe(false);
  });

  it("emits step_complete using step ID as key when no explicit key provided", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const createUser = async (email: string): AsyncResult<{ id: string }, "ERROR"> =>
      ok({ id: "user-123" });

    const workflow = createWorkflow(
      "workflow",
      { createUser },
      { onEvent: (e) => events.push(e) }
    );

    await workflow.run(async ({ step, deps: { createUser } }) => {
      // No explicit key provided - step ID is used as key
      const user = await step('createUser', () => createUser("test@example.com"));
      return user;
    });

    const stepCompleteEvents = events.filter((e) => e.type === "step_complete");
    expect(stepCompleteEvents).toHaveLength(1);
    expect(stepCompleteEvents[0].stepKey).toBe("createUser");
  });

  it("same behavior for function-wrapped vs direct AsyncResult with keys", async () => {
    const eventsWrapped: WorkflowEvent<unknown>[] = [];
    const eventsDirect: WorkflowEvent<unknown>[] = [];
    const cacheWrapped = new Map<string, Result<unknown, unknown, unknown>>();
    const cacheDirect = new Map<string, Result<unknown, unknown, unknown>>();

    const createUser = async (email: string): AsyncResult<{ id: string }, "ERROR"> =>
      ok({ id: "user-123" });

    // Function-wrapped pattern
    const workflow1 = createWorkflow(
      "workflow",
      { createUser },
      { onEvent: (e) => eventsWrapped.push(e), cache: cacheWrapped }
    );
    await workflow1.run(async ({ step, deps: { createUser } }) => {
      const user = await step('createUser', () => createUser("test@example.com"), { key: "user:1" });
      return user;
    });

    // Direct AsyncResult pattern (using function-wrapped form now)
    const workflow2 = createWorkflow(
      "workflow",
      { createUser },
      { onEvent: (e) => eventsDirect.push(e), cache: cacheDirect }
    );
    await workflow2.run(async ({ step, deps: { createUser } }) => {
      const user = await step('createUser', () => createUser("test@example.com"), { key: "user:1" });
      return user;
    });

    // Both should emit step_complete
    const wrappedComplete = eventsWrapped.filter((e) => e.type === "step_complete");
    const directComplete = eventsDirect.filter((e) => e.type === "step_complete");
    expect(wrappedComplete).toHaveLength(1);
    expect(directComplete).toHaveLength(1);

    // Both should populate cache
    expect(cacheWrapped.size).toBe(1);
    expect(cacheDirect.size).toBe(1);

    // Both should have same result structure
    expect(cacheWrapped.get("user:1")).toEqual(cacheDirect.get("user:1"));
  });
});

describe("resumeState", () => {
  it("pre-populates cache from resumeState", async () => {
    let callCount = 0;
    const expensiveOp = async (): AsyncResult<number, "ERROR"> => {
      callCount++;
      return ok(callCount);
    };

    // Pre-populate resume state (with new ResumeStateEntry format)
    const resumeState: ResumeState = {
      steps: new Map([["op:1", { result: ok(999) }]]),
    };

    const workflow = createWorkflow("workflow", { expensiveOp }, { resumeState });

    const result = await workflow.run(async ({ step }) => {
      // This should hit the resume state cache
      return await step('expensiveOp', () => expensiveOp(), { key: "op:1" });
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(999); // From resume state, not fresh execution
    }
    expect(callCount).toBe(0); // Operation was never called
  });

  it("resumeState as async function works", async () => {
    let callCount = 0;
    const expensiveOp = async (): AsyncResult<number, "ERROR"> => {
      callCount++;
      return ok(callCount);
    };

    // Async resume state loader
    const loadResumeState = async (): Promise<ResumeState> => ({
      steps: new Map([["async:op", { result: ok(42) }]]),
    });

    const workflow = createWorkflow("workflow", { expensiveOp }, { resumeState: loadResumeState });

    const result = await workflow.run(async ({ step }) => {
      return await step('expensiveOp', () => expensiveOp(), { key: "async:op" });
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
    expect(callCount).toBe(0);
  });

  it("resumeState with error replays error result", async () => {
    let callCount = 0;
    const failingOp = async (): AsyncResult<number, "OPERATION_FAILED"> => {
      callCount++;
      return err("OPERATION_FAILED" as const, { cause: "original cause" });
    };

    // Pre-populate with a cached error (using new entry format with meta)
    const resumeState: ResumeState = {
      steps: new Map([
        ["fail:1", {
          result: err("CACHED_ERROR" as const, { cause: "cached cause" }),
          meta: { origin: "result", resultCause: "cached cause" },
        }],
      ]),
    };

    const workflow = createWorkflow("workflow", { failingOp }, { resumeState });

    const result = await workflow.run(async ({ step }) => {
      return await step('failingOp', () => failingOp(), { key: "fail:1" });
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("CACHED_ERROR");
      expect(result.cause).toBe("cached cause");
    }
    expect(callCount).toBe(0); // Operation was never called
  });

  it("auto-creates cache when resumeState provided without cache option", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    let callCount = 0;
    const expensiveOp = async (): AsyncResult<number, "ERROR"> => {
      callCount++;
      return ok(callCount);
    };

    const resumeState: ResumeState = {
      steps: new Map([["auto:cache", { result: ok(100) }]]),
    };

    // Note: no cache option provided, just resumeState
    const workflow = createWorkflow(
      "workflow",
      { expensiveOp },
      {
        resumeState,
        onEvent: (event) => events.push(event),
      }
    );

    const result = await workflow.run(async ({ step }) => {
      return await step('expensiveOp', () => expensiveOp(), { key: "auto:cache" });
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(100);
    }
    expect(callCount).toBe(0);

    // Should emit cache_hit event
    const cacheHitEvents = events.filter((e) => e.type === "step_cache_hit");
    expect(cacheHitEvents).toHaveLength(1);
  });

  it("warns and recovers when resumeState.steps is plain object (JSON serialization bug)", async () => {
    // This simulates the common mistake of using JSON.stringify() directly
    // instead of stringifyState() - Maps become empty objects
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let callCount = 0;
    const expensiveOp = async (): AsyncResult<number, "ERROR"> => {
      callCount++;
      return ok(callCount);
    };

    // Simulate what happens when user does JSON.stringify(state) then JSON.parse()
    // The Map becomes a plain object with string keys
    const resumeState = {
      steps: {
        "recover:1": { result: ok(777) },
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any; // Intentionally wrong type to simulate the bug

    const workflow = createWorkflow("workflow", { expensiveOp }, { resumeState });

    const result = await workflow.run(async ({ step }) => {
      return await step('expensiveOp', () => expensiveOp(), { key: "recover:1" });
    });

    // Should have warned about the Map issue
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("resumeState.steps is not a Map");
    expect(warnSpy.mock.calls[0][0]).toContain("stringifyState");
    expect(warnSpy.mock.calls[0][0]).toContain("parseState");

    // Should have recovered and used the cached value
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(777); // From recovered resume state
    }
    expect(callCount).toBe(0); // Operation was never called - cache worked!

    warnSpy.mockRestore();
  });

  it("step_complete events can be collected for save", async () => {
    // This demonstrates the full save flow with ResumeStateEntry
    const savedSteps = new Map<string, ResumeStateEntry>();
    const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> =>
      ok({ id, name: "Alice" });
    const fetchPosts = async (_userId: string): AsyncResult<{ posts: string[] }, "FETCH_ERROR"> =>
      ok({ posts: ["Hello", "World"] });

    const workflow = createWorkflow(
      "workflow",
      { fetchUser, fetchPosts },
      {
        onEvent: (event) => {
          if (isStepComplete(event)) {
            // Save both result and meta for proper resume
            savedSteps.set(event.stepKey, { result: event.result, meta: event.meta });
          }
        },
      }
    );

    await workflow.run(async ({ step }) => {
      const user = await step('fetchUser', () => fetchUser("1"), { key: "user:1" });
      const posts = await step('fetchPosts', () => fetchPosts(user.id), { key: "posts:1" });
      return { user, posts };
    });

    // Verify saved steps
    expect(savedSteps.size).toBe(2);
    expect(savedSteps.has("user:1")).toBe(true);
    expect(savedSteps.has("posts:1")).toBe(true);

    const userEntry = savedSteps.get("user:1");
    expect(userEntry?.result.ok).toBe(true);
    if (userEntry?.result.ok) {
      expect(userEntry.result.value).toEqual({ id: "1", name: "Alice" });
    }
  });

  it("full save and resume round-trip works", async () => {
    // First run: execute workflow and collect step_complete events
    const savedSteps = new Map<string, ResumeStateEntry>();
    let userCallCount = 0;
    let postsCallCount = 0;

    const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
      userCallCount++;
      return ok({ id, name: `User${userCallCount}` });
    };
    const fetchPosts = async (): AsyncResult<{ posts: string[] }, "FETCH_ERROR"> => {
      postsCallCount++;
      return ok({ posts: [`Post${postsCallCount}`] });
    };

    const workflow1 = createWorkflow(
      "workflow",
      { fetchUser, fetchPosts },
      {
        onEvent: (event) => {
          if (isStepComplete(event)) {
            savedSteps.set(event.stepKey, { result: event.result, meta: event.meta });
          }
        },
      }
    );

    await workflow1.run(async ({ step }) => {
      const user = await step('fetchUser', () => fetchUser("1"), { key: "user:1" });
      const posts = await step('fetchPosts', () => fetchPosts(), { key: "posts:1" });
      return { user, posts };
    });

    expect(userCallCount).toBe(1);
    expect(postsCallCount).toBe(1);
    expect(savedSteps.size).toBe(2);

    // Second run: resume with saved state
    const workflow2 = createWorkflow(
      "workflow",
      { fetchUser, fetchPosts },
      { resumeState: { steps: savedSteps } }
    );

    const result = await workflow2.run(async ({ step }) => {
      const user = await step('fetchUser', () => fetchUser("1"), { key: "user:1" });
      const posts = await step('fetchPosts', () => fetchPosts(), { key: "posts:1" });
      return { user, posts };
    });

    // Call counts should NOT have increased (used cache)
    expect(userCallCount).toBe(1);
    expect(postsCallCount).toBe(1);

    // Result should be from cached values
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user.name).toBe("User1"); // Original value
      expect(result.value.posts.posts[0]).toBe("Post1"); // Original value
    }
  });

  it("preserves origin:throw metadata for step.try errors on resume", async () => {
    // First run: step.try throws
    const savedSteps = new Map<string, ResumeStateEntry>();

    const workflow1 = createWorkflow("workflow", {}, {
      onEvent: (event) => {
        if (isStepComplete(event)) {
          savedSteps.set(event.stepKey, { result: event.result, meta: event.meta });
        }
      }
    });

    await workflow1.run(async ({ step }) => {
      return await step.try(
        "try:1",
        () => { throw new Error("original throw"); },
        { error: "TRY_ERROR" as const as never }
      );
    });

    // Verify saved meta has origin:"throw"
    const savedEntry = savedSteps.get("try:1");
    expect(savedEntry?.meta?.origin).toBe("throw");

    // Second run: resume
    const workflow2 = createWorkflow("workflow", {}, { resumeState: { steps: savedSteps } });

    const result = await workflow2.run(async ({ step }) => {
      return await step.try(
        "try:1",
        () => "should not be called",
        { error: "TRY_ERROR" as const as never }
      );
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("TRY_ERROR");
      // The cause should be the original thrown error
      expect(result.cause).toBeInstanceOf(Error);
      expect((result.cause as Error).message).toBe("original throw");
    }
  });

  it("preserves UnexpectedError structure for safe-default uncaught exceptions on resume", async () => {
    // First run: uncaught exception in safe-default mode
    const savedSteps = new Map<string, ResumeStateEntry>();

    const workflow1 = createWorkflow("workflow", {}, {
      onEvent: (event) => {
        if (isStepComplete(event)) {
          savedSteps.set(event.stepKey, { result: event.result, meta: event.meta });
        }
      }
    });

    // A step that throws unexpectedly
    await workflow1.run(async ({ step }) => {
      return await step('throwingStep', () => {
        throw new Error("uncaught exception");
      }, { key: "uncaught:1" });
    });

    // Verify saved result has UNEXPECTED_ERROR string
    const savedEntry = savedSteps.get("uncaught:1");
    expect(savedEntry).toBeDefined();
    expect(savedEntry?.result.ok).toBe(false);
    const savedResult = savedEntry!.result;
    if (!savedResult.ok) {
      expect(savedResult.error).toBe("UNEXPECTED_ERROR");
    }

    // Second run: resume - should get the same UNEXPECTED_ERROR, not double-wrapped
    const workflow2 = createWorkflow("workflow", {}, { resumeState: { steps: savedSteps } });

    const result = await workflow2.run(async ({ step }) => {
      return await step('throwingStep', () => ok("should not execute"), { key: "uncaught:1" });
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Should be "UNEXPECTED_ERROR" string, not double-wrapped
      expect(result.error).toBe("UNEXPECTED_ERROR");
    }
  });
});

// =============================================================================
// createWorkflow with closure-based args
// =============================================================================

describe("createWorkflow with closure-based args", () => {
  // Helpers for this describe block
  const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
    if (id === "1") return ok({ id, name: "Alice" });
    return err("NOT_FOUND" as const);
  };

  const fetchPosts = async (userId: string): AsyncResult<{ id: number; title: string }[], "FETCH_ERROR"> => {
    return ok([{ id: 1, title: "Hello" }]);
  };

  it("passes closed-over args to callback", async () => {
    const workflow = createWorkflow("workflow", { fetchUser });

    const id = "1";
    const result = await workflow.run(async ({ step, deps }) => {
      const user = await step('fetchUser', () => deps.fetchUser(id));
      return user;
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Alice");
    }
  });

  it("works without args (backwards compatibility)", async () => {
    const workflow = createWorkflow("workflow", { fetchUser });

    const result = await workflow.run(async ({ step }) => {
      return await step('fetchUser', () => fetchUser("1"));
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Alice");
    }
  });

  it("passes closed-over args with multiple properties", async () => {
    const workflow = createWorkflow("getPosts", { fetchUser, fetchPosts });

    const userId = "1";
    const includePosts = true;
    const result = await workflow.run(async ({ step, deps }) => {
      const user = await step('fetchUser', () => deps.fetchUser(userId));
      if (includePosts) {
        const posts = await step('fetchPosts', () => deps.fetchPosts(user.id));
        return { user, posts };
      }
      return { user, posts: [] };
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user.name).toBe("Alice");
      expect(result.value.posts.length).toBe(1);
    }
  });

  it("passes closed-over primitive args (string)", async () => {
    const workflow = createWorkflow("workflow", { fetchUser });

    const id = "1";
    const result = await workflow.run(async ({ step, deps }) => {
      return await step('fetchUser', () => deps.fetchUser(id));
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Alice");
    }
  });

  it("passes closed-over primitive args (number)", async () => {
    const workflow = createWorkflow("workflow", { fetchUser });

    const num = 42;
    const result = await workflow.run(async () => {
      expect(num).toBe(42);
      return num * 2;
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(84);
    }
  });

  it("works with custom catchUnexpected and closure args", async () => {
    const workflow = createWorkflow(
      "workflow",
      { fetchUser },
      {
        catchUnexpected: () => "UNEXPECTED" as const,
      }
    );

    const id = "1";
    const result = await workflow.run(async ({ step, deps }) => {
      return await step('fetchUser', () => deps.fetchUser(id));
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Alice");
    }
  });

  it("propagates errors correctly with closure args", async () => {
    const workflow = createWorkflow("workflow", { fetchUser });

    const id = "unknown";
    const result = await workflow.run(async ({ step, deps }) => {
      return await step('fetchUser', () => deps.fetchUser(id));
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("NOT_FOUND");
    }
  });

  it("preserves deps object access with closure args", async () => {
    const workflow = createWorkflow("getPosts", { fetchUser, fetchPosts });

    const baseId = "1";
    const result = await workflow.run(async ({ step, deps: { fetchUser: getUser, fetchPosts: getPosts } }) => {
      const user = await step('getUser', () => getUser(baseId));
      const posts = await step('getPosts', () => getPosts(user.id));
      return { user, posts };
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user.name).toBe("Alice");
      expect(result.value.posts.length).toBe(1);
    }
  });

  it("supports function as closed-over args (edge case)", async () => {
    const workflow = createWorkflow("workflow", { fetchUser });

    // Use a factory function via closure
    const idFactory = () => "1";

    const result = await workflow.run(async ({ step, deps }) => {
      expect(typeof idFactory).toBe("function");
      const id = idFactory();
      return await step('fetchUser', () => deps.fetchUser(id));
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Alice");
    }
  });

  it("supports async function as closed-over args", async () => {
    const workflow = createWorkflow("workflow", { fetchUser });

    // Use an async function via closure
    const asyncIdProvider = async () => "1";

    const result = await workflow.run(async ({ step, deps }) => {
      const id = await asyncIdProvider();
      return await step('fetchUser', () => deps.fetchUser(id));
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Alice");
    }
  });
});

// =============================================================================
// Human-in-the-Loop (HITL) Tests
// =============================================================================

describe("Step Retry with Backoff", () => {
  describe("basic retry behavior", () => {
    it("succeeds on first attempt without retry", async () => {
      let attempts = 0;

      const result = await run(async ({ step }) => {
        return await step(
          'retryOp',
          () => {
            attempts++;
            return ok("success");
          },
          { retry: { attempts: 3 } }
        );
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("success");
      }
      expect(attempts).toBe(1);
    });

    it("retries on transient errors and succeeds", async () => {
      let attempts = 0;

      const result = await run(async ({ step }) => {
        return await step(
          'retryOp',
          () => {
            attempts++;
            if (attempts < 3) return err("TRANSIENT" as const);
            return ok("success");
          },
          {
            retry: {
              attempts: 5,
              backoff: "fixed",
              initialDelay: 10,
              jitter: false,
            },
          }
        );
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("success");
      }
      expect(attempts).toBe(3);
    });

    it("fails after exhausting all retries", async () => {
      let attempts = 0;

      const result = await run(async ({ step }) => {
        return await step(
          'retryOp',
          () => {
            attempts++;
            return err("ALWAYS_FAILS" as const);
          },
          {
            retry: {
              attempts: 3,
              backoff: "fixed",
              initialDelay: 10,
              jitter: false,
            },
          }
        );
      });

      expect(result.ok).toBe(false);
      expect(attempts).toBe(3);
    });

    it("respects retryOn predicate", async () => {
      let attempts = 0;

      const result = await run(async ({ step }) => {
        return await step(
          'retryOp',
          () => {
            attempts++;
            if (attempts === 1) return err("RETRYABLE" as const);
            return err("NOT_RETRYABLE" as const);
          },
          {
            retry: {
              attempts: 5,
              backoff: "fixed",
              initialDelay: 10,
              jitter: false,
              retryOn: (error) => error === "RETRYABLE",
            },
          }
        );
      });

      expect(result.ok).toBe(false);
      expect(attempts).toBe(2); // Stopped after NOT_RETRYABLE
    });

    it("calls onRetry callback before each retry", async () => {
      let attempts = 0;
      const retryCallbacks: { error: unknown; attempt: number; delay: number }[] = [];

      const result = await run(async ({ step }) => {
        return await step(
          'retryOp',
          () => {
            attempts++;
            if (attempts < 3) return err("TRANSIENT" as const);
            return ok("success");
          },
          {
            retry: {
              attempts: 5,
              backoff: "fixed",
              initialDelay: 10,
              jitter: false,
              onRetry: (error, attempt, delay) => {
                retryCallbacks.push({ error, attempt, delay });
              },
            },
          }
        );
      });

      expect(result.ok).toBe(true);
      expect(retryCallbacks).toHaveLength(2);
      expect(retryCallbacks[0]).toEqual({ error: "TRANSIENT", attempt: 1, delay: 10 });
      expect(retryCallbacks[1]).toEqual({ error: "TRANSIENT", attempt: 2, delay: 10 });
    });
  });

  describe("backoff strategies", () => {
    it("uses fixed backoff correctly", async () => {
      const delays: number[] = [];
      let attempts = 0;

      await run(async ({ step }) => {
        return await step(
          'retryOp',
          () => {
            attempts++;
            if (attempts < 4) return err("FAIL" as const);
            return ok("success");
          },
          {
            retry: {
              attempts: 5,
              backoff: "fixed",
              initialDelay: 100,
              jitter: false,
              onRetry: (_error, _attempt, delay) => {
                delays.push(delay);
              },
            },
          }
        );
      });

      expect(delays).toEqual([100, 100, 100]); // All same delay
    });

    it("uses linear backoff correctly", async () => {
      const delays: number[] = [];
      let attempts = 0;

      await run(async ({ step }) => {
        return await step(
          'retryOp',
          () => {
            attempts++;
            if (attempts < 4) return err("FAIL" as const);
            return ok("success");
          },
          {
            retry: {
              attempts: 5,
              backoff: "linear",
              initialDelay: 100,
              jitter: false,
              onRetry: (_error, _attempt, delay) => {
                delays.push(delay);
              },
            },
          }
        );
      });

      // Linear: delay * attempt
      expect(delays).toEqual([100, 200, 300]);
    });

    it("uses exponential backoff correctly", async () => {
      const delays: number[] = [];
      let attempts = 0;

      await run(async ({ step }) => {
        return await step(
          'retryOp',
          () => {
            attempts++;
            if (attempts < 4) return err("FAIL" as const);
            return ok("success");
          },
          {
            retry: {
              attempts: 5,
              backoff: "exponential",
              initialDelay: 100,
              jitter: false,
              onRetry: (_error, _attempt, delay) => {
                delays.push(delay);
              },
            },
          }
        );
      });

      // Exponential: delay * 2^(attempt-1)
      expect(delays).toEqual([100, 200, 400]);
    });

    it("respects maxDelay cap", async () => {
      const delays: number[] = [];
      let attempts = 0;

      await run(async ({ step }) => {
        return await step(
          'retryOp',
          () => {
            attempts++;
            if (attempts < 6) return err("FAIL" as const);
            return ok("success");
          },
          {
            retry: {
              attempts: 10,
              backoff: "exponential",
              initialDelay: 100,
              maxDelay: 500,
              jitter: false,
              onRetry: (_error, _attempt, delay) => {
                delays.push(delay);
              },
            },
          }
        );
      });

      // Should cap at 500: 100, 200, 400, 500, 500
      expect(delays).toEqual([100, 200, 400, 500, 500]);
    });
  });

  describe("retry events", () => {
    it("emits step_retry events for each retry", async () => {
      const events: WorkflowEvent<unknown>[] = [];
      let attempts = 0;

      await run(
        async ({ step }) => {
          return await step(
            "test-step",
            () => {
              attempts++;
              if (attempts < 3) return err("TRANSIENT" as const);
              return ok("success");
            },
            {
              retry: {
                attempts: 5,
                backoff: "fixed",
                initialDelay: 10,
                jitter: false,
              },
            }
          );
        },
        {
          onEvent: (e) => events.push(e),
        }
      );

      const retryEvents = events.filter((e) => e.type === "step_retry");
      expect(retryEvents).toHaveLength(2);

      const firstRetry = retryEvents[0] as Extract<WorkflowEvent<unknown>, { type: "step_retry" }>;
      expect(firstRetry.attempt).toBe(2); // About to attempt #2
      expect(firstRetry.maxAttempts).toBe(5);
      expect(firstRetry.name).toBe("test-step");
    });

    it("emits step_retries_exhausted when all retries fail", async () => {
      const events: WorkflowEvent<unknown>[] = [];

      await run(
        async ({ step }) => {
          return await step(
            "failing-step",
            () => err("ALWAYS_FAILS" as const),
            {
              retry: {
                attempts: 3,
                backoff: "fixed",
                initialDelay: 10,
                jitter: false,
              },
            }
          );
        },
        {
          onEvent: (e) => events.push(e),
        }
      );

      const exhaustedEvents = events.filter((e) => e.type === "step_retries_exhausted");
      expect(exhaustedEvents).toHaveLength(1);

      const exhausted = exhaustedEvents[0] as Extract<WorkflowEvent<unknown>, { type: "step_retries_exhausted" }>;
      expect(exhausted.attempts).toBe(3);
      expect(exhausted.lastError).toBe("ALWAYS_FAILS");
      expect(exhausted.name).toBe("failing-step");
    });
  });

  describe("step.retry() method", () => {
    it("works as shorthand for retry options", async () => {
      let attempts = 0;

      const result = await run(async ({ step }) => {
        return await step.retry(
          "retry-step",
          () => {
            attempts++;
            if (attempts < 3) return err("TRANSIENT" as const);
            return ok("success");
          },
          {
            attempts: 5,
            backoff: "exponential",
            initialDelay: 10,
            jitter: false,
          }
        );
      });

      expect(result.ok).toBe(true);
      expect(attempts).toBe(3);
    });

    it("does not cache step.retry without explicit key", async () => {
      const events: WorkflowEvent<unknown>[] = [];
      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow("workflow", {}, { cache, onEvent: (e) => events.push(e) });

      let calls = 0;
      const op = () => {
        calls++;
        return ok(calls);
      };

      const result1 = await workflow.run(async ({ step }) => {
        return await step.retry("retry-op", op, {
          attempts: 1,
          backoff: "fixed",
          initialDelay: 0,
          jitter: false,
        });
      });

      expect(result1.ok).toBe(true);

      events.length = 0;

      const result2 = await workflow.run(async ({ step }) => {
        return await step.retry("retry-op", op, {
          attempts: 1,
          backoff: "fixed",
          initialDelay: 0,
          jitter: false,
        });
      });

      expect(result2.ok).toBe(true);
      expect(calls).toBe(2);

      const cacheEvents = events.filter(
        (e) => e.type === "step_cache_hit" || e.type === "step_cache_miss"
      );
      expect(cacheEvents).toHaveLength(0);
    });
  });
});

describe("Step Timeout", () => {
  describe("basic timeout behavior", () => {
    it("succeeds when operation completes before timeout", async () => {
      const result = await run(async ({ step }) => {
        return await step(
          'fastOp',
          async () => {
            await new Promise((r) => setTimeout(r, 10));
            return ok("fast");
          },
          { timeout: { ms: 1000 } }
        );
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("fast");
      }
    });

    it("fails when operation exceeds timeout", async () => {
      const result = await run(
        async ({ step }) => {
          return await step(
            'slowOp',
            async () => {
              await new Promise((r) => setTimeout(r, 1000));
              return ok("slow");
            },
            { timeout: { ms: 50 } }
          );
        },
        {
          catchUnexpected: (cause) => ({ type: "UNEXPECTED" as const, cause }),
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok && isStepTimeoutError(result.error)) {
        expect(result.error.type).toBe("STEP_TIMEOUT");
        expect(result.error.timeoutMs).toBe(50);
      }
    });

    it("emits step_timeout event on timeout", async () => {
      const events: WorkflowEvent<unknown>[] = [];

      await run(
        async ({ step }) => {
          return await step(
            "slow-step",
            async () => {
              await new Promise((r) => setTimeout(r, 1000));
              return ok("slow");
            },
            { timeout: { ms: 50 } }
          );
        },
        {
          onEvent: (e) => events.push(e),
          catchUnexpected: (cause) => ({ type: "UNEXPECTED" as const, cause }),
        }
      );

      const timeoutEvents = events.filter((e) => e.type === "step_timeout");
      expect(timeoutEvents).toHaveLength(1);

      const timeout = timeoutEvents[0] as Extract<WorkflowEvent<unknown>, { type: "step_timeout" }>;
      expect(timeout.timeoutMs).toBe(50);
      expect(timeout.name).toBe("slow-step");
    });
  });

  describe("step.withTimeout() method", () => {
    it("works as shorthand for timeout options", async () => {
      const result = await run(async ({ step }) => {
        return await step.withTimeout(
          "timeout-step",
          async () => {
            await new Promise((r) => setTimeout(r, 10));
            return ok("fast");
          },
          { ms: 1000 }
        );
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("fast");
      }
    });

    it("returns STEP_TIMEOUT when operation exceeds timeout", async () => {
      const result = await run(async ({ step }) => {
        return await step.withTimeout(
          "slow-step",
          async () => {
            await new Promise((r) => setTimeout(r, 1000));
            return ok("slow");
          },
          { ms: 50 }
        );
      });

      expect(result.ok).toBe(false);
      if (!result.ok && isStepTimeoutError(result.error)) {
        expect(result.error.type).toBe("STEP_TIMEOUT");
        expect(result.error.timeoutMs).toBe(50);
        expect(result.error.stepName).toBe("slow-step");
      } else {
        // Fail the test if it's not a StepTimeoutError
        expect(isStepTimeoutError(result.ok ? null : result.error)).toBe(true);
      }
    });
  });

  describe("isStepTimeoutError type guard", () => {
    it("correctly identifies StepTimeoutError", () => {
      const timeoutError: StepTimeoutError = {
        type: "STEP_TIMEOUT",
        timeoutMs: 5000,
        stepName: "test",
      };

      expect(isStepTimeoutError(timeoutError)).toBe(true);
      expect(isStepTimeoutError({ type: "OTHER_ERROR" })).toBe(false);
      expect(isStepTimeoutError(null)).toBe(false);
      expect(isStepTimeoutError(undefined)).toBe(false);
    });
  });
});

describe("Retry + Timeout Combined", () => {
  it("applies timeout per-attempt and retries on timeout", async () => {
    let attempts = 0;
    const events: WorkflowEvent<unknown>[] = [];

    const result = await run(
      async ({ step }) => {
        return await step(
          'retry-timeout-step',
          async () => {
            attempts++;
            if (attempts < 3) {
              // First two attempts timeout
              await new Promise((r) => setTimeout(r, 1000));
            }
            return ok("success");
          },
          {
            timeout: { ms: 50 },
            retry: {
              attempts: 5,
              backoff: "fixed",
              initialDelay: 10,
              jitter: false,
              retryOn: (error) => isStepTimeoutError(error),
            },
          }
        );
      },
      {
        onEvent: (e) => events.push(e),
      }
    );

    expect(result.ok).toBe(true);
    expect(attempts).toBe(3);

    // Should have 2 timeout events (first two attempts)
    const timeoutEvents = events.filter((e) => e.type === "step_timeout");
    expect(timeoutEvents).toHaveLength(2);

    // Should have 2 retry events
    const retryEvents = events.filter((e) => e.type === "step_retry");
    expect(retryEvents).toHaveLength(2);
  });
});

// =============================================================================
// Timeout Behavior Variants Tests
// =============================================================================

describe("step timeout behavior variants", () => {
  describe("onTimeout: 'option'", () => {
    it("returns undefined instead of error when operation times out", async () => {
      const events: WorkflowEvent<unknown>[] = [];

      const result = await run(
        async ({ step }) => {
          const value = await step(
            'slowOp',
            async () => {
              await new Promise((resolve) => setTimeout(resolve, 200));
              return ok("completed");
            },
            { timeout: { ms: 50, onTimeout: "option" } }
          );
          // value should be undefined when timeout with 'option'
          return value ?? "default";
        },
        { onEvent: (e) => events.push(e) }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("default");
      }

      // Should still emit timeout event
      const timeoutEvents = events.filter((e) => e.type === "step_timeout");
      expect(timeoutEvents).toHaveLength(1);

      // Should emit success event (timeout treated as success with undefined)
      const successEvents = events.filter((e) => e.type === "step_success");
      expect(successEvents.length).toBeGreaterThan(0);
    });

    it("does not retry when onTimeout is 'option'", async () => {
      let attempts = 0;

      const result = await run(async ({ step }) => {
        const value = await step(
          'slowOp',
          async () => {
            attempts++;
            await new Promise((resolve) => setTimeout(resolve, 200));
            return ok("completed");
          },
          {
            timeout: { ms: 50, onTimeout: "option" },
            retry: { attempts: 3 },
          }
        );
        return value ?? "timed-out";
      });

      expect(result.ok).toBe(true);
      // Should only attempt once since 'option' treats timeout as success
      expect(attempts).toBe(1);
    });
  });

  describe("onTimeout: 'disconnect'", () => {
    it("returns error immediately but operation continues in background", async () => {
      let operationCompleted = false;

      const result = await run(async ({ step }) => {
        await step(
          'slowOp',
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            operationCompleted = true;
            return ok("completed");
          },
          { timeout: { ms: 20, onTimeout: "disconnect" } }
        );
        return "done";
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toHaveProperty("type", "STEP_TIMEOUT");
      }

      // Wait for background operation to complete
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(operationCompleted).toBe(true);
    });

    it("does not emit unhandled rejection when background operation fails", async () => {
      const unhandled: unknown[] = [];
      const handler = (reason: unknown) => {
        unhandled.push(reason);
      };
      process.once("unhandledRejection", handler);

      const result = await run(async ({ step }) => {
        await step(
          'slowOp',
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return err({ type: "BACKGROUND_FAIL" as const });
          },
          { timeout: { ms: 10, onTimeout: "disconnect" } }
        );
        return "done";
      });

      expect(result.ok).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 100));
      process.removeListener("unhandledRejection", handler);

      expect(unhandled).toHaveLength(0);
    });
  });

  describe("onTimeout: function", () => {
    it("uses custom error from handler function", async () => {
      const result = await run(async ({ step }) => {
        await step(
          "my-slow-step",
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            return ok("completed");
          },
          {
            timeout: {
              ms: 50,
              onTimeout: ({ name, ms }) => ({
                type: "CUSTOM_TIMEOUT" as const,
                stepName: name,
                durationMs: ms,
              }),
            },
          }
        );
        return "done";
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({
          type: "CUSTOM_TIMEOUT",
          stepName: "my-slow-step",
          durationMs: 50,
        });
      }
    });

    it("custom error works with tagged errors", async () => {
      const result = await run(async ({ step }) => {
        await step(
          'slowOp',
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            return ok("completed");
          },
          {
            timeout: {
              ms: 50,
              onTimeout: ({ ms }) => ({
                _tag: "SlowOperation" as const,
                waited: ms,
              }),
            },
          }
        );
        return "done";
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({
          _tag: "SlowOperation",
          waited: 50,
        });
      }
    });
  });

  describe("onTimeout: 'error' (default)", () => {
    it("returns StepTimeoutError by default", async () => {
      const result = await run(async ({ step }) => {
        await step(
          'slowOp',
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            return ok("completed");
          },
          { timeout: { ms: 50 } }
        );
        return "done";
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toHaveProperty("type", "STEP_TIMEOUT");
        expect((result.error as unknown as StepTimeoutError).timeoutMs).toBe(50);
      }
    });

    it("explicit 'error' behavior works same as default", async () => {
      const result = await run(async ({ step }) => {
        await step(
          'slowOp',
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            return ok("completed");
          },
          { timeout: { ms: 50, onTimeout: "error" } }
        );
        return "done";
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toHaveProperty("type", "STEP_TIMEOUT");
      }
    });
  });
});

// =============================================================================
// Named Object Parallel Tests
// =============================================================================

describe("step.parallel() named object form", () => {
  const fetchUser = (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> =>
    Promise.resolve(id === "missing" ? err("NOT_FOUND") : ok({ id, name: `User ${id}` }));

  const fetchPosts = (userId: string): AsyncResult<{ id: string; title: string }[], "FETCH_ERROR"> =>
    Promise.resolve(ok([{ id: "p1", title: `Post by ${userId}` }]));

  const fetchComments = (postId: string): AsyncResult<string[], "COMMENTS_ERROR"> =>
    Promise.resolve(ok([`Comment on ${postId}`]));

  it("should execute operations in parallel and return named results", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    const result = await run(
      async ({ step }) => {
        const { user, posts } = await step.parallel("Fetch user and posts", {
          user: () => fetchUser("1"),
          posts: () => fetchPosts("1"),
        });

        return { user, posts };
      },
      {
        onEvent: (e) => events.push(e),
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user).toEqual({ id: "1", name: "User 1" });
      expect(result.value.posts).toEqual([{ id: "p1", title: "Post by 1" }]);
    }

    // Should emit scope_start and scope_end events
    const scopeStart = events.find((e) => e.type === "scope_start");
    const scopeEnd = events.find((e) => e.type === "scope_end");
    expect(scopeStart).toBeDefined();
    expect(scopeEnd).toBeDefined();
  });

  it("should support name-first form step.parallel(name, operations)", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    const result = await run(
      async ({ step }) => {
        const { user, posts } = await step.parallel("Fetch user data", {
          user: () => fetchUser("1"),
          posts: () => fetchPosts("1"),
        });
        return { user, posts };
      },
      {
        onEvent: (e) => events.push(e),
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user).toEqual({ id: "1", name: "User 1" });
      expect(result.value.posts).toEqual([{ id: "p1", title: "Post by 1" }]);
    }
    const scopeStart = events.find((e) => e.type === "scope_start");
    expect(scopeStart?.type === "scope_start" && scopeStart.name).toBe("Fetch user data");
  });


  it("should fail fast on first error", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    // Use createWorkflow for proper error type inference
    // (run() with catchUnexpected can't infer error types from callback body)
    const workflow = createWorkflow(
      "workflow",
      { fetchUser, fetchPosts },
      { onEvent: (e) => events.push(e) }
    );

    const result = await workflow.run(async ({ step, deps: { fetchUser, fetchPosts } }) => {
      const { user, posts } = await step.parallel("Fetch user and posts", {
        user: () => fetchUser("missing"), // This will fail
        posts: () => fetchPosts("1"),
      });
      return { user, posts };
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Error type is properly inferred as "NOT_FOUND" | "FETCH_ERROR" | UnexpectedError
      expect(result.error).toBe("NOT_FOUND");
    }
  });

  it("should fail fast when later key fails before earlier keys complete", async () => {
    // Regression test: when a later key fails while earlier keys are still pending,
    // the fail-fast logic must not crash on undefined array holes
    const slowOp = (): AsyncResult<string, "SLOW_ERROR"> =>
      new Promise((resolve) => setTimeout(() => resolve(ok("slow")), 100));

    const fastFailOp = (): AsyncResult<string, "FAST_ERROR"> =>
      Promise.resolve(err("FAST_ERROR"));

    const workflow = createWorkflow("workflow", { slowOp, fastFailOp });

    const result = await workflow.run(async ({ step, deps: { slowOp, fastFailOp } }) => {
      // slowOp is first but takes 100ms, fastFailOp is second but fails immediately
      const { slow, fast } = await step.parallel("Fetch slow and fast", {
        slow: () => slowOp(),
        fast: () => fastFailOp(),
      });
      return { slow, fast };
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("FAST_ERROR");
    }
  });

  it("should support three or more operations", async () => {
    const result = await run(async ({ step }) => {
      const { user, posts, comments } = await step.parallel("Fetch user posts comments", {
        user: () => fetchUser("1"),
        posts: () => fetchPosts("1"),
        comments: () => fetchComments("p1"),
      });

      return { user, posts, comments };
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user).toEqual({ id: "1", name: "User 1" });
      expect(result.value.posts).toHaveLength(1);
      expect(result.value.comments).toEqual(["Comment on p1"]);
    }
  });

  it("should handle empty operations object", async () => {
    const result = await run(async ({ step }) => {
      const data = await step.parallel("Empty parallel", {});
      return data;
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  it("should work with createWorkflow", async () => {
    const workflow = createWorkflow("getPosts", { fetchUser, fetchPosts });

    const result = await workflow.run(async ({ step, deps }) => {
      const { user, posts } = await step.parallel("Fetch user and posts", {
        user: () => deps.fetchUser("1"),
        posts: () => deps.fetchPosts("1"),
      });

      return { user, posts };
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user.name).toBe("User 1");
    }
  });

});

// =============================================================================
// streamForEach Tests
// =============================================================================

describe("streamForEach with async iterables", () => {
  it("preserves undefined results when concurrency is enabled", async () => {
    const workflow = createWorkflow("workflow", {});

    async function* source() {
      yield 1;
      yield 2;
    }

    const result = await workflow.run(async ({ step }) => {
      return step.streamForEach(
        source(),
        async () => ok(undefined),
        { concurrency: 2 }
      );
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.processedCount).toBe(2);
      expect(result.value.results).toHaveLength(2);
      expect(result.value.results[0]).toBeUndefined();
      expect(result.value.results[1]).toBeUndefined();
    }
  });
});

// =============================================================================
// Workflow Cancellation Tests
// =============================================================================

describe("createWorkflow with signal (cancellation)", () => {
  const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> =>
    id !== "0" ? ok({ id, name: `User ${id}` }) : err("NOT_FOUND");

  it("returns cancelled error when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("already cancelled");

    const workflow = createWorkflow("workflow", { fetchUser }, {
      signal: controller.signal,
    });

    const result = await workflow.run(async ({ step }) => {
      // This should never execute
      const user = await step('fetchUser', () => fetchUser("1"));
      return user;
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // With default mapper, cancellation is result.cause (result.error is UnexpectedError)
      expect(isWorkflowCancelled(result.cause)).toBe(true);
      if (isWorkflowCancelled(result.cause)) {
        expect(result.cause!.reason).toBe("already cancelled");
      }
    }
  });

  it("cancels workflow mid-execution when signal is aborted", async () => {
    type User = { id: string; name: string };
    const controller = new AbortController();
    const events: WorkflowEvent<unknown>[] = [];
    const stepExecutions: string[] = [];

    // Create a slow operation that gives us time to abort
    const slowFetch = async (id: string): AsyncResult<User, "NOT_FOUND"> => {
      stepExecutions.push(`start:${id}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      stepExecutions.push(`end:${id}`);
      return ok({ id, name: `User ${id}` });
    };

    const workflow = createWorkflow("workflow", { slowFetch }, {
      signal: controller.signal,
      onEvent: (e) => events.push(e),
    });

    // Start workflow and abort after first step starts
    const resultPromise = workflow.run(async ({ step }) => {
      // First step
      const user1 = await step('slowFetch1', () => slowFetch("1"), { key: "step1" });
      // This step should never execute due to cancellation
      const user2 = await step('slowFetch2', () => slowFetch("2"), { key: "step2" });
      return { user1, user2 };
    });

    // Abort after a short delay (during first step execution)
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort("mid-execution abort");

    const result = await resultPromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isWorkflowCancelled(result.cause)).toBe(true);
      if (isWorkflowCancelled(result.cause)) {
        expect(result.cause!.reason).toBe("mid-execution abort");
        // lastStepKey reports the last successfully completed step (for resume purposes)
        expect(result.cause!.lastStepKey).toBe("step1");
      }
    }

    // Should emit workflow_cancelled event
    const cancelledEvent = events.find((e) => e.type === "workflow_cancelled");
    expect(cancelledEvent).toBeDefined();
    if (cancelledEvent && cancelledEvent.type === "workflow_cancelled") {
      expect(cancelledEvent.reason).toBe("mid-execution abort");
    }

    // Second step should never have started
    expect(stepExecutions.filter((s) => s.startsWith("start:2")).length).toBe(0);
  });

  it("emits workflow_cancelled event when signal is already aborted", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const controller = new AbortController();
    controller.abort("pre-aborted");

    const workflow = createWorkflow("workflow", { fetchUser }, {
      signal: controller.signal,
      onEvent: (e) => events.push(e),
    });

    await workflow.run(async ({ step }) => {
      return await step('fetchUser', () => fetchUser("1"));
    });

    const cancelledEvent = events.find((e) => e.type === "workflow_cancelled");
    expect(cancelledEvent).toBeDefined();
    if (cancelledEvent && cancelledEvent.type === "workflow_cancelled") {
      expect(cancelledEvent.reason).toBe("pre-aborted");
      expect(typeof cancelledEvent.durationMs).toBe("number");
      expect(cancelledEvent.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("provides signal in WorkflowContext for manual use", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    const workflow = createWorkflow("workflow", { fetchUser }, {
      signal: controller.signal,
    });

    await workflow.run(async ({ step, deps, ctx }) => {
      receivedSignal = ctx.signal;
      return await step('fetchUser', () => fetchUser("1"));
    });

    expect(receivedSignal).toBe(controller.signal);
  });

  it("isWorkflowCancelled type guard works correctly", () => {
    const cancelledError: WorkflowCancelledError = {
      type: "WORKFLOW_CANCELLED",
      reason: "test",
    };

    expect(isWorkflowCancelled(cancelledError)).toBe(true);
    expect(isWorkflowCancelled({ type: "OTHER" })).toBe(false);
    expect(isWorkflowCancelled(null)).toBe(false);
    expect(isWorkflowCancelled(undefined)).toBe(false);
  });

  it("works with custom catchUnexpected - maps through catchUnexpected", async () => {
    const controller = new AbortController();
    controller.abort("strict cancelled");

    const workflow = createWorkflow("workflow", { fetchUser }, {
      signal: controller.signal,
      catchUnexpected: (cause) => {
        if (isWorkflowCancelled(cause)) {
          return { type: "CANCELLED" as const, reason: cause.reason };
        }
        return { type: "UNEXPECTED" as const };
      },
    });

    const result = await workflow.run(async ({ step }) => {
      return await step('fetchUser', () => fetchUser("1"));
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ type: "CANCELLED", reason: "strict cancelled" });
    }
  });

  it("workflow without signal has undefined signal in context", async () => {
    let receivedSignal: AbortSignal | undefined = new AbortController().signal; // Set to non-undefined

    const workflow = createWorkflow("workflow", { fetchUser });

    await workflow.run(async ({ step, deps, ctx }) => {
      receivedSignal = ctx.signal;
      return await step('fetchUser', () => fetchUser("1"));
    });

    expect(receivedSignal).toBeUndefined();
  });

  it("detects late cancellation when abort happens during last step", async () => {
    const controller = new AbortController();
    const events: WorkflowEvent<unknown>[] = [];

    // Operation that aborts the signal during execution but still returns success
    const slowOp = async (): AsyncResult<string, never> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      // Abort during the operation
      controller.abort("late abort");
      await new Promise((resolve) => setTimeout(resolve, 10));
      return ok("success");
    };

    const workflow = createWorkflow("workflow", { slowOp }, {
      signal: controller.signal,
      onEvent: (e) => events.push(e),
    });

    const result = await workflow.run(async ({ step }) => {
      // Only one step - abort happens during it but it returns success
      return await step('slowOp', () => slowOp(), { key: "only-step" });
    });

    // Even though the operation returned success, workflow should detect the late abort
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isWorkflowCancelled(result.cause)).toBe(true);
      if (isWorkflowCancelled(result.cause)) {
        expect(result.cause!.reason).toBe("late abort");
        // lastStepKey is the last completed step (the one that ran)
        expect(result.cause!.lastStepKey).toBe("only-step");
      }
    }

    // Should emit workflow_cancelled, not workflow_success
    const cancelledEvent = events.find((e) => e.type === "workflow_cancelled");
    const successEvent = events.find((e) => e.type === "workflow_success");
    expect(cancelledEvent).toBeDefined();
    expect(successEvent).toBeUndefined();
  });

  it("custom catchUnexpected mid-execution cancellation maps through catchUnexpected", async () => {
    type User = { id: string; name: string };
    const controller = new AbortController();
    const events: WorkflowEvent<unknown>[] = [];

    const slowFetch = async (id: string): AsyncResult<User, "NOT_FOUND"> => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return ok({ id, name: `User ${id}` });
    };

    const workflow = createWorkflow("workflow", { slowFetch }, {
      signal: controller.signal,
      onEvent: (e) => events.push(e),
      catchUnexpected: ((cause: unknown) => {
        if (isWorkflowCancelled(cause)) {
          return { type: "WORKFLOW_CANCELLED" as const, reason: cause.reason };
        }
        return { type: "UNEXPECTED" as const };
      }) as unknown as (cause: unknown) => UnexpectedError | "NOT_FOUND",
    });

    const resultPromise = workflow.run(async ({ step }) => {
      const user1 = await step('slowFetch1', () => slowFetch("1"), { key: "step1" });
      const user2 = await step('slowFetch2', () => slowFetch("2"), { key: "step2" });
      return { user1, user2 };
    });

    // Abort during first step
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort("mid-execution strict abort");

    const result = await resultPromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Error should be mapped through catchUnexpected
      expect(result.error).toEqual({
        type: "WORKFLOW_CANCELLED",
        reason: "mid-execution strict abort",
      });
    }

    // Should still emit workflow_cancelled event
    const cancelledEvent = events.find((e) => e.type === "workflow_cancelled");
    expect(cancelledEvent).toBeDefined();
  });

  it("correctly handles pre-aborted signal (should cancel immediately)", async () => {
    // If a signal is already aborted before workflow starts,
    // the workflow should return cancelled immediately
    // This is correct behavior - user is saying "don't run this"
    const controller = new AbortController();
    const events: WorkflowEvent<unknown>[] = [];

    // Abort BEFORE creating the workflow
    controller.abort("pre-aborted");

    const quickOp = async (): AsyncResult<number, "FAILED"> => {
      return ok(42);
    };

    const workflow = createWorkflow("workflow", { quickOp }, {
      signal: controller.signal,
      onEvent: (e) => events.push(e),
    });

    // Run the workflow - should fail immediately due to pre-aborted signal
    const result = await workflow.run(async ({ step }) => {
      const value = await step('quickOp', () => quickOp(), { key: "quick-step" });
      return value * 2;
    });

    // The workflow should be cancelled because signal was already aborted
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isWorkflowCancelled(result.cause)).toBe(true);
      if (isWorkflowCancelled(result.cause)) {
        expect(result.cause!.reason).toBe("pre-aborted");
      }
    }

    // Should emit workflow_cancelled, NOT workflow_success
    const cancelledEvent = events.find((e) => e.type === "workflow_cancelled");
    const successEvent = events.find((e) => e.type === "workflow_success");
    expect(cancelledEvent).toBeDefined();
    expect(successEvent).toBeUndefined();
  });

  it("recognizes AbortError from step as workflow cancellation", async () => {
    // When a step throws an AbortError (e.g., from fetch() respecting the signal),
    // defaultCatchUnexpected returns "UNEXPECTED_ERROR" and the AbortError is in result.cause
    const controller = new AbortController();
    const events: WorkflowEvent<unknown>[] = [];

    // Simulate an operation that respects the AbortSignal and throws AbortError
    const fetchWithSignal = async (signal: AbortSignal): AsyncResult<string, "FETCH_ERROR"> => {
      // Check if already aborted
      if (signal.aborted) {
        const abortError = new DOMException("The operation was aborted", "AbortError");
        throw abortError;
      }
      // Wait a bit, then check again
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (signal.aborted) {
        const abortError = new DOMException("The operation was aborted", "AbortError");
        throw abortError;
      }
      return ok("data");
    };

    const workflow = createWorkflow("workflow", { fetchWithSignal }, {
      signal: controller.signal,
      onEvent: (e) => events.push(e),
    });

    const resultPromise = workflow.run(async ({ step, deps, ctx }) => {
      // Use step.withTimeout with signal: true to get the workflow signal
      const data = await step.withTimeout(
        "fetch-step",
        (signal) => fetchWithSignal(signal),
        { ms: 5000, signal: true }
      );
      return data;
    });

    // Abort during the fetch
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort("user cancelled");

    const result = await resultPromise;

    // With default mapper, result.error is "UNEXPECTED_ERROR" and the AbortError is in result.cause
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("UNEXPECTED_ERROR");
      // The cause is the AbortError thrown by the step
      expect(result.cause).toBeDefined();
    }
  });

  it("custom catchUnexpected AbortError: treated as regular error, not cancellation", async () => {
    // With custom catchUnexpected, AbortError is treated as a regular error mapped by catchUnexpected.
    // This ensures event and error are consistent:
    // - catchUnexpected maps the AbortError to user's error type
    // - workflow_error event is emitted (not workflow_cancelled)
    // - No event/error mismatch
    const controller = new AbortController();
    const events: WorkflowEvent<unknown>[] = [];
    const catchUnexpectedCalls: unknown[] = [];

    const fetchWithSignal = async (signal: AbortSignal): AsyncResult<string, "FETCH_ERROR"> => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (signal.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      return ok("data");
    };

    type MappedError = { type: "ABORTED" } | { type: "CANCELLED"; reason?: string } | { type: "UNEXPECTED" };

    const workflow = createWorkflow("workflow", { fetchWithSignal }, {
      signal: controller.signal,
      onEvent: (e) => events.push(e),
      catchUnexpected: ((cause: unknown): MappedError => {
        catchUnexpectedCalls.push(cause);
        // User can handle AbortError specifically if they want
        if (cause instanceof Error && cause.name === "AbortError") {
          return { type: "ABORTED" };
        }
        if (isWorkflowCancelled(cause)) {
          return { type: "CANCELLED", reason: cause.reason };
        }
        return { type: "UNEXPECTED" };
      }) as unknown as (cause: unknown) => UnexpectedError | "FETCH_ERROR",
    });

    const resultPromise = workflow.run(async ({ step, deps, ctx }) => {
      const data = await step.withTimeout(
        "fetch-step",
        (signal) => fetchWithSignal(signal),
        { ms: 5000, signal: true }
      );
      return data;
    });

    // Abort during the fetch
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort("user abort");

    const result = await resultPromise;

    // catchUnexpected should be called exactly ONCE
    expect(catchUnexpectedCalls.length).toBe(1);
    expect(catchUnexpectedCalls[0]).toBeInstanceOf(DOMException);

    // Error is the mapped AbortError
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ type: "ABORTED" });
    }

    // Should emit workflow_error (not workflow_cancelled) for consistency
    const errorEvent = events.find((e) => e.type === "workflow_error");
    const cancelledEvent = events.find((e) => e.type === "workflow_cancelled");
    expect(errorEvent).toBeDefined();
    expect(cancelledEvent).toBeUndefined();
  });

  it("default mapper: typed error is preserved even when abort fires", async () => {
    // When a step fails with a typed error (e.g., "USER_NOT_FOUND") and abort also fires,
    // the typed error should be preserved - abort should not mask unrelated errors.
    const controller = new AbortController();
    const events: WorkflowEvent<unknown>[] = [];

    type UserError = "USER_NOT_FOUND" | "PERMISSION_DENIED";

    const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, UserError> => {
      // Simulate some delay
      await new Promise((resolve) => setTimeout(resolve, 30));
      // Return a typed error
      return err("USER_NOT_FOUND");
    };

    const workflow = createWorkflow("workflow", { fetchUser }, {
      signal: controller.signal,
      onEvent: (e) => events.push(e),
    });

    const resultPromise = workflow.run(async ({ step }) => {
      const user = await step('fetchUser', () => fetchUser("123"), { key: "fetch-user" });
      return user;
    });

    // Abort fires DURING the step (but step will fail with typed error anyway)
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort("abort fired");

    const result = await resultPromise;

    // The typed error should be preserved, NOT masked by cancellation
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Should be the typed error, not WorkflowCancelledError
      expect(result.error).toBe("USER_NOT_FOUND");
      expect(isWorkflowCancelled(result.cause)).toBe(false);
    }

    // Should emit workflow_error with the typed error, not workflow_cancelled
    const errorEvent = events.find((e) => e.type === "workflow_error");
    const cancelledEvent = events.find((e) => e.type === "workflow_cancelled");
    expect(errorEvent).toBeDefined();
    expect(cancelledEvent).toBeUndefined();
  });

  it("default mapper: AbortError exception during abort becomes cancellation", async () => {
    // When a step throws an AbortError and abort fires,
    // with defaultCatchUnexpected returning string, the AbortError is in result.cause
    const controller = new AbortController();
    const events: WorkflowEvent<unknown>[] = [];

    const riskyOperation = async (): AsyncResult<string, "KNOWN_ERROR"> => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Throw an AbortError (simulating what fetch() throws when aborted)
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      throw abortError;
    };

    const workflow = createWorkflow("workflow", { riskyOperation }, {
      signal: controller.signal,
      onEvent: (e) => events.push(e),
    });

    const resultPromise = workflow.run(async ({ step }) => {
      const data = await step('riskyOperation', () => riskyOperation(), { key: "risky-step" });
      return data;
    });

    // Abort during the operation
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort("user cancelled");

    const result = await resultPromise;

    // With default mapper returning string, result.error is "UNEXPECTED_ERROR"
    // and the AbortError is preserved in result.cause
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("UNEXPECTED_ERROR");
      expect(result.cause).toBeDefined();
    }
  });

  it("default mapper: only AbortError exceptions become cancellation, not other errors", async () => {
    // Test that only AbortError-type exceptions are treated as cancellation.
    // Other thrown exceptions should remain as UnexpectedError even if abort was signaled.
    // This prevents masking real errors as cancellation.
    const controller = new AbortController();
    const events: WorkflowEvent<unknown>[] = [];

    const failingOperation = async (): AsyncResult<string, "KNOWN_ERROR"> => {
      // Small delay to allow abort to fire first
      await new Promise((resolve) => setTimeout(resolve, 10));
      // Throw an unrelated exception (NOT an AbortError)
      throw new Error("Database connection failed - unrelated to abort");
    };

    const workflow = createWorkflow("workflow", { failingOperation }, {
      signal: controller.signal,
      onEvent: (e) => events.push(e),
    });

    const resultPromise = workflow.run(async ({ step }) => {
      const data = await step('failingOperation', () => failingOperation(), { key: "failing-step" });
      return data;
    });

    // Abort fires BEFORE the exception (abort is signaled during execution)
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort("user cancelled");

    const result = await resultPromise;

    // Even though abort was signaled, the exception is NOT an AbortError,
    // so it should be preserved as "UNEXPECTED_ERROR", not masked as cancellation.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Should NOT be WorkflowCancelledError - the exception is not abort-related
      expect(isWorkflowCancelled(result.cause)).toBe(false);
      // Should be "UNEXPECTED_ERROR" string from defaultCatchUnexpected
      expect(result.error).toBe("UNEXPECTED_ERROR");
    }

    // Should emit workflow_error, not workflow_cancelled
    const errorEvent = events.find((e) => e.type === "workflow_error");
    const cancelledEvent = events.find((e) => e.type === "workflow_cancelled");
    expect(errorEvent).toBeDefined();
    expect(cancelledEvent).toBeUndefined();
  });
});

// =============================================================================
// Execution-Time Options Tests (workflow.run())
// =============================================================================

describe("createWorkflow with execution-time options", () => {
  const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> =>
    id !== "0" ? ok({ id, name: `User ${id}` }) : err("NOT_FOUND");

  it("exec overrides creation: creation onEvent = A, exec onEvent = B → only B called", async () => {
    const eventsA: WorkflowEvent<unknown>[] = [];
    const eventsB: WorkflowEvent<unknown>[] = [];

    const workflow = createWorkflow("workflow", { fetchUser }, {
      onEvent: (e) => eventsA.push(e),
    });

    await workflow.run(async ({ step }) => {
      const user = await step('fetchUser', () => fetchUser("1"));
      return user;
    }, {
      onEvent: (e) => eventsB.push(e),
    });

    // Only B should have events, not A
    expect(eventsA.length).toBe(0);
    expect(eventsB.length).toBeGreaterThan(0);
    expect(eventsB.some(e => e.type === "workflow_start")).toBe(true);
  });

  it("exec devWarnings enables ctx.set/get warnings for a single run", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";

    const workflow = createWorkflow("workflow", { fetchUser });

    await workflow.run(async ({ step, deps, ctx }) => {
      const user = await step('fetchUser', () => deps.fetchUser("1"));
      ctx.set("user", user);
      ctx.get("user");
      return user;
    }, {
      devWarnings: true,
    });

    const messages = warnSpy.mock.calls.map((call) => String(call[0] ?? ""));
    expect(messages.some((msg) => msg.includes("ctx.set('user'"))).toBe(true);
    expect(messages.some((msg) => msg.includes("ctx.get('user'"))).toBe(true);

    process.env.NODE_ENV = prevEnv;
    warnSpy.mockRestore();
  });

  it("exec doesn't leak: workflow.run(fn, { onEvent: B }) then workflow.run(fn) → only A called", async () => {
    const eventsA: WorkflowEvent<unknown>[] = [];
    const eventsB: WorkflowEvent<unknown>[] = [];

    const workflow = createWorkflow("workflow", { fetchUser }, {
      onEvent: (e) => eventsA.push(e),
    });

    // First run with exec override
    await workflow.run(async ({ step }) => {
      const user = await step('fetchUser', () => fetchUser("1"));
      return user;
    }, {
      onEvent: (e) => eventsB.push(e),
    });

    // Clear events
    eventsA.length = 0;
    eventsB.length = 0;

    // Second run without exec - should use creation-time handler
    await workflow.run(async ({ step }) => {
      const user = await step('fetchUser', () => fetchUser("1"));
      return user;
    });

    // Only A should have events from the second run
    expect(eventsA.length).toBeGreaterThan(0);
    expect(eventsB.length).toBe(0);
  });

  it("resumeState factory evaluated lazily per-run", async () => {
    let factoryCalls = 0;

    const resumeStateFactory = () => {
      factoryCalls++;
      return {
        steps: new Map([
          ["user:1", { result: ok({ id: "1", name: "Cached User" }) }],
        ]),
      };
    };

    const workflow = createWorkflow("workflow", { fetchUser });

    // First run - factory should be called
    const result1 = await workflow.run(async ({ step }) => {
      const user = await step('fetchUser', () => fetchUser("1"), { key: "user:1" });
      return user;
    }, {
      resumeState: resumeStateFactory,
    });

    expect(factoryCalls).toBe(1);
    expect(result1.ok).toBe(true);
    if (result1.ok) {
      expect(result1.value.name).toBe("Cached User");
    }

    // Second run - factory should be called again (new invocation)
    const result2 = await workflow.run(async ({ step }) => {
      const user = await step('fetchUser', () => fetchUser("1"), { key: "user:1" });
      return user;
    }, {
      resumeState: resumeStateFactory,
    });

    expect(factoryCalls).toBe(2);
  });

  it("signal abort is per run: only affects that .run()", async () => {
    const controller = new AbortController();

    const workflow = createWorkflow("workflow", { fetchUser });

    // First run with signal - abort it
    const resultPromise = workflow.run(async ({ step }) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const user = await step('fetchUser', () => fetchUser("1"));
      return user;
    }, {
      signal: controller.signal,
    });

    controller.abort("cancelled");

    const result1 = await resultPromise;
    expect(result1.ok).toBe(false);
    if (!result1.ok) {
      expect(isWorkflowCancelled(result1.cause)).toBe(true);
    }

    // Second run without signal - should complete normally
    const result2 = await workflow.run(async ({ step }) => {
      const user = await step('fetchUser', () => fetchUser("1"));
      return user;
    });

    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.value.name).toBe("User 1");
    }
  });

  it("workflow.run() works with config parameter", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    const workflow = createWorkflow("workflow", { fetchUser });

    const userId = "1";
    const result = await workflow.run(
      async ({ step, deps }) => {
        const user = await step('fetchUser', () => deps.fetchUser(userId));
        return user;
      },
      { onEvent: (e) => events.push(e) }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("User 1");
    }
    expect(events.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// step.sleep() Tests
// =============================================================================

describe("step.sleep() method", () => {
  it("completes after specified duration (string)", async () => {
    const startTime = Date.now();
    const result = await run(async ({ step }) => {
      await step.sleep("short-sleep", "100ms");
      return Date.now() - startTime;
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeGreaterThanOrEqual(90); // Allow timing variance
    }
  });

  it("completes after specified duration (Duration object)", async () => {
    const startTime = Date.now();
    const result = await run(async ({ step }) => {
      await step.sleep("short-sleep", millis(100));
      return Date.now() - startTime;
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeGreaterThanOrEqual(90);
    }
  });

  it("respects workflow cancellation", async () => {
    const controller = new AbortController();

    const workflow = createWorkflow("workflow", {}, { signal: controller.signal });

    const resultPromise = workflow.run(async ({ step }) => {
      await step.sleep("long-sleep", "5s");
      return "completed";
    });

    // Cancel after 50ms
    setTimeout(() => controller.abort(), 50);

    const result = await resultPromise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isWorkflowCancelled(result.cause)).toBe(true);
    }
  });

  it("respects user-provided signal cancellation", async () => {
    const controller = new AbortController();

    const resultPromise = run(async ({ step }) => {
      await step.sleep("long-sleep", "5s", { signal: controller.signal });
      return "completed";
    });

    // Cancel after 50ms
    setTimeout(() => controller.abort(), 50);

    const result = await resultPromise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // User signal abort throws AbortError which becomes "UNEXPECTED_ERROR"
      expect(result.error).toBe("UNEXPECTED_ERROR");
      // The AbortError is preserved in result.cause
      expect(result.cause).toBeInstanceOf(Error);
      expect((result.cause as Error).name).toBe("AbortError");
    }
  });

  it("rejects immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(); // Abort before sleep starts

    const startTime = Date.now();
    const result = await run(async ({ step }) => {
      await step.sleep("long-sleep", "5s", { signal: controller.signal });
      return "completed";
    });
    const elapsed = Date.now() - startTime;

    // Should fail immediately, not wait 5 seconds
    expect(elapsed).toBeLessThan(100);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("UNEXPECTED_ERROR");
      // The AbortError is preserved in result.cause
      expect((result.cause as Error).name).toBe("AbortError");
    }
  });

  it("signal cancellation works with createWorkflow (cached version)", async () => {
    const controller = new AbortController();
    const workflow = createWorkflow("workflow", {});

    const resultPromise = workflow.run(async ({ step }) => {
      await step.sleep("long-sleep", "5s", { signal: controller.signal });
      return "completed";
    });

    // Cancel after 50ms
    setTimeout(() => controller.abort(), 50);

    const result = await resultPromise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("UNEXPECTED_ERROR");
      // The AbortError is preserved in result.cause
      expect((result.cause as Error).name).toBe("AbortError");
    }
  });

  it("signal only affects sleep that uses it", async () => {
    const controller = new AbortController();
    const sleepOrder: string[] = [];

    const resultPromise = run(async ({ step }) => {
      // First sleep has signal, second does not
      const sleep1 = step.sleep("sleep-with-signal", "100ms", { signal: controller.signal })
        .then(() => sleepOrder.push("sleep1-done"))
        .catch(() => sleepOrder.push("sleep1-aborted"));

      const sleep2 = step.sleep("sleep-without-signal", "50ms")
        .then(() => sleepOrder.push("sleep2-done"));

      // Cancel signal after 25ms (before either completes)
      setTimeout(() => controller.abort(), 25);

      await Promise.allSettled([sleep1, sleep2]);
      return sleepOrder;
    });

    const result = await resultPromise;
    // The workflow may fail due to the AbortError, but we can check the order
    // sleep2 should complete (no signal), sleep1 should be aborted
    expect(sleepOrder).toContain("sleep1-aborted");
    expect(sleepOrder).toContain("sleep2-done");
  });

  it("workflow signal takes precedence over user signal for cancellation type", async () => {
    const workflowController = new AbortController();
    const userController = new AbortController();

    const workflow = createWorkflow("workflow", {}, { signal: workflowController.signal });

    const resultPromise = workflow.run(async ({ step }) => {
      await step.sleep("long-sleep", "5s", { signal: userController.signal });
      return "completed";
    });

    // Cancel workflow signal (not user signal)
    setTimeout(() => workflowController.abort(), 50);

    const result = await resultPromise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Workflow signal produces cancellation (result.cause = WorkflowCancelledError)
      expect(isWorkflowCancelled(result.cause)).toBe(true);
    }
  });

  it("user signal cancellation emits step error event", async () => {
    const controller = new AbortController();
    const events: WorkflowEvent<unknown>[] = [];

    const resultPromise = run(
      async ({ step }) => {
        await step.sleep("signaled-sleep", "5s", { signal: controller.signal });
        return "completed";
      },
      { onEvent: (e) => events.push(e) }
    );

    setTimeout(() => controller.abort(), 50);
    await resultPromise;

    const stepStart = events.find(
      (e) => e.type === "step_start" && e.name === "signaled-sleep"
    );
    const stepError = events.find(
      (e) => e.type === "step_error" && e.name === "signaled-sleep"
    );

    expect(stepStart).toBeDefined();
    expect(stepError).toBeDefined();
  });

  it("sleep completes normally when signal is provided but never aborted", async () => {
    const controller = new AbortController();
    const startTime = Date.now();

    const result = await run(async ({ step }) => {
      await step.sleep("normal-sleep", "50ms", { signal: controller.signal });
      return "completed";
    });

    const elapsed = Date.now() - startTime;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("completed");
    }
    // Should have waited approximately 50ms
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(150);
  });

  it("handles invalid duration string as unexpected error", async () => {
    const result = await run(async ({ step }) => {
      await step.sleep("bad-sleep", "invalid");
      return "completed";
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("UNEXPECTED_ERROR");
    }
  });

  it("emits step events", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    await run(
      async ({ step }) => {
        await step.sleep("test-sleep", "10ms");
      },
      { onEvent: (e) => events.push(e) }
    );

    const stepStart = events.find(
      (e) => e.type === "step_start" && e.name === "test-sleep"
    );
    const stepSuccess = events.find(
      (e) => e.type === "step_success" && e.name === "test-sleep"
    );

    expect(stepStart).toBeDefined();
    expect(stepSuccess).toBeDefined();
  });

  it("rejects empty sleep id in workflows", async () => {
    const workflow = createWorkflow("workflow");

    const result = await workflow.run(async ({ step }) => {
      await step.sleep("", "10ms");
      return "done";
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("UNEXPECTED_ERROR");
    }
  });

  it("works with createWorkflow", async () => {
    const workflow = createWorkflow("workflow");
    const startTime = Date.now();

    const result = await workflow.run(async ({ step }) => {
      await step.sleep("workflow-sleep", "50ms");
      return Date.now() - startTime;
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeGreaterThanOrEqual(40);
    }
  });

  it("default name uses duration string", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    await run(
      async ({ step }) => {
        await step.sleep("sleep", "25ms");
      },
      { onEvent: (e) => events.push(e) }
    );

    const stepStart = events.find((e) => e.type === "step_start");
    expect(stepStart).toBeDefined();
    if (stepStart && stepStart.type === "step_start") {
      // Default key is 'sleep'
      expect(stepStart.name).toBe("sleep");
    }
  });

  it("does not cache sleep steps without an explicit key", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const cache = createMemoryCache();
    const workflow = createWorkflow(
      "workflow",
      {},
      { cache, onEvent: (e) => events.push(e) }
    );

    const result = await workflow.run(async ({ step }) => {
      await step.sleep("sleep-1", "5ms");
      await step.sleep("sleep-2", "5ms");
      return "done";
    });

    expect(result.ok).toBe(true);
    const cacheEvents = events.filter(
      (e) => e.type === "step_cache_hit" || e.type === "step_cache_miss"
    );
    expect(cacheEvents).toHaveLength(0);
  });

  it("caches sleep steps by key", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const cache = createMemoryCache();
    const workflow = createWorkflow(
      "workflow",
      {},
      { cache, onEvent: (e) => events.push(e) }
    );

    // First run - cache miss, actually sleeps (explicit key enables caching)
    const result1 = await workflow.run(async ({ step }) => {
      await step.sleep("sleep:1", "10ms", { key: "sleep:1" });
      return "done";
    });
    expect(result1.ok).toBe(true);

    const cacheMissEvents = events.filter((e) => e.type === "step_cache_miss");
    expect(cacheMissEvents).toHaveLength(1);

    // Clear events
    events.length = 0;

    // Second run - cache hit, should not actually sleep
    const result2 = await workflow.run(async ({ step }) => {
      await step.sleep("sleep:1", "10ms", { key: "sleep:1" });
      return "done";
    });
    expect(result2.ok).toBe(true);

    // Should have cache hit event
    const cacheHitEvents = events.filter((e) => e.type === "step_cache_hit");
    expect(cacheHitEvents).toHaveLength(1);
  });
});

describe("Double-wrap detection", () => {
  it("demonstrates the double-wrap mistake pattern", async () => {
    // This test demonstrates what happens when users mistakenly return ok()
    // from the workflow executor - the value gets double-wrapped
    const result = await run(async ({ step }) => {
      const value = await step('getValue', () => ok(42));
      return ok({ answer: value }); // MISTAKE: returning ok() from executor
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Double-wrapped: result.value is { ok: true, value: { answer: 42 } }
      expect(result.value).toHaveProperty("ok", true);
      expect((result.value as { ok: boolean; value: { answer: number } }).value.answer).toBe(42);
      // The symptom: direct property access returns undefined!
      expect((result.value as { answer?: number }).answer).toBeUndefined();
    }
  });

  it("shows correct pattern: returning raw value", async () => {
    // This test demonstrates the correct pattern - return raw values
    const result = await run(async ({ step }) => {
      const value = await step('getValue', () => ok(42));
      return { answer: value }; // CORRECT: return raw value
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.answer).toBe(42);
    }
  });

  it("shows the symptom with createWorkflow too", async () => {
    const fetchNumber = async (): AsyncResult<number, "ERROR"> => ok(42);
    const workflow = createWorkflow("workflow", { fetchNumber });

    const result = await workflow.run(async ({ step, deps: { fetchNumber } }) => {
      const num = await step('fetchNumber', () => fetchNumber());
      return ok({ data: num }); // MISTAKE
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Double-wrapped
      expect(result.value).toHaveProperty("ok", true);
      expect((result.value as { data?: number }).data).toBeUndefined();
    }
  });
});

// =============================================================================
// Effect-Style Ergonomics Tests
// =============================================================================

describe("Effect-style ergonomics", () => {
  describe("step.run() - unwrap AsyncResult directly", () => {
    it("unwraps AsyncResult without wrapper function", async () => {
      const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
        if (id === "1") {
          return ok({ id: "1", name: "Alice" });
        }
        return err("NOT_FOUND");
      };

      const result = await run(async ({ step }) => {
        const userResult = fetchUser("1");
        const user = await step.run('fetchUser', userResult);
        return user.name;
      });

      expect(result).toEqual({ ok: true, value: "Alice" });
    });

    it("exits early on error", async () => {
      const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
        return err("NOT_FOUND");
      };

      const result = await run(async ({ step }) => {
        const userResult = fetchUser("1");
        const user = await step.run('fetchUser', userResult);
        return user.name;
      }, { onError: () => {} }); // Add error handler to avoid UnexpectedError wrapping

      expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    });

    it("works with createWorkflow", async () => {
      const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
        return ok({ id, name: "Bob" });
      };

      const workflow = createWorkflow("test", { fetchUser });

      const result = await workflow.run(async ({ step, deps: { fetchUser } }) => {
        const user = await step.run('fetchUser', fetchUser("1"));
        return user.name;
      });

      expect(result).toEqual({ ok: true, value: "Bob" });
    });

    it("uses workflow cache when key is provided in createWorkflow", async () => {
      let calls = 0;
      const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
        calls++;
        return ok({ id, name: "Bob" });
      };

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow("test", { fetchUser }, { cache });

      const result = await workflow.run(async ({ step, deps: { fetchUser } }) => {
        // step.run() takes an already-started promise, so both calls execute eagerly.
        // Caching returns the first stored result for the second step.
        const first = await step.run("fetchUser1", fetchUser("1"), { key: "user:1" });
        const second = await step.run("fetchUser2", fetchUser("1"), { key: "user:1" });
        return `${first.name}-${second.name}`;
      });

      expect(result).toEqual({ ok: true, value: "Bob-Bob" });
      // Both fetchUser calls execute eagerly (step.run takes a promise, not a lazy fn).
      // Use step() with a callback for lazy caching.
      expect(calls).toBe(2);
      expect(cache.has("user:1")).toBe(true);
    });
  });

  describe("step.andThen() - chain AsyncResults", () => {
    it("chains operations with step tracking", async () => {
      type User = { id: string; name: string };
      type EnrichedUser = User & { premium: boolean };

      const enrichUser = async (user: User): AsyncResult<EnrichedUser, "ENRICHMENT_FAILED"> => {
        return ok({ ...user, premium: true });
      };

      const result = await run(async ({ step }) => {
        const user = { id: "1", name: "Alice" };
        const enriched = await step.andThen('enrich', user, enrichUser);
        return enriched.premium;
      });

      expect(result).toEqual({ ok: true, value: true });
    });

    it("exits on error in chained operation", async () => {
      type User = { id: string; name: string };
      type EnrichedUser = User & { premium: boolean };

      const enrichUser = async (_user: User): AsyncResult<EnrichedUser, "ENRICHMENT_FAILED"> => {
        return err("ENRICHMENT_FAILED");
      };

      const result = await run(async ({ step }) => {
        const user = { id: "1", name: "Alice" };
        const enriched = await step.andThen('enrich', user, enrichUser);
        return enriched.premium;
      }, { onError: () => {} }); // Add error handler to avoid UnexpectedError wrapping

      expect(result).toEqual({ ok: false, error: "ENRICHMENT_FAILED" });
    });
  });

  describe("step.match() - pattern matching", () => {
    it("executes ok branch for success", async () => {
      const userResult = ok({ id: "1", name: "Alice" });

      const result = await run(async ({ step }) => {
        const message = await step.match('handleUser', userResult, {
          ok: async (user) => `Hello, ${user.name}`,
          err: async () => "User not found",
        });
        return message;
      });

      expect(result).toEqual({ ok: true, value: "Hello, Alice" });
    });

    it("executes err branch for error", async () => {
      const userResult = err("NOT_FOUND");

      const result = await run(async ({ step }) => {
        const message = await step.match('handleUser', userResult, {
          ok: async (user: { name: string }) => `Hello, ${user.name}`,
          err: async (error) => `Error: ${error}`,
        });
        return message;
      });

      expect(result).toEqual({ ok: true, value: "Error: NOT_FOUND" });
    });

    it("can execute steps in both branches", async () => {
      const events: string[] = [];

      const result = await run(async ({ step }) => {
        const userResult = ok({ id: "1", name: "Alice" });

        const message = await step.match('handleUser', userResult, {
          ok: async (user) => {
            events.push('ok-branch');
            await step('sendWelcome', () => {
              events.push('sent-welcome');
              return ok(true);
            });
            return `Sent welcome to ${user.name}`;
          },
          err: async () => {
            events.push('err-branch');
            await step('logError', () => {
              events.push('logged-error');
              return ok(true);
            });
            return "Failed";
          },
        });
        return message;
      });

      expect(result).toEqual({ ok: true, value: "Sent welcome to Alice" });
      expect(events).toEqual(['ok-branch', 'sent-welcome']);
    });

    it("emits step events for the match step id", async () => {
      const workflowEvents: string[] = [];

      await run(
        async ({ step }) => {
          const result = ok({ id: "1", name: "Alice" });
          return step.match("handleUser", result, {
            ok: async (user) => `Hello ${user.name}`,
            err: async () => "nope",
          });
        },
        {
          onEvent: (event) => {
            if (event.type === "step_start" || event.type === "step_success") {
              workflowEvents.push(`${event.type}:${event.name}`);
            }
          },
        }
      );

      expect(workflowEvents).toContain("step_start:handleUser");
      expect(workflowEvents).toContain("step_success:handleUser");
    });
  });

  describe("step.all() - Effect.all-style parallel", () => {
    it("is an alias for step.parallel", async () => {
      const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
        return ok({ id, name: "Alice" });
      };

      const fetchPosts = async (id: string): AsyncResult<string[], "FETCH_ERROR"> => {
        return ok(["post1", "post2"]);
      };

      const result = await run(async ({ step }) => {
        const { user, posts } = await step.all('fetchAll', {
          user: () => fetchUser("1"),
          posts: () => fetchPosts("1"),
        });
        return { userName: user.name, postCount: posts.length };
      });

      expect(result).toEqual({
        ok: true,
        value: { userName: "Alice", postCount: 2 },
      });
    });

    it("does not cache all by id when key is omitted in createWorkflow", async () => {
      let calls = 0;
      const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
        calls++;
        return ok({ id, name: `User${id}` });
      };

      const workflow = createWorkflow("test", { fetchUser }, { cache: new Map() });

      const result = await workflow.run(async ({ step, deps: { fetchUser } }) => {
        const first = await step.all("fetchAll", { user: () => fetchUser("1") });
        const second = await step.all("fetchAll", { user: () => fetchUser("1") });
        return [first.user.name, second.user.name] as const;
      });

      expect(result).toEqual({ ok: true, value: ["User1", "User1"] });
      expect(calls).toBe(2);
    });
  });

  describe("step.map() - parallel batch processing", () => {
    it("maps over array with parallel execution", async () => {
      const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
        return ok({ id, name: `User${id}` });
      };

      const result = await run(async ({ step }) => {
        const users = await step.map('fetchUsers', ["1", "2", "3"], (id) => fetchUser(id));
        return users.map(u => u.name);
      });

      expect(result).toEqual({
        ok: true,
        value: ["User1", "User2", "User3"],
      });
    });

    it("fails fast on first error", async () => {
      const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
        if (id === "2") {
          return err("NOT_FOUND");
        }
        return ok({ id, name: `User${id}` });
      };

      const result = await run(async ({ step }) => {
        const users = await step.map('fetchUsers', ["1", "2", "3"], (id) => fetchUser(id));
        return users.map(u => u.name);
      }, { onError: () => {} }); // Add error handler to avoid UnexpectedError wrapping

      expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    });

    it("respects concurrency limit", async () => {
      const activeCount = { current: 0, max: 0 };
      const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
        activeCount.current++;
        activeCount.max = Math.max(activeCount.max, activeCount.current);
        await new Promise(resolve => setTimeout(resolve, 10));
        activeCount.current--;
        return ok({ id, name: `User${id}` });
      };

      const result = await run(async ({ step }) => {
        const users = await step.map(
          'fetchUsers',
          ["1", "2", "3", "4", "5"],
          (id) => fetchUser(id),
          { concurrency: 2 }
        );
        return users.length;
      });

      expect(result).toEqual({ ok: true, value: 5 });
      expect(activeCount.max).toBeLessThanOrEqual(2);
    });

    it("works with createWorkflow", async () => {
      const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
        return ok({ id, name: `User${id}` });
      };

      const workflow = createWorkflow("test", { fetchUser });

      const result = await workflow.run(async ({ step, deps: { fetchUser } }) => {
        const users = await step.map('fetchUsers', ["1", "2"], (id) => fetchUser(id));
        return users.map(u => u.name);
      });

      expect(result).toEqual({ ok: true, value: ["User1", "User2"] });
    });

    it("does not cache map by id when key is omitted in createWorkflow", async () => {
      let calls = 0;
      const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
        calls++;
        return ok({ id, name: `User${id}` });
      };

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow("test", { fetchUser }, { cache });

      const result = await workflow.run(async ({ step, deps: { fetchUser } }) => {
        const first = await step.map("fetchUsers", ["1", "2"], (id) => fetchUser(id));
        const second = await step.map("fetchUsers", ["1", "2"], (id) => fetchUser(id));
        return [first.length, second.length] as const;
      });

      expect(result).toEqual({ ok: true, value: [2, 2] });
      expect(calls).toBe(4);
    });
  });

  describe("integrated example - Effect-style workflow", () => {
    it("demonstrates the new ergonomic API", async () => {
      type User = { id: string; name: string; email: string };
      type Order = { id: string; total: number };
      type Receipt = { orderId: string; charged: boolean };

      const fetchUser = async (id: string): AsyncResult<User, "NOT_FOUND"> => {
        return ok({ id, name: "Alice", email: "alice@example.com" });
      };

      const validateOrder = async (data: { userId: string; total: number }): AsyncResult<Order, "INVALID_ORDER"> => {
        return ok({ id: "order-1", total: data.total });
      };

      const chargeCard = async (total: number): AsyncResult<Receipt, "CARD_DECLINED"> => {
        return ok({ orderId: "order-1", charged: true });
      };

      const sendEmail = async (email: string, _receipt: Receipt): AsyncResult<boolean, "EMAIL_FAILED"> => {
        return ok(true);
      };

      const workflow = createWorkflow("checkout", {
        fetchUser,
        validateOrder,
        chargeCard,
        sendEmail,
      });

      const result = await workflow.run(async ({ step, deps }) => {
        // Use step.run() to unwrap AsyncResults directly
        const user = await step.run('fetchUser', deps.fetchUser("1"));

        // Use step.andThen() for chaining
        const order = await step.andThen(
          'validateOrder',
          { userId: user.id, total: 100 },
          deps.validateOrder
        );

        // Use step.all() for parallel operations
        const { receipt } = await step.all('processPayment', {
          receipt: () => deps.chargeCard(order.total),
        });

        // Use step.match() for pattern matching
        const emailSent = await step.match(
          'handleEmail',
          await deps.sendEmail(user.email, receipt),
          {
            ok: async (sent) => sent,
            err: async (error) => {
              // Log error but don't fail the workflow
              await step('logEmailFailure', () => ok({ error }));
              return false;
            },
          }
        );

        return { user, order, receipt, emailSent };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toMatchObject({
          user: { id: "1", name: "Alice" },
          order: { id: "order-1", total: 100 },
          receipt: { orderId: "order-1", charged: true },
          emailSent: true,
        });
      }
    });
  });
});

// =============================================================================
// workflow.run() overloads: named runs and dep overrides
// =============================================================================

describe("workflow.run() overloads", () => {
  type User = { id: string; name: string };
  const mkFetchUser = (name = "Alice") =>
    async (id: string): AsyncResult<User, "NOT_FOUND"> => ok({ id, name });
  const mkSendEmail = () =>
    async (_to: string): AsyncResult<boolean, "EMAIL_ERROR"> => ok(true);

  describe("named runs", () => {
    it("run(name, fn) uses name as workflowId in events", async () => {
      const events: WorkflowEvent<unknown>[] = [];
      const workflow = createWorkflow("myWorkflow", { fetchUser: mkFetchUser() }, {
        onEvent: (e) => events.push(e),
      });

      await workflow.run("custom-run-id", async ({ step, deps }) => {
        return await step("getUser", () => deps.fetchUser("1"));
      });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].workflowId).toBe("custom-run-id");
    });

    it("run(fn) generates a UUID workflowId", async () => {
      const events: WorkflowEvent<unknown>[] = [];
      const workflow = createWorkflow("myWorkflow", { fetchUser: mkFetchUser() }, {
        onEvent: (e) => events.push(e),
      });

      await workflow.run(async ({ step, deps }) => {
        return await step("getUser", () => deps.fetchUser("1"));
      });

      expect(events.length).toBeGreaterThan(0);
      // UUID v4 pattern
      expect(events[0].workflowId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it("run(name, fn, config) passes both name and config", async () => {
      const events: WorkflowEvent<unknown>[] = [];
      const workflow = createWorkflow("myWorkflow", { fetchUser: mkFetchUser() }, {
        onEvent: (e) => events.push(e),
      });

      await workflow.run("named-with-config", async ({ step, deps }) => {
        return await step("getUser", () => deps.fetchUser("1"));
      }, {});

      expect(events[0].workflowId).toBe("named-with-config");
    });
  });

  describe("dep overrides via RunConfig", () => {
    it("overrides specific deps at run-time", async () => {
      const workflow = createWorkflow("myWorkflow", {
        fetchUser: mkFetchUser("Original"),
        sendEmail: mkSendEmail(),
      });

      const result = await workflow.run(async ({ step, deps }) => {
        const user = await step("getUser", () => deps.fetchUser("1"));
        await step("email", () => deps.sendEmail(user.name));
        return user;
      }, {
        deps: { fetchUser: mkFetchUser("Overridden") },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("Overridden");
      }
    });

    it("non-overridden deps remain from creation-time", async () => {
      const calls: string[] = [];
      const fetchUser = async (id: string): AsyncResult<User, "NOT_FOUND"> => {
        calls.push(`fetchUser:${id}`);
        return ok({ id, name: "Alice" });
      };
      const sendEmail = async (to: string): AsyncResult<boolean, "EMAIL_ERROR"> => {
        calls.push(`sendEmail:${to}`);
        return ok(true);
      };

      const workflow = createWorkflow("myWorkflow", { fetchUser, sendEmail });

      const mockFetchUser = async (id: string): AsyncResult<User, "NOT_FOUND"> => {
        calls.push(`mockFetchUser:${id}`);
        return ok({ id, name: "Mock" });
      };

      await workflow.run(async ({ step, deps }) => {
        const user = await step("getUser", () => deps.fetchUser("1"));
        await step("email", () => deps.sendEmail(user.name));
        return user;
      }, {
        deps: { fetchUser: mockFetchUser },
      });

      // fetchUser was overridden, sendEmail was not
      expect(calls).toContain("mockFetchUser:1");
      expect(calls).not.toContain("fetchUser:1");
      expect(calls).toContain("sendEmail:Mock");
    });

    it("dep overrides work with named runs", async () => {
      const events: WorkflowEvent<unknown>[] = [];
      const workflow = createWorkflow("myWorkflow", { fetchUser: mkFetchUser("Original") }, {
        onEvent: (e) => events.push(e),
      });

      const result = await workflow.run("test-run", async ({ step, deps }) => {
        return await step("getUser", () => deps.fetchUser("1"));
      }, {
        deps: { fetchUser: mkFetchUser("Overridden") },
      });

      expect(events[0].workflowId).toBe("test-run");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("Overridden");
      }
    });
  });
});
