/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unused-expressions */
/**
 * Tests for core.ts - Result primitives and transformations
 */
import { describe, it, expect, vi } from "vitest";
import {
  all,
  allAsync,
  allSettled,
  allSettledAsync,
  andThen,
  any,
  anyAsync,
  AsyncResult,
  err,
  ErrorOf,
  Errors,
  ExtractError,
  ExtractValue,
  from,
  fromNullable,
  fromPromise,
  isErr,
  isOk,
  isPromiseRejectedError,
  isUnexpectedError,
  PROMISE_REJECTED,
  map,
  mapError,
  mapErrorTry,
  mapTry,
  match,
  matchError,
  ok,
  partition,
  PromiseRejectedError,
  Result,
  tap,
  tapError,
  tryAsync,
  UnexpectedError,
  UNEXPECTED_ERROR,
  unwrap,
  UnwrapError,
  unwrapOr,
  unwrapOrElse,
  runOrThrow,
  runOrThrowAsync,
  runOrNull,
  runOrUndefined,
  bimap,
  orElse,
  orElseAsync,
  recover,
  recoverAsync,
  zip,
  zipAsync,
  RunStep,
} from ".";
import { createWorkflow, run } from "../workflow-entry";

describe("Result Core", () => {
  describe("ok()", () => {
    it("creates an ok result with value", () => {
      const result = ok(42);
      expect(result).toEqual({ ok: true, value: 42 });
    });

    it("has correct type - value is accessible", () => {
      const result = ok("hello");
      // Type: Result<string, never>
      if (result.ok) {
        const value: string = result.value;
        expect(value).toBe("hello");
      }
    });

    it("error type is never for ok results", () => {
      const result = ok(42);
      // @ts-expect-error - ok() returns Result<T, never>, error doesn't exist on ok branch
      result.error;
    });
  });

  describe("err()", () => {
    it("creates an error result", () => {
      const result = err("something went wrong");
      expect(result).toEqual({ ok: false, error: "something went wrong" });
    });

    it("preserves cause when provided", () => {
      const cause = new Error("original");
      const result = err("wrapped", { cause });
      expect(result).toEqual({
        ok: false,
        error: "wrapped",
        cause: cause,
      });
    });

    it("has correct type - error is accessible", () => {
      const result = err("NOT_FOUND" as const);
      if (!result.ok) {
        const error: "NOT_FOUND" = result.error;
        expect(error).toBe("NOT_FOUND");
      }
    });

    it("value type is never for err results", () => {
      const result = err("oops");
      // @ts-expect-error - err() returns Result<never, E>, value doesn't exist on err branch
      result.value;
    });
  });

  describe("isOk() / isErr() type guards", () => {
    it("narrows type correctly for ok", () => {
      const result: Result<number, string> = ok(42);

      if (isOk(result)) {
        // Type narrowed: we can access .value
        const num: number = result.value;
        expect(num).toBe(42);

        // @ts-expect-error - error doesn't exist on narrowed ok type
        result.error;
      }
    });

    it("narrows type correctly for err", () => {
      const result: Result<number, string> = err("failed");

      if (isErr(result)) {
        // Type narrowed: we can access .error
        const msg: string = result.error;
        expect(msg).toBe("failed");

        // @ts-expect-error - value doesn't exist on narrowed err type
        result.value;
      }
    });
  });

  describe("isPromiseRejectedError() type guard", () => {
    it("correctly identifies PromiseRejectedError", () => {
      const error: PromiseRejectedError = {
        type: "PROMISE_REJECTED",
        cause: new Error("test"),
      };
      expect(isPromiseRejectedError(error)).toBe(true);
    });

    it("works with PROMISE_REJECTED constant", () => {
      const error: PromiseRejectedError = {
        type: PROMISE_REJECTED,
        cause: new Error("test"),
      };
      expect(isPromiseRejectedError(error)).toBe(true);
    });

    it("returns false for other error types", () => {
      expect(isPromiseRejectedError({ type: "OTHER_ERROR" })).toBe(false);
      expect(isPromiseRejectedError({ type: "UNEXPECTED_ERROR", cause: {} })).toBe(
        false
      );
    });

    it("returns false for null, undefined, and primitives", () => {
      expect(isPromiseRejectedError(null)).toBe(false);
      expect(isPromiseRejectedError(undefined)).toBe(false);
      expect(isPromiseRejectedError("PROMISE_REJECTED")).toBe(false);
      expect(isPromiseRejectedError(123)).toBe(false);
    });

    it("narrows type in conditional branches", () => {
      type DomainError = "FETCH_FAILED";
      const error: PromiseRejectedError | DomainError = {
        type: "PROMISE_REJECTED",
        cause: new Error(),
      };

      if (isPromiseRejectedError(error)) {
        // TypeScript narrows to PromiseRejectedError
        const _cause: unknown = error.cause;
        expect(_cause).toBeInstanceOf(Error);
      }
    });
  });
});

describe("Unwrapping", () => {
  describe("unwrap()", () => {
    it("returns value for ok result", () => {
      const result = ok(42);
      expect(unwrap(result)).toBe(42);
    });

    it("throws UnwrapError for err (preserves error + cause)", () => {
      const cause = new Error("original");
      const result = err("FAILED", { cause });

      try {
        unwrap(result);
        expect.fail("should have thrown");
      } catch (error) {
        // Throws proper Error subclass for stack traces + logging
        expect(error).toBeInstanceOf(UnwrapError);
        expect(error).toBeInstanceOf(Error);
        expect((error as UnwrapError).error).toBe("FAILED");
        expect((error as UnwrapError).cause).toBe(cause);
        expect((error as UnwrapError).name).toBe("UnwrapError");
      }
    });
  });

  describe("unwrapOr()", () => {
    it("returns value for ok result", () => {
      const result: Result<number, string> = ok(42);
      expect(unwrapOr(result, 0)).toBe(42);
    });

    it("returns default for err result", () => {
      const result: Result<number, string> = err("failed");
      expect(unwrapOr(result, 0)).toBe(0);
    });

    it("type of default must match value type", () => {
      const result: Result<number, string> = ok(42);
      // @ts-expect-error - default must be number, not string
      unwrapOr(result, "not a number");
    });
  });

  describe("unwrapOrElse()", () => {
    it("returns value for ok result", () => {
      const result: Result<number, string> = ok(42);
      expect(unwrapOrElse(result, () => 0)).toBe(42);
    });

    it("calls fallback with error for err result", () => {
      const result: Result<number, string> = err("failed");
      const fallback = unwrapOrElse(result, (error) => {
        expect(error).toBe("failed");
        return -1;
      });
      expect(fallback).toBe(-1);
    });

    it("fallback receives correct error type", () => {
      const result: Result<number, { code: number }> = err({ code: 404 });
      unwrapOrElse(result, (error) => {
        // error is typed as { code: number }
        const code: number = error.code;
        return code;
      });
    });
  });

  describe("runOrThrow()", () => {
    it("returns value for ok result", () => {
      const result = ok(42);
      expect(runOrThrow(result)).toBe(42);
    });

    it("throws UnwrapError for err (same as unwrap)", () => {
      const result = err("FAILED");
      expect(() => runOrThrow(result)).toThrow(UnwrapError);
      try {
        runOrThrow(result);
      } catch (e) {
        expect((e as UnwrapError).error).toBe("FAILED");
      }
    });
  });

  describe("runOrThrowAsync()", () => {
    it("resolves with value when Promise resolves to ok", async () => {
      const p = Promise.resolve(ok(42));
      await expect(runOrThrowAsync(p)).resolves.toBe(42);
    });

    it("rejects with UnwrapError when Promise resolves to err", async () => {
      const p = Promise.resolve(err("ASYNC_FAILED"));
      await expect(runOrThrowAsync(p)).rejects.toThrow(UnwrapError);
      await expect(runOrThrowAsync(p)).rejects.toMatchObject({
        error: "ASYNC_FAILED",
        name: "UnwrapError",
      });
    });
  });

  describe("runOrNull()", () => {
    it("returns value for ok result", () => {
      const result = ok(42);
      expect(runOrNull(result)).toBe(42);
    });

    it("returns null for err result", () => {
      const result = err("failed");
      expect(runOrNull(result)).toBe(null);
    });
  });

  describe("runOrUndefined()", () => {
    it("returns value for ok result", () => {
      const result = ok(42);
      expect(runOrUndefined(result)).toBe(42);
    });

    it("returns undefined for err result", () => {
      const result = err("failed");
      expect(runOrUndefined(result)).toBe(undefined);
    });
  });
});

describe("from() and fromPromise()", () => {
  describe("from()", () => {
    it("wraps successful sync function", () => {
      const result = from(() => 42);
      expect(result).toEqual({ ok: true, value: 42 });
    });

    it("catches thrown errors", () => {
      const result = from(() => {
        throw new Error("boom");
      });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBeInstanceOf(Error);
        // No cause when not mapping - error IS the cause
        expect(result.cause).toBeUndefined();
      }
    });

    it("maps errors with custom mapper", () => {
      const result = from(
        () => {
          throw new Error("boom");
        },
        () => "CUSTOM_ERROR" as const
      );

      if (isErr(result)) {
        // Error is mapped to our custom type
        const error: "CUSTOM_ERROR" = result.error;
        expect(error).toBe("CUSTOM_ERROR");
        // Original cause is preserved
        expect(result.cause).toBeInstanceOf(Error);
      }
    });

    it("defaults to unknown error type without mapper (type safety)", () => {
      const result = from(() => {
        throw new Error("boom");
      });

      // Without mapper, error type is `unknown` - NOT some narrow type
      if (isErr(result)) {
        // This forces you to narrow the type before using it
        // @ts-expect-error - error is unknown, can't assign to string
        const _narrow: string = result.error;

        // You must check the type first
        if (result.error instanceof Error) {
          expect(result.error.message).toBe("boom");
        }
      }
    });

    it("prevents type lies - can't specify narrow type without mapper", () => {
      // OLD BEHAVIOR (unsafe): from<number, 'NOT_FOUND'>(() => { throw ... })
      // would claim error is 'NOT_FOUND' but it's actually an Error

      // NEW BEHAVIOR (safe): Without mapper, error is always unknown
      const result = from(() => {
        throw new Error("real error");
      });

      // The type system correctly reports this as Result<never, unknown>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type ErrorType = typeof result extends Result<any, infer E> ? E : never;
      const _check: unknown extends ErrorType ? true : false = true;
    });
  });

  describe("fromPromise()", () => {
    it("wraps successful promise", async () => {
      const result = await fromPromise(Promise.resolve(42));
      expect(result).toEqual({ ok: true, value: 42 });
    });

    it("catches rejected promises", async () => {
      const result = await fromPromise(Promise.reject(new Error("async boom")));
      expect(isErr(result)).toBe(true);
    });

    it("maps errors with custom mapper", async () => {
      const result = await fromPromise(
        Promise.reject(new Error("network")),
        () => "NETWORK_ERROR" as const
      );

      if (isErr(result)) {
        const error: "NETWORK_ERROR" = result.error;
        expect(error).toBe("NETWORK_ERROR");
      }
    });

    it("returns AsyncResult type", () => {
      const result = fromPromise(Promise.resolve(42));
      // AsyncResult<number, unknown> = Promise<Result<number, unknown>>
      type Expected = AsyncResult<number, unknown>;
      const _typeCheck: Expected = result;
    });

    it("defaults to unknown error type without mapper (type safety)", async () => {
      const result = await fromPromise(Promise.reject(new Error("async boom")));

      if (isErr(result)) {
        // @ts-expect-error - error is unknown, can't assign to string
        const _narrow: string = result.error;

        // Must narrow first
        if (result.error instanceof Error) {
          expect(result.error.message).toBe("async boom");
        }
      }
    });
  });
});

describe("map() and mapError()", () => {
  describe("map()", () => {
    it("transforms ok value", () => {
      const result = ok(42);
      const mapped = map(result, (n) => n * 2);
      expect(mapped).toEqual({ ok: true, value: 84 });
    });

    it("passes through err unchanged", () => {
      const result: Result<number, string> = err("failed");
      const mapped = map(result, (n: number) => n * 2);
      expect(mapped).toEqual({ ok: false, error: "failed" });
    });

    it("transform receives correct type", () => {
      const result: Result<{ name: string }, string> = ok({ name: "Alice" });
      map(result, (user) => {
        // user is typed as { name: string }
        const name: string = user.name;
        return name.toUpperCase();
      });
    });

    it("output type reflects transformation", () => {
      const result: Result<number, string> = ok(42);
      const mapped = map(result, String);

      if (isOk(mapped)) {
        // Value is now string
        const str: string = mapped.value;
        expect(str).toBe("42");

        // @ts-expect-error - value is string, not number
        const _num: number = mapped.value;
      }
    });
  });

  describe("mapError()", () => {
    it("transforms error", () => {
      const result: Result<number, string> = err("not_found");
      const mapped = mapError(result, (e) => ({ code: e.toUpperCase() }));
      expect(mapped).toEqual({ ok: false, error: { code: "NOT_FOUND" } });
    });

    it("passes through ok unchanged", () => {
      const result: Result<number, string> = ok(42);
      const mapped = mapError(result, (e) => ({ code: e }));
      expect(mapped).toEqual({ ok: true, value: 42 });
    });

    it("preserves cause when mapping error", () => {
      const cause = new Error("original");
      const result: Result<number, string> = err("failed", { cause });
      const mapped = mapError(result, (e) => `wrapped: ${e}`);

      if (isErr(mapped)) {
        expect(mapped.cause).toBe(cause);
      }
    });

    it("output error type reflects transformation", () => {
      const result: Result<number, string> = err("oops");
      const mapped = mapError(result, () => 404);

      if (isErr(mapped)) {
        // Error is now number
        const code: number = mapped.error;
        expect(code).toBe(404);

        // @ts-expect-error - error is number, not string
        const _str: string = mapped.error;
      }
    });
  });
});

describe("match() - exhaustive pattern matching", () => {
  it("calls ok handler for ok result", () => {
    const result: Result<number, string> = ok(42);
    const message = match(result, {
      ok: (value) => `Got: ${value}`,
      err: (error) => `Error: ${error}`,
    });

    expect(message).toBe("Got: 42");
  });

  it("calls err handler for err result", () => {
    const result: Result<number, string> = err("NOT_FOUND");
    const message = match(result, {
      ok: (value) => `Got: ${value}`,
      err: (error) => `Error: ${error}`,
    });

    expect(message).toBe("Error: NOT_FOUND");
  });

  it("passes cause to err handler", () => {
    const cause = new Error("original");
    const result: Result<number, string> = err("FAILED", { cause });

    const receivedCause = match(result, {
      ok: () => null,
      err: (_error, cause) => cause,
    });

    expect(receivedCause).toBe(cause);
  });

  it("infers return type from handlers", () => {
    const result: Result<{ name: string }, "NOT_FOUND"> = ok({ name: "Alice" });

    // Return type is number (both branches return number)
    const statusCode: number = match(result, {
      ok: () => 200,
      err: () => 404,
    });

    expect(statusCode).toBe(200);
  });

  it("works with exhaustive error handling", () => {
    type AppError = "NOT_FOUND" | "UNAUTHORIZED" | "SERVER_ERROR";
    const result: Result<string, AppError> = err("UNAUTHORIZED");

    const httpStatus = match(result, {
      ok: () => 200,
      err: (error) => {
        switch (error) {
          case "NOT_FOUND": {
            return 404;
          }
          case "UNAUTHORIZED": {
            return 401;
          }
          case "SERVER_ERROR": {
            return 500;
          }
        }
      },
    });

    expect(httpStatus).toBe(401);
  });
});

describe("all() - like Promise.all (sync)", () => {
  it("combines multiple ok results into tuple", () => {
    const result = all([ok(1), ok("two"), ok(true)] );

    expect(result).toEqual({ ok: true, value: [1, "two", true] });
  });

  it("returns first error if any fails", () => {
    const result = all([
      ok(1),
      err("SECOND_FAILED"),
      ok(3),
      err("FOURTH_FAILED"),
    ]);

    expect(result).toEqual({ ok: false, error: "SECOND_FAILED" });
  });

  it("preserves tuple types", () => {
    const result = all([ok(42), ok("hello"), ok({ active: true })] );

    if (isOk(result)) {
      const [num, str, obj] = result.value;

      // Types are preserved
      const _n: number = num;
      const _s: string = str;
      const _b: boolean = obj.active;

      // @ts-expect-error - first element is number, not string
      const _wrong: string = num;
    }
  });

  it("error type is union of all error types", () => {
    const result = all([
      ok(1) as Result<number, "ERROR_A">,
      ok(2) as Result<number, "ERROR_B">,
    ]);

    if (isErr(result)) {
      // Error type is "ERROR_A" | "ERROR_B"
      const error: "ERROR_A" | "ERROR_B" = result.error;
    }
  });
});

describe("any() - like Promise.any (sync)", () => {
  it("returns first ok result", () => {
    const result = any([err("first failed"), ok(42), ok(100)]);

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("returns error if all fail", () => {
    const result = any([err("A"), err("B"), err("C")]);

    expect(isErr(result)).toBe(true);
  });

  it("preserves cause when all fail", () => {
    const originalCause = new Error("root cause");
    const result = any([
      err("FIRST_ERROR", { cause: originalCause }),
      err("SECOND_ERROR"),
      err("THIRD_ERROR"),
    ]);

    if (isErr(result)) {
      expect(result.error).toBe("FIRST_ERROR");
      // Cause is preserved from original Result
      expect(result.cause).toBe(originalCause);
    }
  });

  it("returns err on empty array (no exceptions)", () => {
    const result = any([]);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toEqual({
        type: "EMPTY_INPUT",
        message: "any() requires at least one Result",
      });
    }
  });

  it("value type is union of all value types", () => {
    const result = any([
      ok(42) as Result<number, string>,
      ok("hello") as Result<string, string>,
    ]);

    if (isOk(result)) {
      // Value type is number | string
      const value: number | string = result.value;
    }
  });
});

describe("Type utilities", () => {
  it("ExtractValue extracts value type", () => {
    type TestResult = Result<{ id: number; name: string }, Error>;
    type Value = ExtractValue<TestResult>;

    // Value should be { id: number; name: string }
    const _check: Value = { id: 1, name: "test" };

    // Verify the type is correct by checking assignability
    const value: Value = { id: 42, name: "Alice" };
    expect(value.id).toBe(42);
    expect(value.name).toBe("Alice");
  });

  it("ExtractError extracts error type", () => {
    type TestResult = Result<number, { code: string; message: string }>;
    type ErrorType = ExtractError<TestResult>;

    // ErrorType should be { code: string; message: string }
    const _check: ErrorType = { code: "ERR", message: "failed" };

    // Verify the type is correct by checking assignability
    const error: ErrorType = {
      code: "NOT_FOUND",
      message: "Resource not found",
    };
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Resource not found");
  });

  it("ExtractValue returns never for non-Result types", () => {
    type NotAResult = ExtractValue<string>;
    // NotAResult is `never`

    // @ts-expect-error - can't assign string to never
    const _bad: NotAResult = "hello";
  });

  it("ExtractError returns never for non-Result types", () => {
    type NotAResult = ExtractError<number>;
    // NotAResult is `never`

    // @ts-expect-error - can't assign number to never
    const _bad: NotAResult = 42;
  });
});

describe("Error definition patterns", () => {
  describe("string literal unions (type-only)", () => {
    type AppError = "NOT_FOUND" | "VALIDATION_ERROR" | "NETWORK_ERROR";

    it("works with literal union types", async () => {
      const findUser = (id: string): Result<{ id: string }, AppError> => {
        if (id === "unknown") return err("NOT_FOUND");
        return ok({ id });
      };

      const result = findUser("unknown");
      if (isErr(result)) {
        // Error is typed as AppError
        const error: AppError = result.error;
        expect(error).toBe("NOT_FOUND");
      }
    });
  });

  describe("const object pattern (runtime + type)", () => {
    // This gives you BOTH runtime values AND types
    const AppError = {
      NOT_FOUND: "NOT_FOUND",
      VALIDATION_ERROR: "VALIDATION_ERROR",
      NETWORK_ERROR: "NETWORK_ERROR",
    } as const;

    // Extract the type from the const
    type AppError = (typeof AppError)[keyof typeof AppError];

    it("works with const objects", async () => {
      const findUser = (id: string): Result<{ id: string }, AppError> => {
        if (id === "unknown") return err(AppError.NOT_FOUND);
        return ok({ id });
      };

      const result = findUser("unknown");
      if (isErr(result)) {
        // Can compare against the const at runtime
        expect(result.error).toBe(AppError.NOT_FOUND);

        // Type is still the union
        const error: AppError = result.error;
      }
    });

    it("enables exhaustive switch statements", () => {
      const result: Result<number, AppError> = err(AppError.NOT_FOUND);

      if (isErr(result)) {
        // Exhaustive handling with const values
        switch (result.error) {
          case AppError.NOT_FOUND: {
            expect(true).toBe(true);
            break;
          }
          case AppError.VALIDATION_ERROR: {
            expect.fail("wrong branch");
            break;
          }
          case AppError.NETWORK_ERROR: {
            expect.fail("wrong branch");
            break;
          }
          default: {
            // TypeScript knows this is unreachable
            const _exhaustive: never = result.error;
            break;
          }
        }
      }
    });
  });

  describe("class-based errors (rich error objects)", () => {
    // Base error class
    class AppError {
      constructor(
        public readonly code: string,
        public readonly message: string
      ) {}
    }

    class NotFoundError extends AppError {
      constructor(resource: string) {
        super("NOT_FOUND", `${resource} not found`);
      }
    }

    class ValidationError extends AppError {
      constructor(public readonly field: string, message: string) {
        super("VALIDATION", message);
      }
    }

    it("works with error classes", () => {
      const findUser = (id: string): Result<{ id: string }, AppError> => {
        if (id === "unknown") return err(new NotFoundError("User"));
        if (id === "") return err(new ValidationError("id", "ID required"));
        return ok({ id });
      };

      const result = findUser("unknown");
      if (isErr(result)) {
        expect(result.error).toBeInstanceOf(NotFoundError);
        expect(result.error.code).toBe("NOT_FOUND");
        expect(result.error.message).toBe("User not found");
      }
    });

    it("enables instanceof checks for specific handling", () => {
      const result: Result<number, AppError> = err(
        new ValidationError("email", "Invalid email format")
      );

      if (isErr(result) && result.error instanceof ValidationError) {
          // Type narrowed - can access .field
          expect(result.error.field).toBe("email");
        }
    });
  });

  describe("discriminated union errors (tagged objects)", () => {
    // Each error type has a discriminant field
    type AppError =
      | { type: "NOT_FOUND"; resource: string }
      | { type: "VALIDATION"; field: string; message: string }
      | { type: "NETWORK"; statusCode: number };

    it("works with discriminated unions", () => {
      const findUser = (id: string): Result<{ id: string }, AppError> => {
        if (id === "unknown") {
          return err({ type: "NOT_FOUND", resource: "User" });
        }
        return ok({ id });
      };

      const result = findUser("unknown");
      if (isErr(result)) {
        expect(result.error.type).toBe("NOT_FOUND");
        if (result.error.type === "NOT_FOUND") {
          // Type narrowed
          expect(result.error.resource).toBe("User");
        }
      }
    });

    it("enables exhaustive switch on error.type", () => {
      const result: Result<number, AppError> = err({
        type: "NETWORK",
        statusCode: 500,
      });

      if (isErr(result)) {
        switch (result.error.type) {
          case "NOT_FOUND": {
            expect.fail("wrong branch");
            break;
          }
          case "VALIDATION": {
            expect.fail("wrong branch");
            break;
          }
          case "NETWORK": {
            // Type narrowed - can access .statusCode
            expect(result.error.statusCode).toBe(500);
            break;
          }
          default: {
            const _exhaustive: never = result.error;
            break;
          }
        }
      }
    });
  });
});

describe("ErrorOf and Errors utilities - auto-extract error types", () => {
  // These functions have explicit error types
  const fetchUser = async (
    id: string
  ): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
    if (id === "unknown") return err("NOT_FOUND");
    return ok({ id, name: "Alice" });
  };

  const fetchPosts = async (
    userId: string
  ): AsyncResult<string[], "FETCH_ERROR"> => {
    if (userId === "bad") return err("FETCH_ERROR");
    return ok([`Post by ${userId}`]);
  };

  const validateInput = (input: string): Result<string, "VALIDATION_ERROR"> => {
    if (input.length === 0) return err("VALIDATION_ERROR");
    return ok(input);
  };

  it("ErrorOf extracts error type from a single function", () => {
    // Auto-extract error type from function
    type UserError = ErrorOf<typeof fetchUser>;
    type PostError = ErrorOf<typeof fetchPosts>;
    type ValidationError = ErrorOf<typeof validateInput>;

    // Type checks - these compile only if types are correct
    const _userErr: UserError = "NOT_FOUND";
    const _postErr: PostError = "FETCH_ERROR";
    const _valErr: ValidationError = "VALIDATION_ERROR";

    expect(_userErr).toBe("NOT_FOUND");
  });

  it("Errors combines error types from multiple functions using tuple", () => {
    // Use tuple syntax - supports unlimited functions!
    type AppError = Errors<
      [typeof fetchUser, typeof fetchPosts, typeof validateInput]
    >;

    // AppError is 'NOT_FOUND' | 'FETCH_ERROR' | 'VALIDATION_ERROR'
    const errors: AppError[] = ["NOT_FOUND", "FETCH_ERROR", "VALIDATION_ERROR"];
    expect(errors).toHaveLength(3);
  });

  it("works with run() (typed is the default) for clean DX", async () => {
    // Step 1: Extract error types from your functions (tuple syntax)
    type AppError = Errors<[typeof fetchUser, typeof fetchPosts]> | "UNEXPECTED";

    // Step 2: Use with run.strict() for closed error union
    const result = await run.strict<
      { user: { id: string; name: string }; posts: string[] },
      AppError
    >(
      async ({ step }) => {
        const user = await step('fetchUser', () => fetchUser("123"));
        const posts = await step('fetchPosts', () => fetchPosts(user.id));
        return { user, posts };
      },
      { catchUnexpected: () => "UNEXPECTED"  }
    );

    expect(result).toEqual({
      ok: true,
      value: {
        user: { id: "123", name: "Alice" },
        posts: ["Post by 123"],
      },
    });

    // Error type is exactly our closed union
    if (isErr(result)) {
      const error: AppError = result.error;
    }
  });

  it("early exits preserve the extracted error type", async () => {
    type AppError = Errors<[typeof fetchUser, typeof fetchPosts]> | "UNEXPECTED";

    const result = await run.strict<
      { user: { id: string; name: string }; posts: string[] },
      AppError
    >(
      async ({ step }) => {
        const user = await step('fetchUser', () => fetchUser("unknown")); // Will fail
        const posts = await step('fetchPosts', () => fetchPosts(user.id));
        return { user, posts };
      },
      { catchUnexpected: () => "UNEXPECTED"  }
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      // Error type is exactly our closed union
      const error: AppError = result.error;
      expect(error).toBe("NOT_FOUND");
    }
  });

  it("combines three different error types cleanly", async () => {
    type AppError =
      | Errors<[typeof validateInput, typeof fetchUser, typeof fetchPosts]>
      | "UNEXPECTED";
    // AppError = "VALIDATION_ERROR" | "NOT_FOUND" | "FETCH_ERROR" | "UNEXPECTED"

    const result = await run.strict<
      { user: { id: string; name: string } },
      AppError
    >(
      async ({ step }) => {
        const input = await step('validateInput', () => validateInput("hello"));
        const user = await step('fetchUser', () => fetchUser(input));
        return { user };
      },
      { catchUnexpected: () => "UNEXPECTED"  }
    );

    expect(isOk(result)).toBe(true);

    // Error type is exactly our closed union
    if (isErr(result)) {
      const error: AppError = result.error;
    }
  });

  it("Errors tuple supports more than 5 functions", () => {
    // Define 7 different functions with unique error types
    const fn1 = (): Result<number, "E1"> => ok(1);
    const fn2 = (): Result<number, "E2"> => ok(2);
    const fn3 = (): Result<number, "E3"> => ok(3);
    const fn4 = (): Result<number, "E4"> => ok(4);
    const fn5 = (): Result<number, "E5"> => ok(5);
    const fn6 = (): Result<number, "E6"> => ok(6);
    const fn7 = (): Result<number, "E7"> => ok(7);

    // Tuple syntax works with unlimited functions!
    type AllErrors = Errors<
      [
        typeof fn1,
        typeof fn2,
        typeof fn3,
        typeof fn4,
        typeof fn5,
        typeof fn6,
        typeof fn7
      ]
    >;

    // All 7 error types are present
    const errors: AllErrors[] = ["E1", "E2", "E3", "E4", "E5", "E6", "E7"];
    expect(errors).toHaveLength(7);

    // @ts-expect-error - E8 is not part of the union
    const invalidError: AllErrors = "E8";
  });

  it("step.try() REQUIRES onError - compile-time check", () => {
    // This is a compile-time check only - we use type assertions to prove the interface
    // Define a type test helper (never actually called)
    type TypeTest<_T> = true;

    // Result-returning steps work - RunStep<unknown> accepts any error types
    type ResultStepWorks = TypeTest<
      RunStep<unknown> extends {
        <T, E>(
          operation: () => Result<T, E> | AsyncResult<T, E>,
          stepName?: string
        ): Promise<T>;
      }
        ? true
        : false
    >;
    const _resultStepWorks: ResultStepWorks = true;

    // step.try() REQUIRES either { error } or { onError } in options
    type StepTryOptions = Parameters<RunStep<unknown>["try"]>[2];

    // Prove options must have error or onError (can't be just { stepName })
    type HasErrorOrOnError = StepTryOptions extends
      | { error: unknown }
      | { onError: (cause: unknown) => unknown }
      ? true
      : false;
    const _hasErrorOrOnError: HasErrorOrOnError = true;

    // Valid options - have error mapping:
    const _validOptsError: StepTryOptions = {
      error: "NOT_FOUND" ,
      key: "load",
    };
    const _validOptsOnError: StepTryOptions = {
      onError: () => "NOT_FOUND" ,
      key: "load",
    };

    expect(_resultStepWorks).toBe(true);
    expect(_hasErrorOrOnError).toBe(true);
  });
});

describe("Real-world usage patterns", () => {
  // Simulated API functions
  const fetchUser = async (
    id: string
  ): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
    if (id === "unknown") return err("NOT_FOUND");
    return ok({ id, name: "Alice" });
  };

  const fetchPosts = async (
    userId: string
  ): AsyncResult<string[], "FETCH_ERROR"> => {
    return ok([`Post by ${userId}`]);
  };

  it("composes multiple async operations cleanly (typed by default)", async () => {
    type AppError = "NOT_FOUND" | "FETCH_ERROR" | "UNEXPECTED";

    const result = await run.strict<
      { user: { id: string; name: string }; posts: string[] },
      AppError
    >(
      async ({ step }) => {
        const user = await step('fetchUser', () => fetchUser("123"));
        const posts = await step('fetchPosts', () => fetchPosts(user.id));
        return { user, posts };
      },
      { catchUnexpected: () => "UNEXPECTED"  }
    );

    expect(result).toEqual({
      ok: true,
      value: {
        user: { id: "123", name: "Alice" },
        posts: ["Post by 123"],
      },
    });
  });

  it("early exits preserve error type", async () => {
    type AppError = "NOT_FOUND" | "FETCH_ERROR" | "UNEXPECTED";

    const result = await run.strict<
      { user: { id: string; name: string }; posts: string[] },
      AppError
    >(
      async ({ step }) => {
        const user = await step('fetchUser', () => fetchUser("unknown")); // Will fail
        const posts = await step('fetchPosts', () => fetchPosts(user.id));
        return { user, posts };
      },
      { catchUnexpected: () => "UNEXPECTED"  }
    );

    if (isErr(result)) {
      // Error type is exactly our closed union
      const error: AppError = result.error;
      expect(error).toBe("NOT_FOUND");
    }
  });

  it("works with standard if/else pattern", () => {
    const result: Result<number, string> = ok(42);

    // Standard JS pattern - no special methods needed
    if (result.ok) {
      expect(result.value).toBe(42);
    } else {
      expect.fail("should be ok");
    }
  });

  it("integrates with existing try/catch code", async () => {
    const legacyApi = async () => {
      throw new Error("legacy error");
    };

    const result = await fromPromise(legacyApi(), (cause) =>
      cause instanceof Error ? cause.message : "UNKNOWN"
    );

    if (isErr(result)) {
      expect(result.error).toBe("legacy error");
    }
  });
});

// ======================= New Utility Tests =======================

describe("tryAsync() - safer async wrapping", () => {
  it("returns ok for successful async function", async () => {
    const result = await tryAsync(async () => {
      return 42;
    });

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("catches async errors with default unknown type", async () => {
    const result = await tryAsync(async () => {
      throw new Error("async failure");
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toBe("async failure");
    }
  });

  it("maps errors with custom mapper", async () => {
    const result = await tryAsync(
      async () => {
        throw new Error("async failure");
      },
      (cause) => ({ code: "ASYNC_ERROR", message: String(cause) })
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe("ASYNC_ERROR");
    }
  });

  it("catches sync throws during promise creation (better than fromPromise)", async () => {
    // This is the key difference from fromPromise - it catches sync throws
    const badAsyncFn = (): Promise<number> => {
      throw new Error("sync throw before promise");
    };

    const result = await tryAsync(badAsyncFn);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect((result.error as Error).message).toBe("sync throw before promise");
    }
  });

  it("preserves cause", async () => {
    const originalError = new Error("original");
    const result = await tryAsync(
      async () => {
        throw originalError;
      },
      (cause) => "MAPPED_ERROR"
    );

    if (isErr(result)) {
      expect(result.error).toBe("MAPPED_ERROR");
      expect(result.cause).toBe(originalError);
    }
  });
});

describe("mapTry() - transform that might throw", () => {
  it("transforms ok value successfully", () => {
    const result = mapTry(
      ok(5),
      (n) => n * 2,
      (cause) => "TRANSFORM_ERROR"
    );

    expect(result).toEqual({ ok: true, value: 10 });
  });

  it("passes through err without transformation", () => {
    const result = mapTry(
      err("ORIGINAL_ERROR") as Result<number, string>,
      (n) => n * 2,
      (cause) => "TRANSFORM_ERROR"
    );

    expect(result).toEqual({ ok: false, error: "ORIGINAL_ERROR" });
  });

  it("catches throwing transform and maps error", () => {
    const result = mapTry(
      ok(5),
      (n) => {
        throw new Error("transform failed");
      },
      (cause) => "CAUGHT_ERROR"
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBe("CAUGHT_ERROR");
      expect(result.cause).toBeInstanceOf(Error);
    }
  });

  it("combines error types in union", () => {
    const result = mapTry(
      ok(5) as Result<number, "ORIGINAL">,
      (n) => {
        if (n > 10) throw new Error("too big");
        return n * 2;
      },
      (cause) => "TRANSFORM_ERROR" as const
    );

    // Type should be Result<number, "ORIGINAL" | "TRANSFORM_ERROR">
    if (isErr(result)) {
      const error: "ORIGINAL" | "TRANSFORM_ERROR" = result.error;
    }
  });
});

describe("mapErrorTry() - error transform that might throw", () => {
  it("passes through ok without transformation", () => {
    const result = mapErrorTry(
      ok(42),
      (e) => "TRANSFORMED",
      (cause) => "CAUGHT"
    );

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("transforms error successfully", () => {
    const result = mapErrorTry(
      err("ORIGINAL") as Result<number, string>,
      (e) => ({ code: e, severity: "high" }),
      (cause) => ({ code: "UNKNOWN", severity: "critical" })
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "ORIGINAL", severity: "high" },
    });
  });

  it("catches throwing error transform", () => {
    const result = mapErrorTry(
      err("ORIGINAL") as Result<number, string>,
      (e) => {
        throw new Error("transform failed");
      },
      (cause) => "CAUGHT_ERROR"
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBe("CAUGHT_ERROR");
    }
  });
});

describe("allAsync() - mixed sync/async results", () => {
  it("combines sync and async results", async () => {
    const asyncOk = async () => ok(42);

    const result = await allAsync([ok(1), asyncOk(), ok("three")] );

    expect(result).toEqual({ ok: true, value: [1, 42, "three"] });
  });

  it("returns first error from mixed inputs", async () => {
    const asyncErr = async () => err("ASYNC_ERROR");

    const result = await allAsync([ok(1), asyncErr(), ok(3)]);

    expect(result).toEqual({ ok: false, error: "ASYNC_ERROR" });
  });

  it("handles all async results", async () => {
    const fetch1 = async () => ok(1);
    const fetch2 = async () => ok(2);
    const fetch3 = async () => ok(3);

    const result = await allAsync([fetch1(), fetch2(), fetch3()]);

    expect(result).toEqual({ ok: true, value: [1, 2, 3] });
  });

  it("preserves tuple types with ", async () => {
    const result = await allAsync([
      ok(42),
      Promise.resolve(ok("hello")),
      ok(true),
    ] );

    if (isOk(result)) {
      const [num, str, bool] = result.value;
      const _n: number = num;
      const _s: string = str;
      const _b: boolean = bool;
    }
  });

  it("returns PromiseRejectedError when a promise rejects", async () => {
    const rejectingPromise = Promise.reject(new Error("Network failure"));

    const result = await allAsync([
      ok(1),
      rejectingPromise as Promise<Result<number, string>>,
      ok(3),
    ]);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toEqual({
        type: "PROMISE_REJECTED",
        cause: expect.any(Error),
      });
    }
  });

  it("short-circuits on first promise rejection", async () => {
    let secondCalled = false;
    const firstReject = Promise.reject(new Error("first"));
    const secondPromise = new Promise<Result<number, string>>((resolve) => {
      secondCalled = true;
      resolve(ok(2));
    });

    const result = await allAsync([
      firstReject as Promise<Result<number, string>>,
      secondPromise,
    ]);

    expect(isErr(result)).toBe(true);
    // Note: Due to Promise.all behavior, both promises start immediately
    // but we return the first rejection error
    if (isErr(result)) {
      expect((result.error as PromiseRejectedError).type).toBe("PROMISE_REJECTED");
    }
  });
});

describe("anyAsync() - mixed sync/async results", () => {
  it("returns first ok from mixed inputs", async () => {
    const asyncOk = async () => ok(42);

    const result = await anyAsync([err("first"), asyncOk(), ok(100)]);

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("returns error when all fail", async () => {
    const asyncErr = async () => err("ASYNC_ERROR");

    const result = await anyAsync([err("FIRST"), asyncErr(), err("THIRD")]);

    expect(isErr(result)).toBe(true);
  });

  it("returns empty input error for empty array", async () => {
    const result = await anyAsync([]);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toEqual({
        type: "EMPTY_INPUT",
        message: "anyAsync() requires at least one Result",
      });
    }
  });

  it("returns early on first success without waiting for slow promises", async () => {
    let slowResolved = false;
    const slowPromise = new Promise<Result<number, string>>((resolve) => {
      setTimeout(() => {
        slowResolved = true;
        resolve(ok(999));
      }, 1000);
    });

    const start = Date.now();
    const result = await anyAsync([
      err("first"),
      Promise.resolve(ok(42)), // This should return immediately
      slowPromise,
    ]);
    const elapsed = Date.now() - start;

    expect(result).toEqual({ ok: true, value: 42 });
    expect(elapsed).toBeLessThan(100); // Should return quickly, not wait 1000ms
    expect(slowResolved).toBe(false); // Slow promise hasn't resolved yet
  });

  it("observes all promises to prevent unhandled rejections", async () => {
    // This test verifies no UnhandledPromiseRejection is emitted
    const rejectingPromise = Promise.reject(new Error("late rejection"));

    const result = await anyAsync([
      ok(42), // Returns immediately
      rejectingPromise as Promise<Result<number, string>>,
    ]);

    expect(result).toEqual({ ok: true, value: 42 });
    // The rejecting promise is observed via .catch(), so no unhandled rejection
  });

  it("races promises - slow first does not block fast second", async () => {
    // This is the key race test: slow promise is FIRST but fast promise is SECOND
    const slowPromise = new Promise<Result<number, string>>((resolve) => {
      setTimeout(() => resolve(ok(1)), 1000);
    });
    const fastPromise = Promise.resolve(ok(42));

    const start = Date.now();
    const result = await anyAsync([
      slowPromise, // Slow is first in array
      fastPromise, // Fast is second
    ]);
    const elapsed = Date.now() - start;

    // Should return fast result immediately, not wait for slow
    expect(result).toEqual({ ok: true, value: 42 });
    expect(elapsed).toBeLessThan(100);
  });

  it("handles never-settling promise when another succeeds", async () => {
    const neverSettles = new Promise<Result<number, string>>(() => {});
    const fast = Promise.resolve(ok(42));

    const start = Date.now();
    const result = await anyAsync([neverSettles, fast]);
    const elapsed = Date.now() - start;

    expect(result).toEqual({ ok: true, value: 42 });
    expect(elapsed).toBeLessThan(100);
  });
});

describe("andThen() - flatMap/chain", () => {
  it("chains successful results", () => {
    const result = andThen(ok(5), (n) => ok(n * 2));
    expect(result).toEqual({ ok: true, value: 10 });
  });

  it("passes through err without calling next", () => {
    let called = false;
    const result = andThen(err("ORIGINAL") as Result<number, string>, (_n) => {
      called = true;
      return ok(42);
    });

    expect(isErr(result)).toBe(true);
    expect(called).toBe(false);
    if (isErr(result)) {
      expect(result.error).toBe("ORIGINAL");
    }
  });

  it("chains to an err result", () => {
    const result = andThen(
      ok(5),
      (_n) => err("FAILED") as Result<number, string>
    );
    expect(result).toEqual({ ok: false, error: "FAILED" });
  });

  it("combines error types in union", () => {
    const first = ok(5) as Result<number, "A">;
    const result = andThen(first, (n) =>
      n > 10 ? err("B" as const) : ok(n * 2)
    );

    // Type is Result<number, "A" | "B">
    if (isErr(result)) {
      const error: "A" | "B" = result.error;
    }
  });
});

describe("tap() - side effects on ok", () => {
  it("executes side effect for ok result", () => {
    let captured: number | null = null;
    const result = tap(ok(42), (n) => {
      captured = n;
    });

    expect(captured).toBe(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("does not execute side effect for err result", () => {
    let called = false;
    const result = tap(err("FAILED") as Result<number, string>, (_n) => {
      called = true;
    });

    expect(called).toBe(false);
    expect(isErr(result)).toBe(true);
  });

  it("returns the same result (useful for chaining)", () => {
    const original = ok({ id: 1, name: "Alice" });
    const result = tap(original, () => void 0); // No-op side effect

    expect(result).toBe(original); // Same reference
  });
});

describe("tapError() - side effects on err", () => {
  it("executes side effect for err result", () => {
    let captured: string | null = null;
    const result = tapError(
      err("FAILED") as Result<number, string>,
      (error) => {
        captured = error;
      }
    );

    expect(captured).toBe("FAILED");
    expect(isErr(result)).toBe(true);
  });

  it("receives cause in callback", () => {
    const originalCause = new Error("root");
    let receivedCause: unknown = null;

    tapError(
      err("FAILED", { cause: originalCause }) as Result<number, string>,
      (_error, cause) => {
        receivedCause = cause;
      }
    );

    expect(receivedCause).toBe(originalCause);
  });

  it("does not execute side effect for ok result", () => {
    let called = false;
    const result = tapError(ok(42), (_error) => {
      called = true;
    });

    expect(called).toBe(false);
    expect(result).toEqual({ ok: true, value: 42 });
  });
});

describe("bimap() - transform both value and error", () => {
  it("transforms ok value with onOk function", () => {
    const result: Result<number, string> = ok(42);
    const mapped = bimap(
      result,
      (n) => n * 2,
      (e) => ({ code: e })
    );
    expect(mapped).toEqual({ ok: true, value: 84 });
  });

  it("transforms error with onErr function", () => {
    const result: Result<number, string> = err("not_found");
    const mapped = bimap(
      result,
      (n: number) => n * 2,
      (e) => ({ code: e.toUpperCase() })
    );
    expect(mapped).toEqual({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("preserves cause when mapping error", () => {
    const cause = new Error("original");
    const result: Result<number, string> = err("failed", { cause });
    const mapped = bimap(
      result,
      (n: number) => n * 2,
      (e) => `wrapped: ${e}`
    );

    if (isErr(mapped)) {
      expect(mapped.cause).toBe(cause);
    }
  });

  it("output types reflect both transformations", () => {
    const okResult: Result<number, string> = ok(42);
    const mappedOk = bimap(
      okResult,
      String,
      (e) => ({ code: e })
    );
    if (isOk(mappedOk)) {
      const str: string = mappedOk.value;
      expect(str).toBe("42");
    }

    const errResult: Result<number, string> = err("oops");
    const mappedErr = bimap(
      errResult,
      String,
      () => 404
    );
    if (isErr(mappedErr)) {
      const code: number = mappedErr.error;
      expect(code).toBe(404);
    }
  });
});

describe("orElse() - error recovery returning Result", () => {
  it("returns original result for ok", () => {
    const result: Result<number, string> = ok(42);
    const recovered = orElse(result, (error) => ok(0));
    expect(recovered).toEqual({ ok: true, value: 42 });
  });

  it("calls recovery function for err and returns new Result", () => {
    const result: Result<number, string> = err("not_found");
    const recovered = orElse(result, (error) =>
      error === "not_found" ? ok(0) : err("other" as const)
    );
    expect(recovered).toEqual({ ok: true, value: 0 });
  });

  it("can return a different error from recovery", () => {
    const result: Result<number, string> = err("not_found");
    const recovered = orElse(result, () => err("converted" as const));
    expect(recovered).toEqual({ ok: false, error: "converted" });
  });

  it("receives cause in recovery function", () => {
    const cause = new Error("original");
    const result: Result<number, string> = err("failed", { cause });
    let receivedCause: unknown;

    orElse(result, (error, c) => {
      receivedCause = c;
      return ok(0);
    });

    expect(receivedCause).toBe(cause);
  });

  it("preserves type narrowing for error recovery", () => {
    type MyError = "NOT_FOUND" | "FORBIDDEN";
    const result: Result<number, MyError> = err("NOT_FOUND");

    const recovered = orElse(result, (error) => {
      if (error === "NOT_FOUND") {
        return ok(-1);
      }
      return err("unrecoverable" as const);
    });

    expect(isOk(recovered)).toBe(true);
    if (isOk(recovered)) {
      expect(recovered.value).toBe(-1);
    }
  });
});

describe("orElseAsync() - async error recovery returning Result", () => {
  it("returns original result for ok", async () => {
    const result: Result<number, string> = ok(42);
    const recovered = await orElseAsync(result, async (error) => ok(0));
    expect(recovered).toEqual({ ok: true, value: 42 });
  });

  it("calls async recovery function for err", async () => {
    const result: Result<number, string> = err("not_found");
    const recovered = await orElseAsync(result, async (error) => {
      await new Promise((r) => setTimeout(r, 1));
      return error === "not_found" ? ok(0) : err("other" as const);
    });
    expect(recovered).toEqual({ ok: true, value: 0 });
  });

  it("can return a different error from async recovery", async () => {
    const result: Result<number, string> = err("not_found");
    const recovered = await orElseAsync(result, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return err("async_error" as const);
    });
    expect(recovered).toEqual({ ok: false, error: "async_error" });
  });

  it("receives cause in async recovery function", async () => {
    const cause = new Error("original");
    const result: Result<number, string> = err("failed", { cause });
    let receivedCause: unknown;

    await orElseAsync(result, async (error, c) => {
      receivedCause = c;
      return ok(0);
    });

    expect(receivedCause).toBe(cause);
  });
});

describe("recover() - error recovery returning plain value (guaranteed success)", () => {
  it("returns original result for ok", () => {
    const result: Result<number, string> = ok(42);
    const recovered = recover(result, () => 0);
    expect(recovered).toEqual({ ok: true, value: 42 });
  });

  it("recovers error to ok with provided value", () => {
    const result: Result<number, string> = err("not_found");
    const recovered = recover(result, (error) =>
      error === "not_found" ? -1 : 0
    );
    expect(recovered).toEqual({ ok: true, value: -1 });
  });

  it("receives cause in recovery function", () => {
    const cause = new Error("original");
    const result: Result<number, string> = err("failed", { cause });
    let receivedCause: unknown;

    recover(result, (error, c) => {
      receivedCause = c;
      return 0;
    });

    expect(receivedCause).toBe(cause);
  });

  it("result is always ok (error type is never)", () => {
    const result: Result<number, string> = err("oops");
    const recovered = recover(result, () => 0);

    // TypeScript: recovered.error would be `never` type
    expect(isOk(recovered)).toBe(true);
    expect(recovered.ok).toBe(true);
  });

  it("can use error value to compute recovery value", () => {
    type ErrorCode = "NOT_FOUND" | "FORBIDDEN" | "SERVER_ERROR";
    const result: Result<number, ErrorCode> = err("SERVER_ERROR");

    const recovered = recover(result, (error) => {
      const fallbacks: Record<ErrorCode, number> = {
        NOT_FOUND: -1,
        FORBIDDEN: -2,
        SERVER_ERROR: -500,
      };
      return fallbacks[error];
    });

    expect(recovered).toEqual({ ok: true, value: -500 });
  });
});

describe("recoverAsync() - async error recovery returning plain value", () => {
  it("returns original result for ok", async () => {
    const result: Result<number, string> = ok(42);
    const recovered = await recoverAsync(result, async () => 0);
    expect(recovered).toEqual({ ok: true, value: 42 });
  });

  it("recovers error to ok with async-computed value", async () => {
    const result: Result<number, string> = err("not_found");
    const recovered = await recoverAsync(result, async (error) => {
      await new Promise((r) => setTimeout(r, 1));
      return error === "not_found" ? -1 : 0;
    });
    expect(recovered).toEqual({ ok: true, value: -1 });
  });

  it("receives cause in async recovery function", async () => {
    const cause = new Error("original");
    const result: Result<number, string> = err("failed", { cause });
    let receivedCause: unknown;

    await recoverAsync(result, async (error, c) => {
      receivedCause = c;
      return 0;
    });

    expect(receivedCause).toBe(cause);
  });

  it("result is always ok after async recovery", async () => {
    const result: Result<number, string> = err("oops");
    const recovered = await recoverAsync(result, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return 999;
    });

    expect(isOk(recovered)).toBe(true);
    expect(recovered).toEqual({ ok: true, value: 999 });
  });
});

describe("allSettled() - collect all results", () => {
  it("returns all values when all succeed", () => {
    const result = allSettled([ok(1), ok(2), ok(3)]);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([1, 2, 3]);
    }
  });

  it("returns all errors when any fail (preserving cause)", () => {
    const result = allSettled([ok(1), err("A"), ok(3), err("B")]);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toEqual([
        { error: "A", cause: undefined },
        { error: "B", cause: undefined },
      ]);
    }
  });

  it("preserves tuple types", () => {
    const result = allSettled([ok(1), ok("two"), ok(true)] );

    if (isOk(result)) {
      const [n, s, b] = result.value;
      expect(n).toBe(1);
      expect(s).toBe("two");
      expect(b).toBe(true);
    }
  });

  it("returns empty array for empty input", () => {
    const result = allSettled([]);
    expect(result).toEqual({ ok: true, value: [] });
  });
});

describe("allSettledAsync() - async version", () => {
  it("collects all async results", async () => {
    const result = await allSettledAsync([
      Promise.resolve(ok(1)),
      Promise.resolve(ok(2)),
    ]);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([1, 2]);
    }
  });

  it("collects all errors from async results (preserving cause)", async () => {
    const result = await allSettledAsync([
      Promise.resolve(ok(1)),
      Promise.resolve(err("A")),
      Promise.resolve(err("B")),
    ]);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toEqual([
        { error: "A", cause: undefined },
        { error: "B", cause: undefined },
      ]);
    }
  });

  it("handles promise rejections gracefully (wrapped in SettledError)", async () => {
    const result = await allSettledAsync([
      Promise.resolve(ok(1)),
      Promise.reject(new Error("network error")),
    ]);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toHaveLength(1);
      // SettledError wraps the PromiseRejectedError and includes PromiseRejectionCause
      expect(result.error[0]).toMatchObject({
        error: { type: "PROMISE_REJECTED" },
        cause: { type: "PROMISE_REJECTION", reason: expect.any(Error) },
      });
    }
  });
});

describe("partition() - split results", () => {
  it("splits into values and errors", () => {
    const results = [ok(1), err("a"), ok(2), err("b")];
    const { values, errors } = partition(results);

    expect(values).toEqual([1, 2]);
    expect(errors).toEqual(["a", "b"]);
  });

  it("returns empty arrays for empty input", () => {
    const { values, errors } = partition([]);

    expect(values).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("handles all ok results", () => {
    const { values, errors } = partition([ok(1), ok(2), ok(3)]);

    expect(values).toEqual([1, 2, 3]);
    expect(errors).toEqual([]);
  });

  it("handles all err results", () => {
    const { values, errors } = partition([err("a"), err("b")]);

    expect(values).toEqual([]);
    expect(errors).toEqual(["a", "b"]);
  });
});

describe("zip() - combine two Results", () => {
  it("combines two ok Results into tuple", () => {
    const a = ok(1);
    const b = ok("hello");
    const result = zip(a, b);

    expect(result).toEqual({ ok: true, value: [1, "hello"] });
  });

  it("returns first error if first Result fails", () => {
    const a = err("FIRST_ERROR");
    const b = ok("hello");
    const result = zip(a, b);

    expect(result).toEqual({ ok: false, error: "FIRST_ERROR" });
  });

  it("returns second error if second Result fails", () => {
    const a = ok(1);
    const b = err("SECOND_ERROR");
    const result = zip(a, b);

    expect(result).toEqual({ ok: false, error: "SECOND_ERROR" });
  });

  it("returns first error if both fail (short-circuit)", () => {
    const a = err("FIRST_ERROR");
    const b = err("SECOND_ERROR");
    const result = zip(a, b);

    expect(result).toEqual({ ok: false, error: "FIRST_ERROR" });
  });

  it("preserves type inference", () => {
    const userResult = ok({ id: "1", name: "Alice" });
    const postsResult = ok([{ id: "p1", title: "Post" }]);
    const result = zip(userResult, postsResult);

    if (result.ok) {
      const [user, posts] = result.value;
      expect(user.name).toBe("Alice");
      expect(posts[0].title).toBe("Post");
    }
  });
});

describe("zipAsync() - combine two async Results", () => {
  it("combines two ok async Results into tuple", async () => {
    const a = Promise.resolve(ok(1));
    const b = Promise.resolve(ok("hello"));
    const result = await zipAsync(a, b);

    expect(result).toEqual({ ok: true, value: [1, "hello"] });
  });

  it("mixes sync and async Results", async () => {
    const a = ok(1); // sync
    const b = Promise.resolve(ok("hello")); // async
    const result = await zipAsync(a, b);

    expect(result).toEqual({ ok: true, value: [1, "hello"] });
  });

  it("returns first error from async Results", async () => {
    const a = Promise.resolve(err("FIRST_ERROR"));
    const b = Promise.resolve(ok("hello"));
    const result = await zipAsync(a, b);

    expect(result).toEqual({ ok: false, error: "FIRST_ERROR" });
  });

  it("returns second error if second fails", async () => {
    const a = Promise.resolve(ok(1));
    const b = Promise.resolve(err("SECOND_ERROR"));
    const result = await zipAsync(a, b);

    expect(result).toEqual({ ok: false, error: "SECOND_ERROR" });
  });

  it("runs both Promises in parallel", async () => {
    const order: string[] = [];

    const a = (async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push("a");
      return ok(1);
    })();

    const b = (async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push("b");
      return ok(2);
    })();

    await zipAsync(a, b);

    // b should complete first (shorter delay), proving parallel execution
    expect(order).toEqual(["b", "a"]);
  });

  it("wraps first Promise rejection as PromiseRejectedError", async () => {
    const a = Promise.reject(new Error("network error"));
    const b = Promise.resolve(ok("hello"));
    const result = await zipAsync(a, b);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        type: "PROMISE_REJECTED",
        cause: expect.any(Error),
      });
    }
  });

  it("wraps second Promise rejection as PromiseRejectedError", async () => {
    const a = Promise.resolve(ok(1));
    const b = Promise.reject(new Error("timeout"));
    const result = await zipAsync(a, b);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        type: "PROMISE_REJECTED",
        cause: expect.any(Error),
      });
    }
  });

  it("handles rejection when both reject (returns first)", async () => {
    const a = Promise.reject(new Error("first"));
    const b = Promise.reject(new Error("second"));
    const result = await zipAsync(a, b);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        type: "PROMISE_REJECTED",
      });
    }
  });
});

describe("fromNullable() - convert nullable", () => {
  it("returns ok for non-null value", () => {
    const result = fromNullable("hello", () => "NULL_ERROR" );

    expect(result).toEqual({ ok: true, value: "hello" });
  });

  it("returns err for null", () => {
    const result = fromNullable(null, () => "NULL_ERROR" );

    expect(result).toEqual({ ok: false, error: "NULL_ERROR" });
  });

  it("returns err for undefined", () => {
    const result = fromNullable(undefined, () => "UNDEFINED_ERROR" );

    expect(result).toEqual({ ok: false, error: "UNDEFINED_ERROR" });
  });

  it("preserves falsy non-null values", () => {
    expect(fromNullable(0, () => "ERR")).toEqual({ ok: true, value: 0 });
    expect(fromNullable("", () => "ERR")).toEqual({ ok: true, value: "" });
    expect(fromNullable(false, () => "ERR")).toEqual({ ok: true, value: false });
  });

  it("calls onNull lazily", () => {
    const onNull = vi.fn(() => "ERR");

    fromNullable("value", onNull);
    expect(onNull).not.toHaveBeenCalled();

    fromNullable(null, onNull);
    expect(onNull).toHaveBeenCalledTimes(1);
  });
});

describe("Type safety for new error types", () => {
  it("allAsync includes PromiseRejectedError in error type", async () => {
    const result = await allAsync([Promise.resolve(ok(1))]);

    // This should compile - error type includes PromiseRejectedError
    if (isErr(result)) {
      const _e: { type: "PROMISE_REJECTED"; cause: unknown } | never =
        result.error as PromiseRejectedError;
      expect(_e).toBeDefined();
    }
  });

  it("anyAsync includes PromiseRejectedError in error type", async () => {
    const result = await anyAsync([Promise.resolve(ok(1))]);

    // This should compile - error type includes PromiseRejectedError
    if (isErr(result)) {
      const _e:
        | { type: "PROMISE_REJECTED"; cause: unknown }
        | { type: "EMPTY_INPUT"; message: string }
        | never = result.error as PromiseRejectedError | { type: "EMPTY_INPUT"; message: string };
      expect(_e).toBeDefined();
    }
  });

  it("run without explicit types returns UnexpectedError", async () => {
    const result = await run(async () => 42);

    // Without explicit types, error is typeof UNEXPECTED_ERROR (string constant)
    // For typed errors, use run<T, E>(fn, { onError })
    if (isErr(result)) {
      const _e: typeof UNEXPECTED_ERROR = result.error;
      expect(_e).toBeDefined();
    }
  });
});

// =============================================================================
// matchError() - exhaustive error matching
// =============================================================================

describe("matchError() - exhaustive error matching", () => {
  it("matches string literal errors", () => {
    type FetchError = "NOT_FOUND" | "FETCH_ERROR";
    const error: FetchError | UnexpectedError = "NOT_FOUND";

    const result = matchError<FetchError, number>(error, {
      NOT_FOUND: () => 404,
      FETCH_ERROR: () => 500,
      UNEXPECTED_ERROR: () => 503,
    });

    expect(result).toBe(404);
  });

  it("matches different string literal error", () => {
    type FetchError = "NOT_FOUND" | "FETCH_ERROR";
    const error: FetchError | UnexpectedError = "FETCH_ERROR";

    const result = matchError<FetchError, number>(error, {
      NOT_FOUND: () => 404,
      FETCH_ERROR: () => 500,
      UNEXPECTED_ERROR: () => 503,
    });

    expect(result).toBe(500);
  });

  it("matches UnexpectedError", () => {
    type FetchError = "NOT_FOUND" | "FETCH_ERROR";
    const unexpectedError: UnexpectedError = {
      type: UNEXPECTED_ERROR,
      cause: { type: "UNCAUGHT_EXCEPTION", thrown: new Error("oops") },
    };
    const error: FetchError | UnexpectedError = unexpectedError;

    const result = matchError<FetchError, number>(error, {
      NOT_FOUND: () => 404,
      FETCH_ERROR: () => 500,
      UNEXPECTED_ERROR: (e) => {
        expect(e.type).toBe(UNEXPECTED_ERROR);
        return 503;
      },
    });

    expect(result).toBe(503);
  });

  it("passes the error to the handler", () => {
    type AppError = "A" | "B";
    const error: AppError | UnexpectedError = "A";

    const result = matchError<AppError, string>(error, {
      A: (e) => {
        expect(e).toBe("A");
        return "matched-A";
      },
      B: (e) => {
        expect(e).toBe("B");
        return "matched-B";
      },
      UNEXPECTED_ERROR: () => "unexpected",
    });

    expect(result).toBe("matched-A");
  });

  it("works with single string literal error type", () => {
    type SingleError = "ONLY_ERROR";
    const error: SingleError | UnexpectedError = "ONLY_ERROR";

    const result = matchError(error, {
      ONLY_ERROR: () => "single",
      UNEXPECTED_ERROR: () => "unexpected",
    });

    expect(result).toBe("single");
  });

  it("returns different types from handlers", () => {
    type FetchError = "NOT_FOUND" | "TIMEOUT";
    const error: FetchError | UnexpectedError = "NOT_FOUND";

    const result = matchError<FetchError, { code: number; message: string }>(error, {
      NOT_FOUND: () => ({ code: 404, message: "Not found" }),
      TIMEOUT: () => ({ code: 408, message: "Timeout" }),
      UNEXPECTED_ERROR: (e) => ({ code: 500, message: "Unexpected" }),
    });

    expect(result).toEqual({ code: 404, message: "Not found" });
  });

  it("integrates with Result error handling", async () => {
    type FetchError = "NOT_FOUND" | "FETCH_ERROR";
    const fetchUser = async (
      id: string
    ): AsyncResult<{ id: string; name: string }, FetchError | UnexpectedError> => {
      if (id === "unknown") return err("NOT_FOUND");
      if (id === "error") return err("FETCH_ERROR");
      return ok({ id, name: "Alice" });
    };

    const result = await fetchUser("unknown");

    if (!result.ok) {
      const httpStatus = matchError<FetchError, number>(result.error, {
        NOT_FOUND: () => 404,
        FETCH_ERROR: () => 500,
        UNEXPECTED_ERROR: () => 503,
      });
      expect(httpStatus).toBe(404);
    }
  });

  it("treats literal UNEXPECTED_ERROR as UnexpectedError", () => {
    type AppError = "UNEXPECTED_ERROR" | "OTHER";
    const error: AppError | UnexpectedError = "UNEXPECTED_ERROR";

    matchError<AppError, number>(error, {
      OTHER: () => 200,
      UNEXPECTED_ERROR: (e) => {
        expect(typeof e).toBe("object");
        expect(e).not.toBeNull();
        if (typeof e === "object" && e !== null) {
          expect((e as UnexpectedError).type).toBe(UNEXPECTED_ERROR);
        }
        return 500;
      },
    });
  });
});

// =============================================================================
// NEW FEATURES: step(result), run.strict()
// =============================================================================
