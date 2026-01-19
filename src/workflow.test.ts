/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Tests for workflow.ts - createWorkflow, run, step functions
 */
import { describe, it, expect, vi } from "vitest";
import {
  AsyncResult,
  err,
  isErr,
  isOk,
  isUnexpectedError,
  ok,
  Result,
  UnexpectedError,
} from "./index";
import {
  createWorkflow,
  isStepComplete,
  isStepTimeoutError,
  getStepTimeoutMeta,
  run,
  RunStep,
  ResumeState,
  ResumeStateEntry,
  WorkflowEvent,
  createStepCollector,
  StepTimeoutError,
} from "./workflow-entry";

describe("run() - do-notation style", () => {
  it("executes steps sequentially and returns final value", async () => {
    // No catchUnexpected needed - only using step results
    const result = await run(async (step) => {
      const a = await step(() => ok(10));
      const b = await step(() => ok(20));
      const c = await step(() => ok(12));
      return a + b + c;
    });

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("early exits on first error", async () => {
    const executedSteps: string[] = [];

    const result = await run(
      async (step) => {
        executedSteps.push("step1");
        const a = await step(() => ok(10));

        executedSteps.push("step2");
        await step(() => err("FAILED"));

        executedSteps.push("step3"); // Should not execute
        const c = await step(() => ok(12));

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
    const result = await run(async (step) => {
      // step() returns T, not Result<T, E>
      const value = await step(() => ok({ name: "Alice" }));

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

    const result = await run(async (step) => {
      const value = await step(() => asyncOp());
      return value * 2;
    });

    expect(result).toEqual({ ok: true, value: 84 });
  });

  it("calls onError callback when step fails", async () => {
    const errors: Array<{ error: unknown; stepName?: string }> = [];

    await run(
      async (step) => {
        await step(() => err("VALIDATION_ERROR"), "validateInput");
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

    const result = await run(async (step) => {
      await step(() => err("DB_ERROR", { cause: originalCause }));
      return 0;
    });

    if (isErr(result)) {
      expect(result.cause).toBe(originalCause);
    }
  });

  describe("step.try() with throwing operations", () => {
    it("catches and maps thrown errors (async)", async () => {
      const result = await run(
        async (step) => {
          const value = await step.try(
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
        async (step) => {
          // Sync operation - no async/await needed!
          const value = await step.try(
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
      const result = await run(async (step) => {
        // Sync operation that doesn't throw
        const value = await step.try(() => JSON.parse('{"x": 42}'), {
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
        async (step) => {
          await step.try(
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
        async (step) => {
          await step.try(
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
        async (step) => {
          const user = await step.fromResult(() => fetchUser("1"), {
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
        async (step) => {
          const user = await step.fromResult(() => fetchUser("1"), {
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
        async (step) => {
          return await step.fromResult(() => failingOp(), {
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
        async (step) => {
          return await step.fromResult(() => asyncFetch(), {
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
        async (step) => {
          return await step.fromResult(() => opWithCause(), {
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
        async (step) => {
          return await step.fromResult(() => callProvider(), {
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
        async (step) => {
          return await step.fromResult(() => failingOp(), {
            error: "MAPPED",
            name: "fromResultStep",
            key: "fr:1",
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

      expect(stepStart).toMatchObject({ name: "fromResultStep", stepKey: "fr:1" });
      expect(stepError).toMatchObject({ name: "fromResultStep", stepKey: "fr:1" });
      expect(stepComplete).toMatchObject({
        name: "fromResultStep",
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
        expect(result.error).toMatchObject({
          type: "UNEXPECTED_ERROR",
          cause: { type: "UNCAUGHT_EXCEPTION" },
        });
        const thrown =
          result.error.cause &&
          typeof result.error.cause === "object" &&
          "thrown" in result.error.cause
            ? (result.error.cause as { thrown?: unknown }).thrown
            : undefined;
        expect(thrown).toBeInstanceOf(Error);
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
        async (step) => {
          const user = await step(() => fetchUser("unknown")); // Returns NOT_FOUND
          const posts = await step(() => fetchPosts(user.id));
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
      // With no options, run() returns UnexpectedError for any failures
      const result = await run(async () => {
        throw new Error("unexpected!");
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        // Error type is UnexpectedError
        expect(result.error).toMatchObject({
          type: "UNEXPECTED_ERROR",
          cause: { type: "UNCAUGHT_EXCEPTION" },
        });
        const thrown =
          result.error.cause &&
          typeof result.error.cause === "object" &&
          "thrown" in result.error.cause
            ? (result.error.cause as { thrown?: unknown }).thrown
            : undefined;
        expect(thrown).toBeInstanceOf(Error);
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
        expect.objectContaining({
          type: "UNEXPECTED_ERROR",
          cause: expect.objectContaining({ type: "UNCAUGHT_EXCEPTION" }),
        }),
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
      async (step) => {
        await step(() => fetchUser()); // Should compile without mapError
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
      async (step) => {
        await step(() => validate());
        return 1;
      },
      { onError: () => {} }
    );

    expect(isErr(result)).toBe(true);
  });

  it("step.try() is clearly separate from step()", async () => {
    // This test ensures the two methods don't get confused
    const result = await run<string, "NETWORK" | "PARSE">(
      async (step) => {
        // Result-returning: use step()
        const data = await step(
          () => ok({ raw: '{"x":1}' }) as Result<{ raw: string }, "NETWORK">
        );

        // Throwing operation: use step.try()
        const parsed = await step.try(
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

describe("step() direct Result support", () => {
  it("accepts direct Result instead of function", async () => {
    const fetchUser = async (): AsyncResult<
      { id: string; name: string },
      "NOT_FOUND"
    > => ok({ id: "1", name: "Alice" });

    const result = await run(async (step) => {
      // Direct Result form - no wrapper function needed
      const user = await step(fetchUser());
      return user;
    });

    expect(result).toEqual({
      ok: true,
      value: { id: "1", name: "Alice" },
    });
  });

  it("accepts direct sync Result", async () => {
    const validate = (): Result<number, "INVALID"> => ok(42);

    const result = await run(async (step) => {
      const value = await step(validate());
      return value;
    });

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("handles direct Result errors correctly", async () => {
    const fetchUser = async (): AsyncResult<number, "NOT_FOUND"> =>
      err("NOT_FOUND");

    const result = await run(
      async (step) => {
        await step(fetchUser());
        return 1;
      },
      { onError: () => {} } // Use onError for typed errors
    );

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("still supports function form (backwards compatible)", async () => {
    const fetchUser = async (): AsyncResult<number, "NOT_FOUND"> => ok(42);

    const result = await run(async (step) => {
      // Function form still works
      const value = await step(() => fetchUser());
      return value;
    });

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("can mix direct and function forms", async () => {
    const fetchUser = async (): AsyncResult<number, "NOT_FOUND"> => ok(1);
    const fetchPosts = async (): AsyncResult<number, "FETCH_ERROR"> => ok(2);

    const result = await run(async (step) => {
      const user = await step(fetchUser()); // Direct
      const posts = await step(() => fetchPosts()); // Function
      return user + posts;
    });

    expect(result).toEqual({ ok: true, value: 3 });
  });
});

describe("run() safe default ergonomics", () => {
  it("preserves step error details inside UnexpectedError cause", async () => {
    const failure = { code: "NOT_FOUND" } ;

    const result = await run(async (step) => {
      await step(() => err(failure), "failingStep");
      return "unreachable";
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("UNEXPECTED_ERROR");
      expect(result.error.cause).toEqual({
        type: "STEP_FAILURE",
        origin: "result",
        error: failure,
      });
    }
  });

  it("preserves step.try mapped errors and thrown causes", async () => {
    const boom = new Error("boom");

    const result = await run(async (step) => {
      await step.try(
        () => {
          throw boom;
        },
        { error: { type: "NETWORK"  }, name: "networkCall" }
      );
      return "unreachable";
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("UNEXPECTED_ERROR");
      expect(result.error.cause).toMatchObject({
        type: "STEP_FAILURE",
        origin: "throw",
        error: { type: "NETWORK" },
      });
      expect(
        result.error.cause &&
          typeof result.error.cause === "object" &&
          "thrown" in result.error.cause
      ).toBe(true);
      if (
        result.error.cause &&
        typeof result.error.cause === "object" &&
        "thrown" in result.error.cause
      ) {
        expect(
          (result.error.cause as { thrown?: unknown }).thrown
        ).toBe(boom);
      }
    }
  });
});

describe("onEvent (Phase 1 event stream)", () => {
  it("emits step_start and step_success events for each step", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    await run(
      async (step) => {
        await step(() => ok(1), { name: "step1" });
        await step(() => ok(2), { name: "step2" });
        return 42;
      },
      {
        onEvent: (event) => events.push(event),
      }
    );

    // run() emits 4 step events: step_start + step_success for each of 2 steps
    expect(events).toHaveLength(4);

    // Verify step_start is first for step1
    expect(events[0]).toMatchObject({ type: "step_start", name: "step1" });

    // All events should have same workflowId
    const workflowId = events[0].workflowId;
    expect(events.every((e) => e.workflowId === workflowId)).toBe(true);

    // Verify we have step_start and step_success pairs
    expect(events.filter((e) => e.type === "step_start")).toHaveLength(2);
    expect(events.filter((e) => e.type === "step_success")).toHaveLength(2);
  });

  it("emits step_error on failure", async () => {
    const events: WorkflowEvent<string | UnexpectedError>[] = [];

    await run<number, "FAIL">(
      async (step) => {
        await step(() => err("FAIL"), { name: "failStep" });
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
      async (step) => {
        await step(() => ok(1), { name: "loadUser", key: "user:123" });
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

  it("supports string shorthand for step name", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    await run(
      async (step) => {
        await step(() => ok(1), "myStep");
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
      async (step) => {
        await step.try(() => 42, { error: "ERR", name: "tryStep", key: "try:1" });
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
      name: "tryStep",
      stepKey: "try:1",
    });
  });
});

describe("createWorkflow with onEvent and createContext", () => {
  it("emits workflow lifecycle events", async () => {
    const events: WorkflowEvent<string | UnexpectedError>[] = [];
    const fetchData = async (): AsyncResult<number, "FETCH_ERROR"> => ok(42);

    const workflow = createWorkflow(
      { fetchData },
      {
        onEvent: (event) => events.push(event),
      }
    );

    await workflow(async (step) => {
      await step(fetchData());
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
      { failingFn },
      {
        onEvent: (event) => events.push(event),
      }
    );

    await workflow(async (step) => {
      await step(failingFn());
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
      { fetchData },
      {
        createContext: () => {
          contextCalls++;
          return { requestId: "req-123", count: contextCalls };
        },
        onEvent: (event, ctx) => events.push({ event, ctx }),
      }
    );

    await workflow(async (step) => {
      await step(fetchData());
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
      { fetchData },
      {
        createContext: () => {
          counter++;
          return counter;
        },
        onEvent: (_, ctx) => contexts.push(ctx),
      }
    );

    await workflow(async (step) => step(fetchData()));
    await workflow(async (step) => step(fetchData()));

    // Should see context values 1 and 2 from different runs
    expect(contexts).toContain(1);
    expect(contexts).toContain(2);
  });

  it("includes context in event.context when provided", async () => {
    type Context = { requestId: string };
    const events: WorkflowEvent<unknown, Context>[] = [];

    const fetchData = async (): AsyncResult<number, never> => ok(42);

    const workflow = createWorkflow(
      { fetchData },
      {
        createContext: (): Context => ({ requestId: "req-123" }),
        onEvent: (event) => events.push(event),
      }
    );

    await workflow(async (step) => step(fetchData()));

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

    const workflow = createWorkflow({ fetchData }, {
      onEvent: (event) => events.push(event),
    });

    await workflow(async (step) => step(fetchData()));

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

    await workflow(async (step) => step(fetchData()));

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
      { failingFn },
      {
        createContext: (): Context => ({ requestId: "req-123" }),
        onError: (error, stepName, ctx) => {
          errors.push({ error, stepName, ctx });
        },
      }
    );

    await workflow(async (step) => {
      await step(failingFn(), { name: "test-step" });
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

    const workflow = createWorkflow({ failingFn }, {
      onError: (error, stepName, ctx) => {
        errors.push({ error, stepName, ctx });
      },
    });

    await workflow(async (step) => {
      await step(failingFn());
      return "done";
    });

    expect(errors.length).toBe(1);
    expect(errors[0].ctx).toBeUndefined();
  });

  it("events include timestamps and durations", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const fetchData = async (): AsyncResult<number, never> => ok(42);

    const workflow = createWorkflow(
      { fetchData },
      {
        onEvent: (event) => events.push(event),
      }
    );

    await workflow(async (step) => {
      await step(fetchData(), { name: "fetch" });
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
      async (step) => {
        return await step(() => fetchUser());
      },
      { catchUnexpected: () => "UNEXPECTED"  }
    );

    expect(result).toEqual({ ok: true, value: 42 });

    // Type test: error should be exactly AppError
    if (!result.ok) {
      const _error: AppError = result.error;
    }
  });

  it("handles errors correctly in strict mode", async () => {
    type AppError = "NOT_FOUND" | "UNEXPECTED";

    const fetchUser = async (): AsyncResult<number, "NOT_FOUND"> =>
      err("NOT_FOUND");

    const result = await run.strict<number, AppError>(
      async (step) => {
        return await step(() => fetchUser());
      },
      { catchUnexpected: () => "UNEXPECTED" }
    );

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("works with step.try()", async () => {
    type AppError = "NETWORK" | "UNEXPECTED";

    const result = await run.strict<number, AppError>(
      async (step) => {
        return await step.try(() => 42, { error: "NETWORK"  });
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
      async (step) => {
        return await step(fetchUser());
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
      async (step) => {
        return await step(fetchUser());
      },
      { onError, catchUnexpected: () => "UNEXPECTED"  }
    );

    expect(onError).toHaveBeenCalledWith("NOT_FOUND", undefined, undefined);
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
    // This maintains the strict mode contract: AsyncResult<T, E> with no UnexpectedError.
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
      const getPosts = createWorkflow({ fetchUser, fetchPosts });

      const result = await getPosts(async (step) => {
        const user = await step(fetchUser("1"));
        const posts = await step(fetchPosts(user.id));
        return { user, posts };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.user.name).toBe("Alice");
        expect(result.value.posts).toHaveLength(1);
      }
    });

    it("returns error when step fails", async () => {
      const getPosts = createWorkflow({ fetchUser, fetchPosts });

      const result = await getPosts(async (step) => {
        const user = await step(fetchUser("999")); // Will fail
        return user;
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NOT_FOUND");
      }
    });

    it("short-circuits on first error", async () => {
      const getPosts = createWorkflow({ fetchUser, fetchPosts });
      const fetchPostsCalled = vi.fn();

      const result = await getPosts(async (step) => {
        const user = await step(fetchUser("999")); // Will fail
        fetchPostsCalled();
        const posts = await step(fetchPosts(user.id));
        return { user, posts };
      });

      expect(result.ok).toBe(false);
      expect(fetchPostsCalled).not.toHaveBeenCalled();
    });
  });

  describe("deps object in callback", () => {
    it("passes deps object as second argument for destructuring", async () => {
      const getPosts = createWorkflow({ fetchUser, fetchPosts });

      const result = await getPosts(async (step, deps) => {
        expect(deps.fetchUser).toBe(fetchUser);
        expect(deps.fetchPosts).toBe(fetchPosts);
        const user = await step(deps.fetchUser("1"));
        return user;
      });

      expect(result.ok).toBe(true);
    });

    it("allows destructuring deps in callback", async () => {
      const getPosts = createWorkflow({ fetchUser, fetchPosts });

      const result = await getPosts(async (step, { fetchUser: fu, fetchPosts: fp }) => {
        const user = await step(fu("1"));
        const posts = await step(fp(user.id));
        return { user, posts };
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("options", () => {
    it("calls onError when step fails", async () => {
      const onError = vi.fn();
      const getPosts = createWorkflow({ fetchUser }, { onError });

      await getPosts(async (step) => {
        return await step(fetchUser("999"));
      });

      expect(onError).toHaveBeenCalledWith("NOT_FOUND", undefined, undefined);
    });
  });

  describe("strict mode", () => {
    it("uses run.strict internally with catchUnexpected", async () => {
      const getPosts = createWorkflow(
        { fetchUser },
        {
          strict: true,
          catchUnexpected: () => "UNEXPECTED" as const,
        }
      );

      // Normal error
      const result1 = await getPosts(async (step) => {
        return await step(fetchUser("999"));
      });
      expect(result1.ok).toBe(false);
      if (!result1.ok) {
        expect(result1.error).toBe("NOT_FOUND");
      }

      // Unexpected exception gets mapped
      const result2 = await getPosts(async () => {
        throw new Error("unexpected");
      });
      expect(result2.ok).toBe(false);
      if (!result2.ok) {
        expect(result2.error).toBe("UNEXPECTED");
      }
    });

    it("calls onError in strict mode", async () => {
      const onError = vi.fn();
      const getPosts = createWorkflow(
        { fetchUser },
        {
          strict: true,
          catchUnexpected: () => "UNEXPECTED" as const,
          onError,
        }
      );

      await getPosts(async (step) => {
        return await step(fetchUser("999"));
      });

      expect(onError).toHaveBeenCalledWith("NOT_FOUND", undefined, undefined);
    });
  });

  describe("workflow reuse", () => {
    it("can be called multiple times", async () => {
      const getPosts = createWorkflow({ fetchUser, fetchPosts });

      const result1 = await getPosts(async (step) => {
        return await step(fetchUser("1"));
      });

      const result2 = await getPosts(async (step) => {
        return await step(fetchUser("999"));
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
      const workflow = createWorkflow({ expensiveOp }, { cache });

      // Use lazy form: step(() => expensiveOp(...)) to enable caching
      const result = await workflow(async (step) => {
        const first = await step(() => expensiveOp("123"), { key: "op:123" });
        const second = await step(() => expensiveOp("123"), { key: "op:123" });
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

    it("does not cache when key is not provided", async () => {
      let callCount = 0;
      const expensiveOp = async (): AsyncResult<number, "ERROR"> => {
        callCount++;
        return ok(callCount);
      };

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow({ expensiveOp }, { cache });

      const result = await workflow(async (step) => {
        const first = await step(() => expensiveOp());
        const second = await step(() => expensiveOp());
        return { first, second };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.first).toBe(1);
        expect(result.value.second).toBe(2);
      }
      expect(callCount).toBe(2);
      expect(cache.size).toBe(0);
    });
  });

  describe("workflow hooks", () => {
    describe("onBeforeStart", () => {
      it("calls onBeforeStart before workflow execution", async () => {
        const onBeforeStart = vi.fn().mockResolvedValue(true);
        const workflow = createWorkflow({ fetchUser }, { onBeforeStart });

        await workflow(async (step) => {
          return await step(fetchUser("1"));
        });

        expect(onBeforeStart).toHaveBeenCalledTimes(1);
        const call = onBeforeStart.mock.calls[0];
        expect(call[0]).toMatch(/^[0-9a-f-]{36}$/); // workflowId UUID
        expect(call[1]).toBeUndefined(); // context (void by default)
      });

      it("skips workflow when onBeforeStart returns false", async () => {
        const onBeforeStart = vi.fn().mockResolvedValue(false);
        const workflow = createWorkflow({ fetchUser }, { onBeforeStart });

        const result = await workflow(async (step) => {
          return await step(fetchUser("1"));
        });

        expect(onBeforeStart).toHaveBeenCalledTimes(1);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBeDefined();
        }
      });

      it("supports sync onBeforeStart", async () => {
        const onBeforeStart = vi.fn().mockReturnValue(true);
        const workflow = createWorkflow({ fetchUser }, { onBeforeStart });

        await workflow(async (step) => {
          return await step(fetchUser("1"));
        });

        expect(onBeforeStart).toHaveBeenCalledTimes(1);
      });

      it("passes context to onBeforeStart", async () => {
        type Context = { userId: string };
        const onBeforeStart = vi.fn<[string, Context], Promise<boolean>>().mockResolvedValue(true);
        const createContext = (): Context => ({ userId: "user-123" });
        const workflow = createWorkflow<{ fetchUser: typeof fetchUser }, Context>({ fetchUser }, { onBeforeStart, createContext });

        await workflow(async (step) => {
          return await step(fetchUser("1"));
        });

        expect(onBeforeStart).toHaveBeenCalledTimes(1);
        expect(onBeforeStart.mock.calls[0][1]).toEqual({ userId: "user-123" });
      });

      it("works in strict mode", async () => {
        const onBeforeStart = vi.fn().mockResolvedValue(true);
        const workflow = createWorkflow(
          { fetchUser },
          {
            strict: true,
            catchUnexpected: () => "UNEXPECTED" as const,
            onBeforeStart,
          }
        );

        await workflow(async (step) => {
          return await step(fetchUser("1"));
        });

        expect(onBeforeStart).toHaveBeenCalledTimes(1);
      });

      it("returns Result when onBeforeStart throws (not rejects workflow)", async () => {
        const hookError = new Error("Lock acquisition failed");
        const onBeforeStart = vi.fn().mockRejectedValue(hookError);
        const workflow = createWorkflow({ fetchUser }, { onBeforeStart });

        // Should NOT throw/reject - should return Result
        const result = await workflow(async (step) => {
          return await step(fetchUser("1"));
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect((result.error as { type: string }).type).toBe("UNEXPECTED_ERROR");
          expect((result.error as { cause: { thrown: Error } }).cause.thrown).toBe(hookError);
        }
      });

      it("routes thrown onBeforeStart error through catchUnexpected in strict mode", async () => {
        const hookError = new Error("Lock acquisition failed");
        const onBeforeStart = vi.fn().mockRejectedValue(hookError);
        const catchUnexpected = vi.fn().mockReturnValue("LOCK_FAILED" as const);
        const workflow = createWorkflow(
          { fetchUser },
          {
            strict: true,
            catchUnexpected,
            onBeforeStart,
          }
        );

        const result = await workflow(async (step) => {
          return await step(fetchUser("1"));
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
        const workflow = createWorkflow({ fetchUser, fetchPosts }, { onAfterStep });

        await workflow(async (step) => {
          const user = await step(() => fetchUser("1"), { key: "user:1" });
          const posts = await step(() => fetchPosts(user.id), { key: "posts:1" });
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
        const workflow = createWorkflow({ fetchUser, fetchPosts }, { onAfterStep });

        await workflow(async (step) => {
          const user = await step(() => fetchUser("1"), { key: "user:1" });
          const posts = await step(() => fetchPosts("999"), { key: "posts:999" }); // Will fail
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

        const workflow = createWorkflow({ fetchUser }, { onAfterStep, cache });

        await workflow(async (step) => {
          return await step(() => fetchUser("1"), { key: "user:1" });
        });

        expect(onAfterStep).not.toHaveBeenCalled();
      });

      it("passes context to onAfterStep", async () => {
        type Context = { requestId: string };
        const onAfterStep = vi.fn().mockImplementation((_stepKey: string, _result: Result<unknown, unknown, unknown>, _workflowId: string, _ctx: Context) => Promise.resolve());
        const createContext = (): Context => ({ requestId: "req-456" });
        const workflow = createWorkflow({ fetchUser }, { onAfterStep, createContext });

        await workflow(async (step) => {
          return await step(() => fetchUser("1"), { key: "user:1" });
        });

        expect(onAfterStep).toHaveBeenCalledTimes(1);
        expect(onAfterStep.mock.calls[0][3]).toEqual({ requestId: "req-456" });
      });

      it("works in strict mode", async () => {
        const onAfterStep = vi.fn();
        const workflow = createWorkflow(
          { fetchUser },
          {
            strict: true,
            catchUnexpected: () => "UNEXPECTED" as const,
            onAfterStep,
          }
        );

        await workflow(async (step) => {
          return await step(() => fetchUser("1"), { key: "user:1" });
        });

        expect(onAfterStep).toHaveBeenCalledTimes(1);
      });
    });

    describe("shouldRun", () => {
      it("calls shouldRun before workflow execution", async () => {
        const shouldRun = vi.fn().mockResolvedValue(true);
        const workflow = createWorkflow({ fetchUser }, { shouldRun });

        await workflow(async (step) => {
          return await step(fetchUser("1"));
        });

        expect(shouldRun).toHaveBeenCalledTimes(1);
        expect(shouldRun.mock.calls[0][0]).toMatch(/^[0-9a-f-]{36}$/); // workflowId
        expect(shouldRun.mock.calls[0][1]).toBeUndefined(); // context
      });

      it("skips workflow when shouldRun returns false", async () => {
        const shouldRun = vi.fn().mockResolvedValue(false);
        const workflow = createWorkflow({ fetchUser }, { shouldRun });

        const result = await workflow(async (step) => {
          return await step(fetchUser("1"));
        });

        expect(shouldRun).toHaveBeenCalledTimes(1);
        expect(result.ok).toBe(false);
      });

      it("supports sync shouldRun", async () => {
        const shouldRun = vi.fn().mockReturnValue(true);
        const workflow = createWorkflow({ fetchUser }, { shouldRun });

        await workflow(async (step) => {
          return await step(fetchUser("1"));
        });

        expect(shouldRun).toHaveBeenCalledTimes(1);
      });

      it("passes context to shouldRun", async () => {
        type Context = { instanceId: string };
        const shouldRun = vi.fn().mockImplementation((_workflowId: string, _ctx: Context) => Promise.resolve(true));
        const createContext = (): Context => ({ instanceId: "instance-789" });
        const workflow = createWorkflow({ fetchUser }, { shouldRun, createContext });

        await workflow(async (step) => {
          return await step(fetchUser("1"));
        });

        expect(shouldRun).toHaveBeenCalledTimes(1);
        expect(shouldRun.mock.calls[0][1]).toEqual({ instanceId: "instance-789" });
      });

      it("works in strict mode", async () => {
        const shouldRun = vi.fn().mockResolvedValue(true);
        const workflow = createWorkflow(
          { fetchUser },
          {
            strict: true,
            catchUnexpected: () => "UNEXPECTED" as const,
            shouldRun,
          }
        );

        await workflow(async (step) => {
          return await step(fetchUser("1"));
        });

        expect(shouldRun).toHaveBeenCalledTimes(1);
      });

      it("skip error goes through catchUnexpected in strict mode", async () => {
        const shouldRun = vi.fn().mockResolvedValue(false);
        const catchUnexpected = vi.fn().mockReturnValue("SKIPPED" as const);
        const workflow = createWorkflow(
          { fetchUser },
          {
            strict: true,
            catchUnexpected,
            shouldRun,
          }
        );

        const result = await workflow(async (step) => {
          return await step(fetchUser("1"));
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
        const workflow = createWorkflow({ fetchUser }, { shouldRun });

        // Should NOT throw/reject - should return Result
        const result = await workflow(async (step) => {
          return await step(fetchUser("1"));
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect((result.error as { type: string }).type).toBe("UNEXPECTED_ERROR");
          expect((result.error as { cause: { thrown: Error } }).cause.thrown).toBe(hookError);
        }
      });

      it("routes thrown hook error through catchUnexpected in strict mode", async () => {
        const hookError = new Error("Redis connection failed");
        const shouldRun = vi.fn().mockRejectedValue(hookError);
        const catchUnexpected = vi.fn().mockReturnValue("HOOK_FAILED" as const);
        const workflow = createWorkflow(
          { fetchUser },
          {
            strict: true,
            catchUnexpected,
            shouldRun,
          }
        );

        const result = await workflow(async (step) => {
          return await step(fetchUser("1"));
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
        const workflow = createWorkflow({ fetchUser }, { shouldRun, onBeforeStart });

        await workflow(async (step) => {
          return await step(fetchUser("1"));
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
      const workflow = createWorkflow({ expensiveOp }, { cache });

      // First run - use lazy form for caching
      const result1 = await workflow(async (step) => {
        return await step(() => expensiveOp("123"), { key: "op:123" });
      });

      // Second run - should use cache
      const result2 = await workflow(async (step) => {
        return await step(() => expensiveOp("123"), { key: "op:123" });
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
        { expensiveOp },
        {
          cache,
          onEvent: (event) => events.push(event),
        }
      );

      await workflow(async (step) => {
        const first = await step(() => expensiveOp(), { key: "op:1", name: "firstCall" });
        const second = await step(() => expensiveOp(), { key: "op:1", name: "secondCall" });
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
      const workflow = createWorkflow({}, { cache });

      const result = await workflow(async (step) => {
        const first = await step.try(
          () => {
            callCount++;
            return 42;
          },
          { error: "FAILED" as const, key: "try:1" }
        );
        const second = await step.try(
          () => {
            callCount++;
            return 99;
          },
          { error: "FAILED" as const, key: "try:1" }
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
      const workflow = createWorkflow({ expensiveOp }, { cache });

      // Use lazy form for caching
      const result = await workflow(async (step) => {
        const a = await step(() => expensiveOp("a"), { key: "op:a" });
        const b = await step(() => expensiveOp("b"), { key: "op:b" });
        const a2 = await step(() => expensiveOp("a"), { key: "op:a" });
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

      const workflow = createWorkflow({ expensiveOp }); // No cache

      const result = await workflow(async (step) => {
        const first = await step(() => expensiveOp(), { key: "op:1" });
        const second = await step(() => expensiveOp(), { key: "op:1" });
        return { first, second };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.first).toBe(1);
        expect(result.value.second).toBe(2); // Not cached
      }
      expect(callCount).toBe(2);
    });

    it("works with strict mode", async () => {
      let callCount = 0;
      const expensiveOp = async (): AsyncResult<number, "ERROR"> => {
        callCount++;
        return ok(callCount);
      };

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow(
        { expensiveOp },
        {
          strict: true,
          catchUnexpected: () => "UNEXPECTED" as const,
          cache,
        }
      );

      // Use lazy form for caching
      const result = await workflow(async (step) => {
        const first = await step(() => expensiveOp(), { key: "op:1" });
        const second = await step(() => expensiveOp(), { key: "op:1" });
        return { first, second };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.first).toBe(1);
        expect(result.value.second).toBe(1); // Cached
      }
      expect(callCount).toBe(1);
    });

    it("eager form still works but does not prevent execution", async () => {
      // This test documents that eager form (step(promise)) runs the operation
      // before caching can intercept it. Use lazy form for caching.
      let callCount = 0;
      const expensiveOp = async (): AsyncResult<number, "ERROR"> => {
        callCount++;
        return ok(callCount);
      };

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow({ expensiveOp }, { cache });

      const result = await workflow(async (step) => {
        // Eager form: expensiveOp() is called before step() sees it
        const first = await step(expensiveOp(), { key: "op:1" });
        const second = await step(expensiveOp(), { key: "op:1" });
        return { first, second };
      });

      expect(result.ok).toBe(true);
      // Both calls execute because the promise is created before step() runs
      expect(callCount).toBe(2);
      // But the result is still cached for future runs
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
        { failingOp },
        {
          cache,
          onEvent: (event) => events.push(event),
        }
      );

      // First run - populate cache with error
      const result1 = await workflow(async (step) => {
        return await step(() => failingOp(), { key: "failing:1", name: "failingCall" });
      });

      expect(result1.ok).toBe(false);
      if (!result1.ok) {
        expect(result1.cause).toEqual(originalCause);
      }

      // Clear events for second run
      events.length = 0;

      // Second run - should hit cache
      const result2 = await workflow(async (step) => {
        return await step(() => failingOp(), { key: "failing:1", name: "failingCall" });
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
        {},
        {
          cache,
          onEvent: (event) => events.push(event),
        }
      );

      // First run - populate cache with error via step.try
      const result1 = await workflow(async (step) => {
        return await step.try(
          () => {
            throw new Error("original throw");
          },
          { error: "TRY_ERROR" as const, key: "try:1", name: "tryCall" }
        );
      });

      expect(result1.ok).toBe(false);

      // Clear events for second run
      events.length = 0;

      // Second run - should hit cache
      const result2 = await workflow(async (step) => {
        return await step.try(
          () => {
            throw new Error("should not be called");
          },
          { error: "TRY_ERROR" as const, key: "try:1", name: "tryCall" }
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
  });

  describe("strict mode event type soundness", () => {
    it("step_error events use catchUnexpected for uncaught exceptions", async () => {
      // Bug fix: In strict mode, step_error events should contain the mapped error
      // from catchUnexpected, not UnexpectedError
      const events: WorkflowEvent<unknown>[] = [];

      const workflow = createWorkflow(
        {},
        {
          strict: true,
          catchUnexpected: () => "MAPPED_UNEXPECTED" as const,
          onEvent: (event) => events.push(event),
        }
      );

      const result = await workflow(async (step) => {
        // This will throw an uncaught exception in the step
        return await step.try(
          async () => {
            throw new Error("uncaught in step");
          },
          { error: "DOMAIN_ERROR" as const, name: "throwingStep" }
        );
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Result should have the domain error from step.try's error option
        expect(result.error).toBe("DOMAIN_ERROR");
      }
    });

    it("strict mode step events contain mapped errors not UnexpectedError", async () => {
      // When a step operation itself throws (not via step.try), strict mode
      // should map the error via catchUnexpected for the event
      const events: WorkflowEvent<"OP_ERROR" | "MAPPED">[] = [];

      const throwingOp = async (): AsyncResult<number, "OP_ERROR"> => {
        throw new Error("operation threw unexpectedly");
      };

      const workflow = createWorkflow(
        { throwingOp },
        {
          strict: true,
          catchUnexpected: () => "MAPPED" as const,
          onEvent: (event) => events.push(event),
        }
      );

      const result = await workflow(async (step) => {
        return await step(() => throwingOp(), { name: "throwingOp" });
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
        {},
        {
          strict: true,
          catchUnexpected: () => {
            catchCount++;
            return `MAPPED_${catchCount}` as const;
          },
        }
      );

      const result = await workflow(async (step) => {
        return await step.try(
          () => {
            throw new Error("test error");
          },
          { error: "DOMAIN_ERROR" as const }
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
        { throwingOp },
        {
          strict: true,
          catchUnexpected: () => {
            catchCount++;
            const mapped = `MAPPED_${catchCount}`;
            mappedErrors.push(mapped);
            return mapped as "MAPPED_1" | "MAPPED_2";
          },
        }
      );

      const result = await workflow(async (step) => {
        return await step(() => throwingOp());
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
          async (step) => {
            await step(() => {
              throw new Error("boom");
            });
          },
          { catchUnexpected: mapper }
        )
      ).rejects.toThrow("mapper broke");
    });

    it("safe-default mode produces UNCAUGHT_EXCEPTION cause", async () => {
      // Bug fix: Uncaught step exceptions in safe-default mode should produce
      // UnexpectedError with cause.type = "UNCAUGHT_EXCEPTION", not "STEP_FAILURE"

      const result = await run(async (step) => {
        await step(() => {
          throw new Error("boom");
        });
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({
          type: "UNEXPECTED_ERROR",
          cause: {
            type: "UNCAUGHT_EXCEPTION",
            thrown: expect.any(Error),
          },
        });
      }
    });
  });

  describe("cached step.try error metadata preservation", () => {
    it("cached step.try errors preserve origin:'throw' metadata", async () => {
      // Bug fix: Cached step.try errors were losing origin:"throw" and becoming
      // origin:"result". This broke the UnexpectedError.cause contract.

      const cache = new Map<string, Result<unknown, unknown>>();
      const workflow = createWorkflow({}, { cache });

      // First run - populate cache with step.try error
      const result1 = await workflow(async (step) => {
        return await step.try(
          () => {
            throw new Error("original throw");
          },
          { error: "TRY_ERROR" as const, key: "try:meta" }
        );
      });

      expect(result1.ok).toBe(false);
      if (!result1.ok) {
        // First result should have origin:"throw" in its cause structure
        // The cause is the thrown error wrapped appropriately
        expect(result1.cause).toBeInstanceOf(Error);
      }

      // Second run - should hit cache and preserve metadata
      const result2 = await workflow(async (step) => {
        return await step.try(
          () => {
            throw new Error("should not be called");
          },
          { error: "TRY_ERROR" as const, key: "try:meta" }
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
      { fetchUser },
      { onEvent: (event) => events.push(event) }
    );

    await workflow(async (step) => {
      return await step(() => fetchUser("123"), { key: "user:123", name: "fetchUser" });
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
      { fetchUser },
      { onEvent: (event) => events.push(event) }
    );

    await workflow(async (step) => {
      return await step(() => fetchUser("unknown"), { key: "user:unknown", name: "fetchUser" });
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

  it("does NOT fire step_complete for un-keyed steps", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const fetchUser = async (): AsyncResult<string, "NOT_FOUND"> => ok("Alice");

    const workflow = createWorkflow(
      { fetchUser },
      { onEvent: (event) => events.push(event) }
    );

    await workflow(async (step) => {
      // No key provided
      return await step(() => fetchUser(), { name: "fetchUser" });
    });

    const stepCompleteEvents = events.filter((e) => e.type === "step_complete");
    expect(stepCompleteEvents).toHaveLength(0);
  });

  it("fires step_complete for step.try on success", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    const workflow = createWorkflow({}, { onEvent: (event) => events.push(event) });

    await workflow(async (step) => {
      return await step.try(
        () => JSON.parse('{"valid": true}'),
        { error: "PARSE_ERROR" as const, key: "parse:1", name: "parseJSON" }
      );
    });

    const stepCompleteEvents = events.filter((e) => e.type === "step_complete");
    expect(stepCompleteEvents).toHaveLength(1);
    expect(stepCompleteEvents[0]).toMatchObject({
      type: "step_complete",
      stepKey: "parse:1",
      name: "parseJSON",
    });
    const completeEvent = stepCompleteEvents[0] as Extract<WorkflowEvent<unknown>, { type: "step_complete" }>;
    expect(completeEvent.result).toEqual({ ok: true, value: { valid: true } });
  });

  it("fires step_complete for step.try on error", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    const workflow = createWorkflow({}, { onEvent: (event) => events.push(event) });

    await workflow(async (step) => {
      return await step.try(
        () => JSON.parse("invalid json"),
        { error: "PARSE_ERROR" as const, key: "parse:2", name: "parseJSON" }
      );
    });

    const stepCompleteEvents = events.filter((e) => e.type === "step_complete");
    expect(stepCompleteEvents).toHaveLength(1);
    expect(stepCompleteEvents[0]).toMatchObject({
      type: "step_complete",
      stepKey: "parse:2",
      name: "parseJSON",
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
      { fetchUser },
      { onEvent: (event) => events.push(event) }
    );

    await workflow(async (step) => {
      return await step(() => fetchUser(), { key: "user:1" });
    });

    // Use the type guard
    const stepCompleteEvents = events.filter(isStepComplete);
    expect(stepCompleteEvents).toHaveLength(1);
    expect(stepCompleteEvents[0].stepKey).toBe("user:1");
    expect(stepCompleteEvents[0].result.ok).toBe(true);
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

    const workflow = createWorkflow({ expensiveOp }, { resumeState });

    const result = await workflow(async (step) => {
      // This should hit the resume state cache
      return await step(() => expensiveOp(), { key: "op:1" });
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

    const workflow = createWorkflow({ expensiveOp }, { resumeState: loadResumeState });

    const result = await workflow(async (step) => {
      return await step(() => expensiveOp(), { key: "async:op" });
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

    const workflow = createWorkflow({ failingOp }, { resumeState });

    const result = await workflow(async (step) => {
      return await step(() => failingOp(), { key: "fail:1" });
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
      { expensiveOp },
      {
        resumeState,
        onEvent: (event) => events.push(event),
      }
    );

    const result = await workflow(async (step) => {
      return await step(() => expensiveOp(), { key: "auto:cache" });
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

  it("step_complete events can be collected for save", async () => {
    // This demonstrates the full save flow with ResumeStateEntry
    const savedSteps = new Map<string, ResumeStateEntry>();
    const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> =>
      ok({ id, name: "Alice" });
    const fetchPosts = async (_userId: string): AsyncResult<{ posts: string[] }, "FETCH_ERROR"> =>
      ok({ posts: ["Hello", "World"] });

    const workflow = createWorkflow(
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

    await workflow(async (step) => {
      const user = await step(() => fetchUser("1"), { key: "user:1" });
      const posts = await step(() => fetchPosts(user.id), { key: "posts:1" });
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
      { fetchUser, fetchPosts },
      {
        onEvent: (event) => {
          if (isStepComplete(event)) {
            savedSteps.set(event.stepKey, { result: event.result, meta: event.meta });
          }
        },
      }
    );

    await workflow1(async (step) => {
      const user = await step(() => fetchUser("1"), { key: "user:1" });
      const posts = await step(() => fetchPosts(), { key: "posts:1" });
      return { user, posts };
    });

    expect(userCallCount).toBe(1);
    expect(postsCallCount).toBe(1);
    expect(savedSteps.size).toBe(2);

    // Second run: resume with saved state
    const workflow2 = createWorkflow(
      { fetchUser, fetchPosts },
      { resumeState: { steps: savedSteps } }
    );

    const result = await workflow2(async (step) => {
      const user = await step(() => fetchUser("1"), { key: "user:1" });
      const posts = await step(() => fetchPosts(), { key: "posts:1" });
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

    const workflow1 = createWorkflow({}, {
      onEvent: (event) => {
        if (isStepComplete(event)) {
          savedSteps.set(event.stepKey, { result: event.result, meta: event.meta });
        }
      }
    });

    await workflow1(async (step) => {
      return await step.try(
        () => { throw new Error("original throw"); },
        { error: "TRY_ERROR" as const, key: "try:1" }
      );
    });

    // Verify saved meta has origin:"throw"
    const savedEntry = savedSteps.get("try:1");
    expect(savedEntry?.meta?.origin).toBe("throw");

    // Second run: resume
    const workflow2 = createWorkflow({}, { resumeState: { steps: savedSteps } });

    const result = await workflow2(async (step) => {
      return await step.try(
        () => "should not be called",
        { error: "TRY_ERROR" as const, key: "try:1" }
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

    const workflow1 = createWorkflow({}, {
      onEvent: (event) => {
        if (isStepComplete(event)) {
          savedSteps.set(event.stepKey, { result: event.result, meta: event.meta });
        }
      }
    });

    // A step that throws unexpectedly
    await workflow1(async (step) => {
      return await step(() => {
        throw new Error("uncaught exception");
      }, { key: "uncaught:1" });
    });

    // Verify saved result is an UnexpectedError
    const savedEntry = savedSteps.get("uncaught:1");
    expect(savedEntry).toBeDefined();
    expect(savedEntry?.result.ok).toBe(false);
    const savedResult = savedEntry!.result;
    if (!savedResult.ok) {
      expect(isUnexpectedError(savedResult.error)).toBe(true);
      const unexpectedError = savedResult.error as UnexpectedError;
      expect(unexpectedError.cause.type).toBe("UNCAUGHT_EXCEPTION");
    }

    // Second run: resume - should get the same UnexpectedError, not wrapped in STEP_FAILURE
    const workflow2 = createWorkflow({}, { resumeState: { steps: savedSteps } });

    const result = await workflow2(async (step) => {
      return await step(() => ok("should not execute"), { key: "uncaught:1" });
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Should be UnexpectedError with UNCAUGHT_EXCEPTION, not double-wrapped
      expect(isUnexpectedError(result.error)).toBe(true);
      const unexpectedError = result.error as UnexpectedError;
      expect(unexpectedError.cause.type).toBe("UNCAUGHT_EXCEPTION");
      // NOT { type: "STEP_FAILURE", error: { type: "UNEXPECTED_ERROR", ... } }
    }
  });
});

// =============================================================================
// createWorkflow with typed args
// =============================================================================

describe("createWorkflow with typed args", () => {
  // Helpers for this describe block
  const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
    if (id === "1") return ok({ id, name: "Alice" });
    return err("NOT_FOUND" as const);
  };

  const fetchPosts = async (userId: string): AsyncResult<{ id: number; title: string }[], "FETCH_ERROR"> => {
    return ok([{ id: 1, title: "Hello" }]);
  };

  it("passes args to callback as third parameter", async () => {
    const workflow = createWorkflow({ fetchUser });

    const result = await workflow({ id: "1" }, async (step, deps, args) => {
      expect(args).toEqual({ id: "1" });
      const user = await step(deps.fetchUser(args.id));
      return user;
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Alice");
    }
  });

  it("works without args (backwards compatibility)", async () => {
    const workflow = createWorkflow({ fetchUser });

    const result = await workflow(async (step) => {
      return await step(fetchUser("1"));
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Alice");
    }
  });

  it("passes object args with multiple properties", async () => {
    const workflow = createWorkflow({ fetchUser, fetchPosts });

    const result = await workflow({ userId: "1", includePosts: true }, async (step, deps, args) => {
      const user = await step(deps.fetchUser(args.userId));
      if (args.includePosts) {
        const posts = await step(deps.fetchPosts(user.id));
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

  it("passes primitive args (string)", async () => {
    const workflow = createWorkflow({ fetchUser });

    const result = await workflow("1", async (step, deps, id) => {
      return await step(deps.fetchUser(id));
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Alice");
    }
  });

  it("passes primitive args (number)", async () => {
    const workflow = createWorkflow({ fetchUser });

    const result = await workflow(42, async (_step, _uses, num) => {
      expect(num).toBe(42);
      return num * 2;
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(84);
    }
  });

  it("works with strict mode and args", async () => {
    const workflow = createWorkflow(
      { fetchUser },
      {
        strict: true,
        catchUnexpected: () => "UNEXPECTED" as const,
      }
    );

    const result = await workflow({ id: "1" }, async (step, deps, args) => {
      return await step(deps.fetchUser(args.id));
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Alice");
    }
  });

  it("propagates errors correctly with args", async () => {
    const workflow = createWorkflow({ fetchUser });

    const result = await workflow({ id: "unknown" }, async (step, deps, args) => {
      return await step(deps.fetchUser(args.id));
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("NOT_FOUND");
    }
  });

  it("preserves deps object access with args", async () => {
    const workflow = createWorkflow({ fetchUser, fetchPosts });

    const result = await workflow({ baseId: "1" }, async (step, { fetchUser: getUser, fetchPosts: getPosts }, args) => {
      const user = await step(getUser(args.baseId));
      const posts = await step(getPosts(user.id));
      return { user, posts };
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user.name).toBe("Alice");
      expect(result.value.posts.length).toBe(1);
    }
  });

  it("supports function as args (edge case)", async () => {
    const workflow = createWorkflow({ fetchUser });

    // Pass a factory function as args - this should NOT be confused with the callback
    const idFactory = () => "1";

    const result = await workflow(idFactory, async (step, deps, factory) => {
      // factory should be the idFactory function, not treated as the workflow callback
      expect(typeof factory).toBe("function");
      const id = factory();
      return await step(deps.fetchUser(id));
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Alice");
    }
  });

  it("supports async function as args", async () => {
    const workflow = createWorkflow({ fetchUser });

    // Pass an async function as args
    const asyncIdProvider = async () => "1";

    const result = await workflow(asyncIdProvider, async (step, deps, provider) => {
      const id = await provider();
      return await step(deps.fetchUser(id));
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

      const result = await run(async (step) => {
        return await step(
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

      const result = await run(async (step) => {
        return await step(
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

      const result = await run(async (step) => {
        return await step(
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

      const result = await run(async (step) => {
        return await step(
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

      const result = await run(async (step) => {
        return await step(
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

      await run(async (step) => {
        return await step(
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

      await run(async (step) => {
        return await step(
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

      await run(async (step) => {
        return await step(
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

      await run(async (step) => {
        return await step(
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
        async (step) => {
          return await step(
            () => {
              attempts++;
              if (attempts < 3) return err("TRANSIENT" as const);
              return ok("success");
            },
            {
              name: "test-step",
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
        async (step) => {
          return await step(
            () => err("ALWAYS_FAILS" as const),
            {
              name: "failing-step",
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

      const result = await run(async (step) => {
        return await step.retry(
          () => {
            attempts++;
            if (attempts < 3) return err("TRANSIENT" as const);
            return ok("success");
          },
          {
            name: "retry-step",
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
  });
});

describe("Step Timeout", () => {
  describe("basic timeout behavior", () => {
    it("succeeds when operation completes before timeout", async () => {
      const result = await run(async (step) => {
        return await step(
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
        async (step) => {
          return await step(
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
        async (step) => {
          return await step(
            async () => {
              await new Promise((r) => setTimeout(r, 1000));
              return ok("slow");
            },
            { name: "slow-step", timeout: { ms: 50 } }
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
      const result = await run(async (step) => {
        return await step.withTimeout(
          async () => {
            await new Promise((r) => setTimeout(r, 10));
            return ok("fast");
          },
          { ms: 1000, name: "timeout-step" }
        );
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("fast");
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
      async (step) => {
        return await step(
          async () => {
            attempts++;
            if (attempts < 3) {
              // First two attempts timeout
              await new Promise((r) => setTimeout(r, 1000));
            }
            return ok("success");
          },
          {
            name: "retry-timeout-step",
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
      async (step) => {
        const { user, posts } = await step.parallel({
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

  it("should accept custom name in options", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    await run(
      async (step) => {
        const { user, posts } = await step.parallel(
          {
            user: () => fetchUser("1"),
            posts: () => fetchPosts("1"),
          },
          { name: "Fetch user data" }
        );
        return { user, posts };
      },
      {
        onEvent: (e) => events.push(e),
      }
    );

    const scopeStart = events.find((e) => e.type === "scope_start");
    expect(scopeStart?.type === "scope_start" && scopeStart.name).toBe("Fetch user data");
  });

  it("should fail fast on first error", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    // Use createWorkflow for proper error type inference
    // (run() with catchUnexpected can't infer error types from callback body)
    const workflow = createWorkflow(
      { fetchUser, fetchPosts },
      { onEvent: (e) => events.push(e) }
    );

    const result = await workflow(async (step, { fetchUser, fetchPosts }) => {
      const { user, posts } = await step.parallel({
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

    const workflow = createWorkflow({ slowOp, fastFailOp });

    const result = await workflow(async (step, { slowOp, fastFailOp }) => {
      // slowOp is first but takes 100ms, fastFailOp is second but fails immediately
      const { slow, fast } = await step.parallel({
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
    const result = await run(async (step) => {
      const { user, posts, comments } = await step.parallel({
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
    const result = await run(async (step) => {
      const data = await step.parallel({});
      return data;
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  it("should work with createWorkflow", async () => {
    const workflow = createWorkflow({ fetchUser, fetchPosts });

    const result = await workflow(async (step, deps) => {
      const { user, posts } = await step.parallel({
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

