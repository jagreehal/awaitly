/**
 * Type tests for awaitly
 * Run with: pnpm tsd
 *
 * REALITY CHECK: TypeScript cannot infer error types from inside callback bodies.
 * These tests define REALISTIC expected behavior based on TypeScript's capabilities.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expectType } from "tsd";
import {
  run,
  ok,
  err,
  Ok,
  Err,
  Result,
  AsyncResult,
  UnexpectedError,
  Errors,
  ErrorOf,
  createWorkflow,
  ErrorsOfDeps,
  allAsync,
  type WorkflowEvent,
  TaggedError,
  type TagOf,
  type ErrorByTag,
  isOk,
  isErr,
  recover,
  recoverAsync,
  pendingApproval,
  Duration,
  type DurationType,
} from "./index";
// These are exported via awaitly/match and awaitly/retry entry points.
// We import from source here because tsd can't resolve self-referencing package imports.
// The public exports are validated by the build process (tsup generates .d.ts from these sources).
import { Match } from "./match";
import { Schedule } from "./schedule";

// =============================================================================
// TEST HELPERS
// =============================================================================

type User = { id: string; name: string };
type Post = { id: number; title: string };

declare const fetchUser: (id: string) => AsyncResult<User, "NOT_FOUND">;
declare const fetchPosts: (userId: string) => AsyncResult<Post[], "FETCH_ERROR">;
declare const validateUser: (user: User) => Result<User, "INVALID_USER">;

// =============================================================================
// TEST 1: run() with onError includes UnexpectedError (sound behavior)
// For a closed union, use run.strict() with catchUnexpected
// =============================================================================


async function _test1() {
  type AppError = "NOT_FOUND" | "FETCH_ERROR";

  const result = await run<{ user: User; posts: Post[] }, AppError>(
    async (step) => {
      const user = await step(() => fetchUser("123"));
      const posts = await step(() => fetchPosts(user.id));
      return { user, posts };
    },
    {
      onError: (error) => console.log(error),
    }
  );

  if (!result.ok) {
    // Error type includes UnexpectedError because exceptions are always possible
    expectType<AppError | UnexpectedError>(result.error);
  }
}

// =============================================================================
// TEST 2: run() with catchUnexpected - error union must include step errors
// =============================================================================

async function _test2() {
  // When using catchUnexpected, error type includes step errors + catchUnexpected return
  // The step errors flow through; catchUnexpected only handles unexpected exceptions
  type AppError = ErrorOf<typeof fetchUser> | "UNEXPECTED";
  // AppError = "NOT_FOUND" | "UNEXPECTED"

  const result = await run<User, AppError>(
    async (step) => {
      const user = await step(() => fetchUser("123"));
      return user;
    },
    {
      catchUnexpected: () => "UNEXPECTED" as const,
    }
  );

  if (!result.ok) {
    // Error type is AppError - includes step errors and catchUnexpected return type
    expectType<AppError>(result.error);
  }
}

// =============================================================================
// TEST 3: Errors<[...]> utility - Extract error types from functions
// =============================================================================

 
function _test3() {
  // Single function
  type UserError = ErrorOf<typeof fetchUser>;
  expectType<"NOT_FOUND">({} as UserError);

  type ValidateError = ErrorOf<typeof validateUser>;
  expectType<"INVALID_USER">({} as ValidateError);

  // Multiple functions
  type CombinedErrors = Errors<[typeof fetchUser, typeof fetchPosts]>;
  expectType<"NOT_FOUND" | "FETCH_ERROR">({} as CombinedErrors);

  // With sync function
  type AllErrors = Errors<
    [typeof fetchUser, typeof fetchPosts, typeof validateUser]
  >;
  expectType<"NOT_FOUND" | "FETCH_ERROR" | "INVALID_USER">({} as AllErrors);
}

// =============================================================================
// TEST 4: step() unwraps value correctly
// =============================================================================

 
async function _test4() {
  type AppError = "NOT_FOUND" | "FETCH_ERROR";

  const result = await run<{ user: User; posts: Post[] }, AppError>(
    async (step) => {
      const user = await step(() => fetchUser("123"));
      // user should be User, not Result<User, ...>
      expectType<User>(user);

      const posts = await step(() => fetchPosts(user.id));
      expectType<Post[]>(posts);

      return { user, posts };
    },
    { onError: () => {} }
  );

  if (result.ok) {
    expectType<{ user: User; posts: Post[] }>(result.value);
  }
}

// =============================================================================
// TEST 5: step.try() unwraps value correctly
// =============================================================================

 
async function _test5() {
  type AppError = "NETWORK" | "PARSE";

  const result = await run<Response, AppError>(
    async (step) => {
      const response = await step.try(() => fetch("/api"), {
        error: "NETWORK" as const,
      });
      // response should be Response, not wrapped
      expectType<Response>(response);

      return response;
    },
    { onError: () => {} }
  );

  if (result.ok) {
    expectType<Response>(result.value);
  }
}

// =============================================================================
// TEST 6: ok() and err() basic types
// =============================================================================

function _test6() {
  // Clean type display! ok() returns Ok<T>, not Result<number, never, never>
  const success = ok(42);
  expectType<Ok<number>>(success);
  if (success.ok) {
    expectType<number>(success.value);
  }

  // Clean type display! err() returns Err<E>, not Result<never, "NOT_FOUND", unknown>
  const failure = err("NOT_FOUND" as const);
  expectType<Err<"NOT_FOUND">>(failure);
  if (!failure.ok) {
    expectType<"NOT_FOUND">(failure.error);
  }

  // err() with cause - cause type is inferred!
  const withCause = err("ERROR" as const, { cause: new Error("original") });
  expectType<Err<"ERROR", Error>>(withCause);
  if (!withCause.ok) {
    expectType<"ERROR">(withCause.error);
    // Cause is typed and accessible
    expectType<Error | undefined>(withCause.cause);
  }
}

// =============================================================================
// TEST 6b: isOk() and isErr() type guards with clean predicates
// =============================================================================

function _test6b() {
  // Use a function return to prevent TypeScript from narrowing based on literal value
  const getResult = (): Result<number, "NOT_FOUND", Error> => ok(42);
  const result = getResult();

  // isOk() narrows to Ok<T> - clean predicate, not { ok: true; value: T }
  if (isOk(result)) {
    expectType<Ok<number>>(result);
    expectType<number>(result.value);
  }

  // isErr() narrows to Err<E, C> - clean predicate, not { ok: false; error: E; cause?: C }
  if (isErr(result)) {
    expectType<Err<"NOT_FOUND", Error>>(result);
    expectType<"NOT_FOUND">(result.error);
    expectType<Error | undefined>(result.cause);
  }
}

// =============================================================================
// TEST 6c: recover() and recoverAsync() return Ok<T>
// =============================================================================

function _test6c() {
  const mayFail: Result<number, "NOT_FOUND"> = err("NOT_FOUND");

  // recover() always returns Ok<T> - clean type, not Result<number, never, never>
  const recovered = recover(mayFail, () => 0);
  expectType<Ok<number>>(recovered);
  expectType<number>(recovered.value);
}

async function _test6cAsync() {
  const mayFail: Result<number, "NOT_FOUND"> = err("NOT_FOUND");

  // recoverAsync() returns Promise<Ok<T>> - clean type
  const recovered = await recoverAsync(mayFail, async () => 0);
  expectType<Ok<number>>(recovered);
  expectType<number>(recovered.value);
}

// =============================================================================
// TEST 6d: pendingApproval() returns Err<PendingApproval>
// =============================================================================

function _test6d() {
  // pendingApproval() returns Err<PendingApproval> - clean type
  const pending = pendingApproval("approval-key");
  expectType<Err<{ type: "PENDING_APPROVAL"; stepKey: string; reason?: string; metadata?: Record<string, unknown> }>>(pending);
  if (!pending.ok) {
    expectType<"PENDING_APPROVAL">(pending.error.type);
    expectType<string>(pending.error.stepKey);
  }
}

// =============================================================================
// TEST 7: run() with no explicit types - error type is UnexpectedError
// Safe default for simple usage
// =============================================================================

async function _test7() {
  const result = await run(async () => {
    return 42;
  });

  if (result.ok) {
    expectType<number>(result.value);
  }
  if (!result.ok) {
    // Without explicit types, error is UnexpectedError (safe default)
    // For typed errors, use run<T, E>(fn, { onError })
    expectType<UnexpectedError>(result.error);
  }
}

// =============================================================================
// TEST 8: Recommended pattern for closed union - use run.strict with catchUnexpected
// =============================================================================


async function _test8() {
  // Derive error type from functions being used, plus your unexpected error type
  type AppError = Errors<[typeof fetchUser, typeof fetchPosts]> | "UNEXPECTED";
  // AppError = 'NOT_FOUND' | 'FETCH_ERROR' | 'UNEXPECTED'

  const result = await run.strict<{ user: User; posts: Post[] }, AppError>(
    async (step) => {
      const user = await step(() => fetchUser("123"));
      const posts = await step(() => fetchPosts(user.id));
      return { user, posts };
    },
    {
      catchUnexpected: () => "UNEXPECTED" as const,
    }
  );

  if (!result.ok) {
    expectType<AppError>(result.error);
    // Can exhaustively match
    switch (result.error) {
      case "NOT_FOUND":
        break;
      case "FETCH_ERROR":
        break;
      case "UNEXPECTED":
        break;
    }
  }
}

// =============================================================================
// TEST 9: createWorkflow - Automatic error type inference (non-strict)
// =============================================================================

async function _test9() {
  // Create workflow with deps object - error types inferred automatically
  const getPosts = createWorkflow({ fetchUser, fetchPosts });

  const result = await getPosts(async (step) => {
    const user = await step(fetchUser("123"));
    const posts = await step(fetchPosts(user.id));
    return { user, posts };
  });

  if (result.ok) {
    expectType<{ user: User; posts: Post[] }>(result.value);
  }

  if (!result.ok) {
    // Error type is automatically inferred from deps object + UnexpectedError
    expectType<"NOT_FOUND" | "FETCH_ERROR" | UnexpectedError>(result.error);
  }
}

// =============================================================================
// TEST 10: createWorkflow with destructuring in callback
// =============================================================================

async function _test10() {
  const getPosts = createWorkflow({ fetchUser, fetchPosts });

  // Uses object is passed as second argument for destructuring
  const result = await getPosts(async (step, { fetchUser: fu, fetchPosts: fp }) => {
    const user = await step(fu("123"));
    const posts = await step(fp(user.id));
    return { user, posts };
  });

  if (result.ok) {
    expectType<{ user: User; posts: Post[] }>(result.value);
  }
}

// =============================================================================
// TEST 11: createWorkflow strict mode - closed error union
// =============================================================================

async function _test11() {
  const getPosts = createWorkflow(
    { fetchUser, fetchPosts },
    {
      strict: true,
      catchUnexpected: () => "UNEXPECTED" as const,
    }
  );

  const result = await getPosts(async (step) => {
    const user = await step(fetchUser("123"));
    const posts = await step(fetchPosts(user.id));
    return { user, posts };
  });

  if (!result.ok) {
    // Error type is exactly E | U (no UnexpectedError)
    expectType<"NOT_FOUND" | "FETCH_ERROR" | "UNEXPECTED">(result.error);

    // Can exhaustively match
    switch (result.error) {
      case "NOT_FOUND":
        break;
      case "FETCH_ERROR":
        break;
      case "UNEXPECTED":
        break;
    }
  }
}

// =============================================================================
// TEST 12: ErrorsOfDeps utility - Extract errors from deps object
// =============================================================================

function _test12() {
  type Deps = { fetchUser: typeof fetchUser; fetchPosts: typeof fetchPosts };
  type Extracted = ErrorsOfDeps<Deps>;

  expectType<"NOT_FOUND" | "FETCH_ERROR">({} as Extracted);
}

// =============================================================================
// TEST 12B: createWorkflow infers errors from MaybeAsyncResult-returning deps
// =============================================================================

async function _test12b() {
  type BeneficiaryServiceError = { code: string; message: string };
  type MaybeAsync<T> = Result<T, BeneficiaryServiceError> | AsyncResult<T, BeneficiaryServiceError>;

  const beneficiaryDeps: {
    validatePayload: (input: { id: string }) => MaybeAsync<{ id: string }>;
    executeTransaction: (input: { id: string }) => MaybeAsync<boolean>;
  } = {
    validatePayload: (input) => {
      if (!input.id) {
        return err({ code: "INVALID", message: "Missing id" } satisfies BeneficiaryServiceError);
      }
      return ok(input) as Result<{ id: string }, BeneficiaryServiceError>;
    },
    executeTransaction: async () =>
      ok(true) as Result<boolean, BeneficiaryServiceError>,
  };

  type BeneficiaryErrors = ErrorsOfDeps<typeof beneficiaryDeps>;
  expectType<BeneficiaryServiceError>({} as BeneficiaryErrors);

  const beneficiaryWorkflow = createWorkflow(beneficiaryDeps);

  const result = await beneficiaryWorkflow(async (step, deps) => {
    const valid = await step(deps.validatePayload({ id: "123" }));
    const executed = await step(deps.executeTransaction(valid));
    expectType<{ id: string }>(valid);
    expectType<boolean>(executed);
    return executed;
  });

  if (!result.ok) {
    expectType<BeneficiaryServiceError | UnexpectedError>(result.error);
  }
}

// =============================================================================
// TEST 13: createWorkflow with options (onError)
// =============================================================================

async function _test13() {
  const errors: Array<"NOT_FOUND" | "FETCH_ERROR" | UnexpectedError> = [];

  const getPosts = createWorkflow(
    { fetchUser, fetchPosts },
    {
      onError: (error) => {
        // Error type is correctly inferred
        expectType<"NOT_FOUND" | "FETCH_ERROR" | UnexpectedError>(error);
        errors.push(error);
      },
    }
  );

  await getPosts(async (step) => {
    const user = await step(fetchUser("123"));
    return user;
  });
}

// =============================================================================
// TEST 14: Typed cause - err() infers cause type from options
// =============================================================================

import { mapError, match, ExtractCause, CauseOf, map, tapError, andThen } from "./index";

function _test14TypedCause() {
  // err() returns clean Err<E> type - no cause in the type signature
  // This provides better DX with cleaner IDE tooltips
  const noCause = err("ERROR" as const);
  expectType<Err<"ERROR">>(noCause);

  // err() with cause - cause type is inferred!
  const withError = err("FAILED" as const, { cause: new Error("details") });
  expectType<Err<"FAILED", Error>>(withError);

  // Custom error objects can include their own cause if needed
  type ServerError = { type: "SERVER_ERROR"; code: number; details: string };
  const customError: ServerError = { type: "SERVER_ERROR", code: 500, details: "Server error" };
  const withCustom = err(customError);
  expectType<Err<ServerError>>(withCustom);

  if (!withCustom.ok) {
    // Error properties are directly accessible
    expectType<number>(withCustom.error.code);
    expectType<string>(withCustom.error.details);
  }
}

// =============================================================================
// TEST 15: mapError preserves cause type on error path
// =============================================================================

function _test15MapErrorPreservesCause() {
  // Use type assertion to get a properly typed Result for testing cause preservation
  const original = err("A", { cause: new Error() }) as Result<number, "A", Error>;

  const mapped = mapError(original, () => "B" as const);

  // Error type is transformed, cause type is preserved
  expectType<Result<number, "B", Error>>(mapped);

  if (!mapped.ok) {
    // Cause is preserved through mapError
    expectType<Error | undefined>(mapped.cause);
  }
}

// =============================================================================
// TEST 16: match receives typed cause in err handler
// =============================================================================

function _test16MatchTypedCause() {
  const result = err("ERROR", { cause: new Error() }) as Result<number, "ERROR", Error>;

  const matched = match(result, {
    ok: (v) => String(v),
    err: (error, cause) => {
      expectType<"ERROR">(error);
      // Cause is typed as Error | undefined
      expectType<Error | undefined>(cause);
      return cause?.message ?? error;
    }
  });
  expectType<string>(matched);
}

// =============================================================================
// TEST 17: tapError receives typed cause
// =============================================================================

function _test17TapErrorTypedCause() {
  const result = err("ERROR", { cause: new Error() }) as Result<number, "ERROR", Error>;

  tapError(result, (error, cause) => {
    expectType<"ERROR">(error);
    expectType<Error | undefined>(cause);
    // Can access Error properties
    console.log(cause?.message);
  });
}

// =============================================================================
// TEST 18: map preserves cause type on error path
// =============================================================================

function _test18MapPreservesCause() {
  const result = err("ERROR", { cause: new Error() }) as Result<number, "ERROR", Error>;
  const mapped = map(result, (n) => n.toString());

  // Cause type preserved through map
  expectType<Result<string, "ERROR", Error>>(mapped);

  if (!mapped.ok) {
    expectType<Error | undefined>(mapped.cause);
  }
}

// =============================================================================
// TEST 19: andThen unions cause types
// =============================================================================

function _test19AndThenCauseUnion() {
  type CauseA = { typeA: string };
  type CauseB = { typeB: number };

  // Use type assertions to get properly typed Results
  const resultA = ok(42) as Result<number, "A", CauseA>;
  const resultB = ok("hello") as Result<string, "B", CauseB>;

  const chained = andThen(resultA, (n) =>
    n > 0 ? resultB : (err("B" as const, { cause: { typeB: 0 } }) as Result<string, "B", CauseB>)
  );

  // Both error and cause types are unioned
  expectType<Result<string, "A" | "B", CauseA | CauseB>>(chained);

  if (!chained.ok) {
    // Cause is union of input causes
    expectType<CauseA | CauseB | undefined>(chained.cause);
  }
}

// =============================================================================
// TEST 20: ExtractCause utility type
// =============================================================================

function _test20ExtractCause() {
  type R = Result<number, "ERROR", Error>;
  type Cause = ExtractCause<R>;

  // ExtractCause extracts C from the type, which is Error (the cause field is cause?: C)
  expectType<Error>({} as Cause);
}

// =============================================================================
// TEST 21: CauseOf utility type - extract cause from function return
// =============================================================================

// Test helper functions for CauseOf tests
declare const fetchWithCause: (id: string) => Result<User, "NOT_FOUND", Error>;
declare const asyncFetchWithCause: (id: string) => AsyncResult<User, "NOT_FOUND", TypeError>;
declare const fetchUserWithCause: (id: string) => AsyncResult<User, "NOT_FOUND", Error>;

function _test21CauseOf() {
  // Function returning Result with typed cause
  type FetchCause = CauseOf<typeof fetchWithCause>;
  expectType<Error>({} as FetchCause);

  // Async function
  type AsyncFetchCause = CauseOf<typeof asyncFetchWithCause>;
  expectType<TypeError>({} as AsyncFetchCause);
}

// =============================================================================
// TEST 22: AsyncResult with typed cause
// =============================================================================

async function _test22AsyncResultTypedCause() {
  const result = await fetchUserWithCause("123");

  if (!result.ok) {
    expectType<"NOT_FOUND">(result.error);
    expectType<Error | undefined>(result.cause);
    // Can access Error properties directly
    result.cause?.message;
    result.cause?.stack;
  }
}

// =============================================================================
// TEST 23: createWorkflow with typed args - type inferred at call site
// =============================================================================

async function _test23WorkflowWithArgs() {
  const workflow = createWorkflow({ fetchUser, fetchPosts });

  // With args - type inferred from first argument
  const result = await workflow({ id: "123", limit: 10 }, async (step, deps, args) => {
    // args type is inferred from the first argument
    expectType<{ id: string; limit: number }>(args);
    const user = await step(fetchUser(args.id));
    return { user, limit: args.limit };
  });

  if (result.ok) {
    expectType<{ user: User; limit: number }>(result.value);
  }
}

// =============================================================================
// TEST 24: createWorkflow backwards compatibility - no args
// =============================================================================

async function _test24WorkflowBackwardsCompatible() {
  const workflow = createWorkflow({ fetchUser, fetchPosts });

  // Original API still works - no args
  const result = await workflow(async (step, deps) => {
    const user = await step(fetchUser("123"));
    return user;
  });

  if (result.ok) {
    expectType<User>(result.value);
  }

  if (!result.ok) {
    // Error type is inferred from deps
    expectType<"NOT_FOUND" | "FETCH_ERROR" | UnexpectedError>(result.error);
  }
}

// =============================================================================
// TEST 25: createWorkflow strict mode with args
// =============================================================================

async function _test25WorkflowStrictWithArgs() {
  const workflow = createWorkflow(
    { fetchUser, fetchPosts },
    {
      strict: true,
      catchUnexpected: () => "UNEXPECTED" as const,
    }
  );

  const result = await workflow({ userId: "123" }, async (step, deps, args) => {
    expectType<{ userId: string }>(args);
    const user = await step(fetchUser(args.userId));
    const posts = await step(fetchPosts(user.id));
    return { user, posts };
  });

  if (!result.ok) {
    // Strict mode - closed error union
    expectType<"NOT_FOUND" | "FETCH_ERROR" | "UNEXPECTED">(result.error);
  }
}

// =============================================================================
// TEST 26: createWorkflow with primitive args
// =============================================================================

async function _test26WorkflowPrimitiveArgs() {
  const workflow = createWorkflow({ fetchUser });

  // Primitive arg type (string)
  const result = await workflow("user-123", async (step, deps, id) => {
    expectType<string>(id);
    return await step(fetchUser(id));
  });

  if (result.ok) {
    expectType<User>(result.value);
  }
}

// =============================================================================
// TEST 27: createWorkflow cause type is unknown (honest typing)
// =============================================================================

async function _test27WorkflowCauseIsUnknown() {
  // Function that returns a typed cause
  const fetchWithTypedCause = async (id: string): AsyncResult<User, "NOT_FOUND", Error> => {
    try {
      if (id === "1") return ok({ id, name: "Alice" });
      throw new Error("Not found");
    } catch (e) {
      return err("NOT_FOUND" as const, { cause: e as Error });
    }
  };

  const workflow = createWorkflow({ fetchWithTypedCause });

  const result = await workflow(async (step) => {
    return await step(fetchWithTypedCause("1"));
  });

  if (!result.ok) {
    // Cause type is unknown because:
    // - step.try errors have thrown values as cause (unknown)
    // - Uncaught exceptions produce unknown causes
    // - Different steps may have different cause types
    // The cause IS preserved at runtime; narrow based on error type if needed.
    expectType<unknown>(result.cause);
  }
}

// =============================================================================
// TEST 28: batch operations preserve cause types
// =============================================================================

import { all, any, allSettled } from "./index";

function _test28BatchPreservesCause() {
  // Results with typed causes
  const resultA = ok(42) as Result<number, "A", Error>;
  const resultB = ok("hello") as Result<string, "B", TypeError>;

  const combined = all([resultA, resultB]);

  // Test success path: value is tuple of success values
  if (combined.ok) {
    expectType<readonly [number, string]>(combined.value);
  }

  // Test error path: error and cause types are unions
  if (!combined.ok) {
    expectType<"A" | "B">(combined.error);
    // Cause is union of input causes
    expectType<Error | TypeError | undefined>(combined.cause);
  }

  // Test any() preserves cause types too
  const anyResult = any([resultA, resultB]);
  if (!anyResult.ok) {
    // Cause should be union of input causes
    expectType<Error | TypeError | undefined>(anyResult.cause);
  }
}

// =============================================================================
// TEST 29: run() cause type is unknown (honest typing)
// =============================================================================

async function _test29RunCauseIsUnknown() {
  type AppError = "NOT_FOUND" | "FETCH_ERROR";

  const result = await run<User, AppError>(
    async (step) => {
      const user = await step(() => fetchUser("123"));
      return user;
    },
    { onError: () => {} }
  );

  if (!result.ok) {
    // Cause type is unknown because:
    // - step.try errors have thrown values as cause (unknown)
    // - Uncaught exceptions produce unknown causes
    // - Different steps may have different cause types
    expectType<unknown>(result.cause);
  }
}

// =============================================================================
// TEST 30: run.strict() cause type is unknown
// =============================================================================

async function _test30RunStrictCauseIsUnknown() {
  type AppError = "NOT_FOUND" | "UNEXPECTED";

  const result = await run.strict<User, AppError>(
    async (step) => {
      const user = await step(() => fetchUser("123"));
      return user;
    },
    { catchUnexpected: () => "UNEXPECTED" as const }
  );

  if (!result.ok) {
    // Even in strict mode, cause is unknown because catchUnexpected
    // receives thrown values which have unknown type
    expectType<unknown>(result.cause);
  }
}

// =============================================================================
// TEST 31: step.parallel() named object form type inference
// =============================================================================

async function _test31ParallelNamedObjectTypeInference() {
  type User = { id: string; name: string };
  type Post = { id: string; title: string };
  type Comment = { id: string; text: string };

  const fetchUser = (id: string): AsyncResult<User, "NOT_FOUND"> =>
    Promise.resolve(ok({ id, name: `User ${id}` }));

  const fetchPosts = (userId: string): AsyncResult<Post[], "FETCH_ERROR"> =>
    Promise.resolve(ok([{ id: "p1", title: `Post by ${userId}` }]));

  const fetchComments = (postId: string): AsyncResult<Comment[], "COMMENTS_ERROR"> =>
    Promise.resolve(ok([{ id: "c1", text: `Comment on ${postId}` }]));

  await run(async (step) => {
    // Named object form should infer typed results
    const result = await step.parallel({
      user: () => fetchUser("1"),
      posts: () => fetchPosts("1"),
      comments: () => fetchComments("p1"),
    });

    // Each key should have the correct type inferred
    expectType<User>(result.user);
    expectType<Post[]>(result.posts);
    expectType<Comment[]>(result.comments);

    return result;
  });
}

// =============================================================================
// TEST 32: step.parallel() named object with options
// =============================================================================

async function _test32ParallelNamedObjectWithOptions() {
  type User = { id: string; name: string };
  type Post = { id: string; title: string };

  const fetchUser = (id: string): AsyncResult<User, "NOT_FOUND"> =>
    Promise.resolve(ok({ id, name: `User ${id}` }));

  const fetchPosts = (userId: string): AsyncResult<Post[], "FETCH_ERROR"> =>
    Promise.resolve(ok([{ id: "p1", title: `Post by ${userId}` }]));

  await run(async (step) => {
    // Should accept options parameter
    const result = await step.parallel(
      {
        user: () => fetchUser("1"),
        posts: () => fetchPosts("1"),
      },
      { name: "Fetch user data" }
    );

    expectType<User>(result.user);
    expectType<Post[]>(result.posts);

    return result;
  });
}

// =============================================================================
// TEST 33: step.parallel() with createWorkflow preserves error types
// =============================================================================

async function _test36ParallelWithCreateWorkflow() {
  type User = { id: string; name: string };
  type Post = { id: string; title: string };

  const fetchUser = (id: string): AsyncResult<User, "NOT_FOUND"> =>
    Promise.resolve(ok({ id, name: `User ${id}` }));

  const fetchPosts = (userId: string): AsyncResult<Post[], "FETCH_ERROR"> =>
    Promise.resolve(ok([{ id: "p1", title: `Post by ${userId}` }]));

  // createWorkflow should infer error union from deps
  const workflow = createWorkflow({ fetchUser, fetchPosts });

  const result = await workflow(async (step, { fetchUser, fetchPosts }) => {
    // Named object parallel should work within createWorkflow
    const { user, posts } = await step.parallel({
      user: () => fetchUser("1"),
      posts: () => fetchPosts("1"),
    });

    expectType<User>(user);
    expectType<Post[]>(posts);

    return { user, posts };
  });

  // Error type should be inferred from deps
  if (!result.ok) {
    // Error should be "NOT_FOUND" | "FETCH_ERROR" | UnexpectedError
    expectType<"NOT_FOUND" | "FETCH_ERROR" | UnexpectedError>(result.error);
  }
}

// =============================================================================
// TEST: Context type safety in events and handlers
// =============================================================================

async function _testContextTypeSafety() {
  type RequestContext = { requestId: string; userId: string };
  type AppError = "NOT_FOUND";

  // Test 1: WorkflowEvent includes context type
  const workflow = createWorkflow(
    { fetchUser },
    {
      createContext: (): RequestContext => ({
        requestId: "req-123",
        userId: "user-456",
      }),
      onEvent: (event, ctx) => {
        // Context should be typed in event
        if (event.type === "workflow_start") {
          expectType<RequestContext | undefined>(event.context);
          if (event.context) {
            expectType<string>(event.context.requestId);
            expectType<string>(event.context.userId);
          }
        }
        // Separate ctx parameter should also be typed
        expectType<RequestContext>(ctx);
        expectType<string>(ctx.requestId);
        expectType<string>(ctx.userId);
      },
      onError: (error, stepName, ctx) => {
        // onError should receive typed context
        expectType<AppError | UnexpectedError>(error);
        expectType<string | undefined>(stepName);
        expectType<RequestContext | undefined>(ctx);
        if (ctx) {
          expectType<string>(ctx.requestId);
          expectType<string>(ctx.userId);
        }
      },
    }
  );

  await workflow(async (step) => {
    return await step(fetchUser("123"));
  });
}

// =============================================================================
// TEST: Context defaults to unknown when not specified
// =============================================================================

async function _testContextDefaultsToUnknown() {
  // When no context is provided, WorkflowEvent should default to unknown
  // But createWorkflow without createContext uses void for C
  const workflow = createWorkflow({ fetchUser }, {
    onEvent: (event, ctx) => {
      // event.context should be void | undefined (default C = void)
      expectType<void | undefined>(event.context);
      // ctx should be void (default)
      expectType<void>(ctx);
    },
  });

  await workflow(async (step) => {
    return await step(fetchUser("123"));
  });
  
  // Test with explicit unknown context type
  const workflowWithUnknown = createWorkflow<{ fetchUser: typeof fetchUser }, unknown>({ fetchUser }, {
    onEvent: (event, ctx) => {
      // When explicitly typed as unknown, context should be unknown | undefined
      expectType<unknown | undefined>(event.context);
      expectType<unknown>(ctx);
    },
  });

  await workflowWithUnknown(async (step) => {
    return await step(fetchUser("123"));
  });
}

// =============================================================================
// TEST: Context type in run() function
// =============================================================================

async function _testRunContextTypeSafety() {
  type RequestContext = { requestId: string };

  await run<User, "NOT_FOUND", RequestContext>(
    async (step) => {
      return await step(fetchUser("123"));
    },
    {
      context: { requestId: "req-123" },
      onEvent: (event, ctx) => {
        // Context should be typed
        expectType<RequestContext | undefined>(event.context);
        expectType<RequestContext>(ctx);
        if (event.context) {
          expectType<string>(event.context.requestId);
        }
      },
      onError: (error, stepName, ctx) => {
        // onError should receive typed context
        expectType<RequestContext | undefined>(ctx);
        if (ctx) {
          expectType<string>(ctx.requestId);
        }
      },
    }
  );
}

// =============================================================================
// TEST: Context type in run.strict()
// =============================================================================

async function _testRunStrictContextTypeSafety() {
  type RequestContext = { requestId: string };
  type AppError = "NOT_FOUND" | "UNEXPECTED";

  await run.strict<User, AppError, RequestContext>(
    async (step) => {
      return await step(fetchUser("123"));
    },
    {
      context: { requestId: "req-123" },
      catchUnexpected: () => "UNEXPECTED" as const,
      onEvent: (event, ctx) => {
        expectType<RequestContext | undefined>(event.context);
        expectType<RequestContext>(ctx);
      },
      onError: (error, stepName, ctx) => {
        expectType<AppError>(error);
        expectType<string | undefined>(stepName);
        expectType<RequestContext | undefined>(ctx);
      },
    }
  );
}

// =============================================================================
// TEST: WorkflowEvent generic preserves context type
// =============================================================================

function _testWorkflowEventContextGeneric() {
  type RequestContext = { requestId: string };
  type AppError = "NOT_FOUND";

  // WorkflowEvent should preserve context type
  type EventWithContext = WorkflowEvent<AppError, RequestContext>;
  
  // Extract a specific event type
  type WorkflowStartEvent = Extract<EventWithContext, { type: "workflow_start" }>;
  expectType<{ type: "workflow_start"; workflowId: string; ts: number; context?: RequestContext }>(
    {} as WorkflowStartEvent
  );

  type StepErrorEvent = Extract<EventWithContext, { type: "step_error" }>;
  expectType<{
    type: "step_error";
    workflowId: string;
    stepId: string;
    stepKey?: string;
    name?: string;
    ts: number;
    durationMs: number;
    error: AppError;
    context?: RequestContext;
  }>({} as StepErrorEvent);
}

// =============================================================================
// TEST: TaggedError type utilities
// =============================================================================

// Pattern 1: Props via generic (default message = tag)
class TestNotFoundError extends TaggedError("NotFoundError")<{ id: string }> {}

// Pattern 2: Props inferred from message callback annotation
class TestValidationError extends TaggedError("ValidationError", {
  message: (p: { field: string }) => `Invalid: ${p.field}`,
}) {}

class TestNetworkError extends TaggedError("NetworkError", {
  message: (p: { statusCode: number }) => `Network error: ${p.statusCode}`,
}) {}

type TestError = TestNotFoundError | TestValidationError | TestNetworkError;

// =============================================================================
// TEST: Constructor requires props when Props has required fields
// =============================================================================

function _testConstructorRequiredProps() {
  // Error with required props - must provide argument
  class RequiredError extends TaggedError("RequiredError")<{ id: string }> {}
  new RequiredError({ id: "123" }); // OK
  // @ts-expect-error - required props cannot be omitted
  new RequiredError();
  // @ts-expect-error - required props cannot be omitted (undefined not allowed)
  new RequiredError(undefined);

  // Error with all optional props - can omit argument
  class OptionalError extends TaggedError("OptionalError")<{
    code?: number;
    detail?: string;
  }> {}
  new OptionalError(); // OK - all props optional
  new OptionalError({}); // OK
  new OptionalError({ code: 404 }); // OK

  // Error with no props - can omit argument
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  class EmptyError extends TaggedError("EmptyError")<{}> {}
  new EmptyError(); // OK - no props
  new EmptyError({}); // OK

  // Pattern 2 (with message) - required props must be provided
  // @ts-expect-error - required props cannot be omitted
  new TestValidationError();
  new TestValidationError({ field: "email" }); // OK
}

// =============================================================================
// TEST: TagOf extracts the _tag literal type
// =============================================================================

function _testTagOf() {
  type NotFoundTag = TagOf<TestNotFoundError>;
  expectType<"NotFoundError">({} as NotFoundTag);

  type ValidationTag = TagOf<TestValidationError>;
  expectType<"ValidationError">({} as ValidationTag);

  // Union of tags
  type AllTags = TagOf<TestError>;
  expectType<"NotFoundError" | "ValidationError" | "NetworkError">({} as AllTags);
}

// =============================================================================
// TEST: ErrorByTag extracts specific variant from union
// =============================================================================

function _testErrorByTag() {
  type NotFound = ErrorByTag<TestError, "NotFoundError">;
  expectType<TestNotFoundError>({} as NotFound);

  type Validation = ErrorByTag<TestError, "ValidationError">;
  expectType<TestValidationError>({} as Validation);

  type Network = ErrorByTag<TestError, "NetworkError">;
  expectType<TestNetworkError>({} as Network);
}

// =============================================================================
// TEST: TaggedError.match() return type inference
// =============================================================================

function _testMatchReturnType(error: TestError) {
  // All handlers return same type
  const result1 = TaggedError.match(error, {
    NotFoundError: () => 404,
    ValidationError: () => 400,
    NetworkError: () => 500,
  });
  expectType<number>(result1);

  // Handlers return different types - union
  const result2 = TaggedError.match(error, {
    NotFoundError: () => 404,
    ValidationError: () => "bad request",
    NetworkError: () => null,
  });
  expectType<number | string | null>(result2);

  // Handlers receive correctly narrowed error type
  TaggedError.match(error, {
    NotFoundError: (e) => {
      expectType<TestNotFoundError>(e);
      expectType<string>(e.id);
      return null;
    },
    ValidationError: (e) => {
      expectType<TestValidationError>(e);
      expectType<string>(e.field);
      return null;
    },
    NetworkError: (e) => {
      expectType<TestNetworkError>(e);
      expectType<number>(e.statusCode);
      return null;
    },
  });
}

// =============================================================================
// TEST: TaggedError.matchPartial() return type inference
// This was the bug - return type collapsed to just fallback type T
// =============================================================================

function _testMatchPartialReturnType(error: TestError) {
  // Handler returns number, fallback returns string
  // Return type should be number | string, NOT just string
  const result1 = TaggedError.matchPartial(
    error,
    {
      NotFoundError: () => 404,
    },
    () => "default"
  );
  expectType<number | string>(result1);

  // Multiple handlers with different return types
  const result2 = TaggedError.matchPartial(
    error,
    {
      NotFoundError: () => 404,
      ValidationError: () => true,
    },
    () => "fallback"
  );
  expectType<number | boolean | string>(result2);

  // All handlers same type, fallback different
  const result3 = TaggedError.matchPartial(
    error,
    {
      NotFoundError: () => 404,
      ValidationError: () => 400,
    },
    () => null
  );
  expectType<number | null>(result3);

  // Handler and fallback same type
  const result4 = TaggedError.matchPartial(
    error,
    {
      NotFoundError: () => "not found",
    },
    () => "other"
  );
  expectType<string>(result4);

  // Inline handlers: fallback IS narrowed to unhandled variants
  TaggedError.matchPartial(
    error,
    {
      NotFoundError: () => null,
      ValidationError: () => null,
    },
    (e) => {
      // e is narrowed to NetworkError only (the unhandled variant)
      expectType<TestNetworkError>(e);
      return null;
    }
  );

  // Wider-typed variable: fallback receives full error type
  // (DefinitelyHandledKeys only excludes keys with non-undefined values)
  const handlers: Partial<{
    [K in TestError["_tag"]]: (e: Extract<TestError, { _tag: K }>) => number;
  }> = {
    NotFoundError: () => 404,
  };
  TaggedError.matchPartial(error, handlers, (e) => {
    // e is the full TestError type since handlers type allows undefined values
    expectType<TestError>(e);
    return "fallback";
  });
}

// =============================================================================
// TEST 45: map overloads - Ok<T> input returns Ok<U>
// =============================================================================

function _test45MapOkOverload() {
  const okResult = ok(42);
  const mapped = map(okResult, (n) => n.toString());

  // When input is Ok<T>, output is Ok<U>
  expectType<Ok<string>>(mapped);
  expectType<string>(mapped.value);
}

function _test45MapErrOverload() {
  const errResult = err("ERROR", { cause: new Error() });
  // When input is Err, the Err overload is selected. Typed callbacks work
  // because (value: T) => U is assignable to (value: never) => unknown
  // via contravariance (never is assignable to T).
  const mapped = map(errResult, (n: number) => n.toString());

  // When input is Err<E, C>, output is Err<E, C>
  expectType<Err<string, Error>>(mapped);
  expectType<string>(mapped.error);
  expectType<Error | undefined>(mapped.cause);
}

function _test45bMapErrCallbackType() {
  const errResult = err("ERROR", { cause: new Error() }) as Err<"ERROR", Error>;

  // Pre-typed handlers work - T is inferred from the handler type.
  // This allows reusing handlers across Ok and Err branches.
  const handler = (n: number) => n.toString();
  const mapped = map(errResult, handler);
  expectType<Err<"ERROR", Error>>(mapped);

  // Explicitly typed inline callbacks also work
  map(errResult, (n: number) => n.toString());
}

function _test45cMapErrAfterNarrowKeepsValueType() {
  const result = err("ERROR", { cause: new Error() }) as Result<number, "ERROR", Error>;

  if (!result.ok) {
    map(result, (value) => {
      // Note: After narrowing to Err, value type becomes unknown.
      // If you need the value type, annotate the callback or use match().
      expectType<unknown>(value);
      return String(value);
    });
  }
}

function _test45dMapErrAfterNarrowStillLosesValue() {
  const result = err("ERROR", { cause: new Error() }) as Result<number, "ERROR", Error>;

  if (!result.ok) {
    map(result, (value) => {
      // Fails today: value is inferred as unknown even though success type is number
      // @ts-expect-error value should stay number after isErr narrow
      expectType<number>(value);
      return value;
    });
  }
}

// =============================================================================
// TEST 46: andThen overloads - precise return types
// =============================================================================

function _test46AndThenOkToOk() {
  const okResult = ok(42);
  const chained = andThen(okResult, (n) => ok(n.toString()));

  // Ok -> Ok returns Ok
  expectType<Ok<string>>(chained);
}

function _test46AndThenOkToErr() {
  const okResult = ok(42);
  const chained = andThen(okResult, (_n) => err("FAILED" as const, { cause: new Error() }));

  // Ok -> Err returns Err
  expectType<Err<"FAILED", Error>>(chained);
}

function _test46AndThenOkToResult() {
  const okResult = ok(42);
  const getResult = (): Result<string, "ERROR", TypeError> => ok("hello");
  const chained = andThen(okResult, (_n) => getResult());

  // Ok -> Result returns Result (no E from input since Ok has no error)
  expectType<Result<string, "ERROR", TypeError>>(chained);
}

function _test46AndThenErrOverload() {
  const errResult = err("NOT_FOUND" as const, { cause: new Error() });
  // When input is Err, the Err overload is selected. Typed callbacks work
  // via contravariance (never is assignable to number).
  const chained = andThen(errResult, (n: number) => ok(n.toString()));

  // Err input short-circuits, returns Err
  expectType<Err<"NOT_FOUND", Error>>(chained);
}

function _test46bAndThenErrCallbackType() {
  const errResult = err("NOT_FOUND" as const, { cause: new Error() }) as Err<"NOT_FOUND", Error>;

  // Pre-typed handlers work - T is inferred from the handler type.
  // This allows reusing handlers across Ok and Err branches.
  const handler = (n: number) => ok(n.toString());
  const chained = andThen(errResult, handler);
  expectType<Err<"NOT_FOUND", Error>>(chained);

  // Explicitly typed inline callbacks also work
  andThen(errResult, (n: number) => ok(n.toString()));
}

function _test46cAndThenErrAfterNarrowKeepsValueType() {
  const result = err("NOT_FOUND" as const, { cause: new Error() }) as Result<number, "NOT_FOUND", Error>;

  if (!result.ok) {
    andThen(result, (value) => {
      // Note: After narrowing to Err, value type becomes unknown.
      // If you need the value type, annotate the callback or use match().
      expectType<unknown>(value);
      return ok(String(value));
    });
  }
}

function _test46dAndThenErrAfterNarrowStillLosesValue() {
  const result = err("NOT_FOUND" as const, { cause: new Error() }) as Result<number, "NOT_FOUND", Error>;

  if (!result.ok) {
    andThen(result, (value) => {
      // Fails today: value is inferred as unknown even though success type is number
      // @ts-expect-error value should stay number after isErr narrow
      expectType<number>(value);
      return ok(value);
    });
  }
}

// =============================================================================
// TEST 47: match overloads - Ok<T> and Err<E, C> specific inputs
// =============================================================================

function _test47MatchOkOverload() {
  const okResult = ok(42);
  const result = match(okResult, {
    ok: (n) => `Value: ${n}`,
    err: (_e) => "Error",
  });

  expectType<string>(result);
}

function _test47MatchErrOverload() {
  const errResult = err("NOT_FOUND" as const, { cause: new Error() });
  const result = match(errResult, {
    ok: (_n: number) => "Success",
    err: (e, cause) => `Error: ${e}, cause: ${cause}`,
  });

  expectType<string>(result);
}

// =============================================================================
// TEST 48: all with Result<T, never> returns Ok<...>
// =============================================================================

function _test48AllWithNeverErrors() {
  // When inputs are typed as Ok<T> directly, result should be Ok
  const a = ok(1);
  const b = ok("hello");
  const combined = all([a, b]);

  // When all inputs are Ok<T>, result should be Ok
  expectType<Ok<readonly [number, string]>>(combined);
}

function _test48AllSettledWithNeverErrors() {
  // When inputs are typed as Ok<T> directly, result should be Ok
  const a = ok(1);
  const b = ok("hello");
  const combined = allSettled([a, b]);

  // When all inputs are Ok<T>, result should be Ok
  expectType<Ok<readonly [number, string]>>(combined);
}

// =============================================================================
// TEST 49: Match.is and Match.isOneOf type guards
// =============================================================================

type TestEvent =
  | { _tag: "UserCreated"; userId: string; name: string }
  | { _tag: "UserUpdated"; userId: string }
  | { _tag: "UserDeleted"; userId: string };

function _test49MatchTypeGuards() {
  const event: TestEvent = { _tag: "UserCreated", userId: "1", name: "Alice" };

  // Match.is should narrow the type
  if (Match.is<TestEvent, "UserCreated">("UserCreated")(event)) {
    expectType<string>(event.name);
    expectType<string>(event.userId);
  }

  // Match.isOneOf should narrow to union of matched types
  const isModification = Match.isOneOf<TestEvent, ("UserCreated" | "UserUpdated")[]>(
    "UserCreated",
    "UserUpdated"
  );

  if (isModification(event)) {
    // event should be UserCreated | UserUpdated
    expectType<string>(event.userId);
  }
}

// =============================================================================
// TEST 50: Schedule.spaced().pipe() chain works
// =============================================================================

function _test50SchedulePipeChain() {
  // Schedule.spaced returns PipedSchedule with working pipe method
  const schedule = Schedule.spaced(Duration.millis(100))
    .pipe(Schedule.upTo(5))
    .pipe(Schedule.jittered(0.2))
    .pipe(Schedule.maxDelay(Duration.seconds(30)));

  // The schedule should still be usable
  const runner = Schedule.run(schedule);
  const step = runner.next(undefined);

  if (!step.done) {
    // Output should be number (from spaced)
    expectType<number>(step.value.output);
  }
}

function _test50ScheduleExponentialPipeChain() {
  const schedule = Schedule.exponential(Duration.millis(100))
    .pipe(Schedule.upTo(3))
    .pipe(Schedule.andThen(Schedule.spaced(Duration.seconds(1))));

  const runner = Schedule.run(schedule);
  const step = runner.next(undefined);

  if (!step.done) {
    // Duration type should be preserved
    expectType<DurationType>(step.value.delay);
  }
}

// =============================================================================
// TEST 51: Schedule.delays helper returns correct type
// =============================================================================

function _test51ScheduleDelays() {
  const schedule = Schedule.fibonacci(Duration.millis(100)).pipe(Schedule.upTo(5));
  const delays = Schedule.delays(schedule);

  // delays should be array of Duration
  expectType<DurationType[]>(delays);
}
