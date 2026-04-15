/**
 * Tests verifying all awaitly code examples from the
 * "Algebraic Thinking Without the Ceremony" comparison page.
 */
import { describe, it, expect } from "vitest";
import {
  ok,
  err,
  isUnexpectedError,
  type AsyncResult,
  type Errors,
  type ErrorsOf,
} from "../index";
import { run } from "../run-entry";
import { createWorkflow } from "../workflow-entry";
import { unwrapOk, unwrapErr } from "../testing";

// ---------------------------------------------------------------------------
// Shared domain types and fakes used across sections
// ---------------------------------------------------------------------------

type User = { id: string; email: string };
type CreateUserInput = { email: string; passwordHash: string };

const isValidEmail = (e: string) => e.includes("@");
const hash = async (s: string) => `hashed:${s}`;

// ---------------------------------------------------------------------------
// Idea 1: Honest errors — ok / err / AsyncResult basics
// ---------------------------------------------------------------------------

describe("Idea 1: Honest errors", () => {
  const validateEmail = async (
    email: string
  ): AsyncResult<string, "INVALID_EMAIL"> =>
    isValidEmail(email) ? ok(email) : err("INVALID_EMAIL");

  const checkDuplicate = async (
    email: string
  ): AsyncResult<void, "EMAIL_TAKEN"> => {
    const taken = email === "taken@example.com";
    return taken ? err("EMAIL_TAKEN") : ok();
  };

  it("validateEmail returns ok for valid email", async () => {
    const result = await validateEmail("alice@example.com");
    expect(result).toEqual({ ok: true, value: "alice@example.com" });
  });

  it("validateEmail returns err for invalid email", async () => {
    const result = await validateEmail("not-an-email");
    expect(result).toEqual({ ok: false, error: "INVALID_EMAIL" });
  });

  it("checkDuplicate returns ok for fresh email", async () => {
    const result = await checkDuplicate("new@example.com");
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("checkDuplicate returns err for taken email", async () => {
    const result = await checkDuplicate("taken@example.com");
    expect(result).toEqual({ ok: false, error: "EMAIL_TAKEN" });
  });
});

// ---------------------------------------------------------------------------
// Idea 2, Shape 1: run + Errors — plain functions (direct form)
// ---------------------------------------------------------------------------

describe("Idea 2, Shape 1: run + Errors", () => {
  const validateEmail = async (
    email: string
  ): AsyncResult<string, "INVALID_EMAIL"> =>
    isValidEmail(email) ? ok(email) : err("INVALID_EMAIL");

  const findUser = async (
    email: string
  ): AsyncResult<User | null, "DB_ERROR"> =>
    email === "taken@example.com"
      ? ok({ id: "existing", email })
      : ok(null);

  const checkNotTaken = async (
    user: User | null
  ): AsyncResult<void, "EMAIL_TAKEN"> =>
    user ? err("EMAIL_TAKEN") : ok();

  const createUser = async (
    input: CreateUserInput
  ): AsyncResult<User, "DB_ERROR"> =>
    ok({ id: "new-user", email: input.email });

  const sendWelcome = async (
    email: string
  ): AsyncResult<void, "EMAIL_SERVICE_DOWN"> => {
    void email;
    return ok();
  };

  const deps = { validateEmail, findUser, checkNotTaken, createUser, sendWelcome };
  type SignupError = ErrorsOf<typeof deps>;

  const signupWithRun = async (rawEmail: string, password: string) =>
    run<User, SignupError>(async ({ step }) => {
      const email = await step("validate", () => deps.validateEmail(rawEmail));
      const existing = await step("find", () => deps.findUser(email));
      await step("checkNotTaken", () => deps.checkNotTaken(existing));
      const user = await step("create", async () => deps.createUser({ email, passwordHash: await hash(password) }));
      await step("welcome", () => deps.sendWelcome(email));
      return user;
    });

  it("happy path returns created user", async () => {
    const result = await signupWithRun("alice@example.com", "pass123");
    const user = unwrapOk(result);
    expect(user.id).toBe("new-user");
    expect(user.email).toBe("alice@example.com");
  });

  it("invalid email short-circuits", async () => {
    const result = await signupWithRun("bad-email", "pass123");
    const error = unwrapErr(result);
    expect(error).toBe("INVALID_EMAIL");
  });

  it("duplicate email short-circuits with EMAIL_TAKEN", async () => {
    const result = await signupWithRun("taken@example.com", "pass123");
    const error = unwrapErr(result);
    expect(error).toBe("EMAIL_TAKEN");
  });
});

// ---------------------------------------------------------------------------
// Idea 2, Shape 1: fn(args, deps) pattern with run
// ---------------------------------------------------------------------------

describe("Idea 2: fn(args, deps) pattern", () => {
  const validateEmail = async (
    email: string
  ): AsyncResult<string, "INVALID_EMAIL"> =>
    isValidEmail(email) ? ok(email) : err("INVALID_EMAIL");

  const findUser = async (
    email: string
  ): AsyncResult<User | null, "DB_ERROR"> => {
    void email;
    return ok(null);
  };

  const checkNotTaken = async (
    user: User | null
  ): AsyncResult<void, "EMAIL_TAKEN"> =>
    user ? err("EMAIL_TAKEN") : ok();

  const createUser = async (
    input: CreateUserInput
  ): AsyncResult<User, "DB_ERROR"> =>
    ok({ id: "1", email: input.email });

  const sendWelcome = async (
    email: string
  ): AsyncResult<void, "EMAIL_SERVICE_DOWN"> => {
    void email;
    return ok();
  };

  const prodDeps = { validateEmail, findUser, checkNotTaken, createUser, sendWelcome };
  type SignupDeps = typeof prodDeps;
  type SignupErrors = ErrorsOf<SignupDeps>;

  const signupUser = async (
    args: { email: string; password: string },
    deps: SignupDeps,
  ) => {
    return run<User, SignupErrors>(async ({ step }) => {
      const email = await step("validate", () => deps.validateEmail(args.email));
      const existing = await step("find", () => deps.findUser(email));
      await step("checkNotTaken", () => deps.checkNotTaken(existing));
      const user = await step("create", async () => deps.createUser({ email, passwordHash: await hash(args.password) }));
      await step("welcome", () => deps.sendWelcome(email));
      return user;
    });
  };

  it("wiring at the edge works", async () => {
    const signup = (args: { email: string; password: string }) =>
      signupUser(args, prodDeps);

    const result = await signup({ email: "test@example.com", password: "pw" });
    const user = unwrapOk(result);
    expect(user.email).toBe("test@example.com");
  });

  it("tests inject fakes directly", async () => {
    const result = await signupUser(
      { email: "test@example.com", password: "pass123" },
      {
        validateEmail: async (e) => ok(e),
        findUser: async () => ok(null),
        checkNotTaken: async () => ok(),
        createUser: async () => ok({ id: "1", email: "test@example.com" }),
        sendWelcome: async () => ok(),
      }
    );

    const user = unwrapOk(result);
    expect(user).toEqual({ id: "1", email: "test@example.com" });
  });
});

// ---------------------------------------------------------------------------
// Idea 2, Shape 2: createWorkflow
// ---------------------------------------------------------------------------

describe("Idea 2, Shape 2: createWorkflow", () => {
  const validateEmail = async (
    email: string
  ): AsyncResult<string, "INVALID_EMAIL"> =>
    isValidEmail(email) ? ok(email) : err("INVALID_EMAIL");

  const findUser = async (
    email: string
  ): AsyncResult<User | null, "DB_ERROR"> =>
    email === "taken@example.com"
      ? ok({ id: "existing", email })
      : ok(null);

  const checkNotTaken = async (
    user: User | null
  ): AsyncResult<void, "EMAIL_TAKEN"> =>
    user ? err("EMAIL_TAKEN") : ok();

  const createUser = async (
    input: CreateUserInput
  ): AsyncResult<User, "DB_ERROR"> =>
    ok({ id: "new-user", email: input.email });

  const sendWelcome = async (
    email: string
  ): AsyncResult<void, "EMAIL_SERVICE_DOWN"> => {
    void email;
    return ok();
  };

  const signup = createWorkflow("signup", {
    validateEmail,
    findUser,
    checkNotTaken,
    createUser,
    sendWelcome,
  });

  it("happy path", async () => {
    const result = await signup.run(async ({ step, deps }) => {
      const email = await step("validate", () => deps.validateEmail("alice@example.com"));
      const existing = await step("find", () => deps.findUser(email));
      await step("checkNotTaken", () => deps.checkNotTaken(existing));
      const user = await step("create", async () => deps.createUser({ email, passwordHash: await hash("pw") }));
      await step("welcome", () => deps.sendWelcome(email));
      return user;
    });

    const user = unwrapOk(result);
    expect(user.id).toBe("new-user");
  });

  it("error short-circuits", async () => {
    const result = await signup.run(async ({ step, deps }) => {
      const email = await step("validate", () => deps.validateEmail("bad"));
      return email;
    });

    const error = unwrapErr(result);
    expect(error).toBe("INVALID_EMAIL");
  });
});

// ---------------------------------------------------------------------------
// Idea 3: Composition — step() vs andThen vs pipe
// ---------------------------------------------------------------------------

describe("Idea 3: Composition", () => {
  const validateEmail = async (
    email: string
  ): AsyncResult<string, "INVALID_EMAIL"> =>
    isValidEmail(email) ? ok(email) : err("INVALID_EMAIL");

  const findUser = async (
    email: string
  ): AsyncResult<{ id: string; email: string } | null, "DB_ERROR"> => {
    void email;
    return ok(null);
  };

  const checkNotTaken = async (
    user: { id: string; email: string } | null
  ): AsyncResult<void, "EMAIL_TAKEN"> =>
    user ? err("EMAIL_TAKEN") : ok();

  const createAccount = async (
    email: string
  ): AsyncResult<{ id: string; email: string }, "CREATE_FAILED"> =>
    ok({ id: "acct-1", email });

  const sendWelcome = async (
    _userId: string
  ): AsyncResult<void, "WELCOME_FAILED"> => ok();

  it("step() composition — happy path", async () => {
    const result = await run(async ({ step }) => {
      const email = await step("validate", () => validateEmail("alice@example.com"));
      const existing = await step("find", () => findUser(email));
      await step("checkNotTaken", () => checkNotTaken(existing));
      const account = await step("create", () => createAccount(email));
      await step("welcome", () => sendWelcome(account.id));
      return account;
    });

    const account = unwrapOk(result);
    expect(account.id).toBe("acct-1");
  });

  it("step() composition — short-circuits on first error", async () => {
    const callOrder: string[] = [];

    const result = await run(async ({ step }) => {
      callOrder.push("validate");
      const email = await step("validate", () => validateEmail("bad-email"));
      callOrder.push("find");
      const existing = await step("find", () => findUser(email));
      callOrder.push("checkNotTaken");
      await step("checkNotTaken", () => checkNotTaken(existing));
      callOrder.push("create");
      const account = await step("create", () => createAccount(email));
      return account;
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("INVALID_EMAIL");
    // Only "validate" should be logged — step exits before checkNotTaken runs
    expect(callOrder).toEqual(["validate"]);
  });
});

// ---------------------------------------------------------------------------
// Unexpected errors
// ---------------------------------------------------------------------------

describe("Unexpected errors", () => {
  const validateEmail = async (
    email: string
  ): AsyncResult<string, "INVALID_EMAIL"> =>
    isValidEmail(email) ? ok(email) : err("INVALID_EMAIL");

  const throwingStep = async (email: string): AsyncResult<User, "DB_ERROR"> => {
    void email;
    throw new TypeError("Cannot read properties of undefined");
  };

  it("unexpected throw is caught and wrapped in UnexpectedError", async () => {
    const result = await run(async ({ step }) => {
      const email = await step("validate", () => validateEmail("alice@example.com"));
      const user = await step("boom", () => throwingStep(email));
      return user;
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isUnexpectedError(result.error)).toBe(true);
    }
  });

  it("catchUnexpected maps to a closed error union", async () => {
    type E = "INVALID_EMAIL" | "DB_ERROR" | "INTERNAL_ERROR";
    const result = await run<User, E>(
      async ({ step }) => {
        const email = await step("validate", () => validateEmail("alice@example.com"));
        const user = await step("boom", () => throwingStep(email));
        return user;
      },
      {
        catchUnexpected: () => "INTERNAL_ERROR" as const,
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("INTERNAL_ERROR");
    }
  });
});

// ---------------------------------------------------------------------------
// step.try() for throwing code
// ---------------------------------------------------------------------------

describe("step.try()", () => {
  it("catches a throw and maps to static error code", async () => {
    const result = await run(async ({ step }) => {
      const data = await step.try(
        "parse",
        () => JSON.parse("not valid json"),
        { error: "PARSE_FAILED" as const }
      );
      return data;
    });

    const error = unwrapErr(result);
    expect(error).toBe("PARSE_FAILED");
  });

  it("returns unwrapped value on success", async () => {
    const result = await run(async ({ step }) => {
      const data = await step.try(
        "parse",
        () => JSON.parse('{"name": "Alice"}'),
        { error: "PARSE_FAILED" as const }
      );
      return data;
    });

    const value = unwrapOk(result);
    expect(value.name).toBe("Alice");
  });

  it("dynamic error mapping with onError", async () => {
    const result = await run(async ({ step }) => {
      const response = await step.try(
        "callSDK",
        () => {
          throw new Error("connection refused");
        },
        {
          onError: (e) => ({
            type: "SDK_FAILED" as const,
            message: e instanceof Error ? e.message : String(e),
          }),
        }
      );
      return response;
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.error as unknown as { type: string; message: string };
      expect(error.type).toBe("SDK_FAILED");
      expect(error.message).toBe("connection refused");
    }
  });
});

// ---------------------------------------------------------------------------
// Errors<[...]> type inference
// ---------------------------------------------------------------------------

describe("Errors type utility", () => {
  const fetchUser = async (
    id: string
  ): AsyncResult<User, "NOT_FOUND"> =>
    id === "1" ? ok({ id, email: "alice@example.com" }) : err("NOT_FOUND");

  const fetchPosts = async (
    _userId: string
  ): AsyncResult<string[], "FETCH_ERROR"> => ok(["post-1"]);

  const createOrder = async (
    _userId: string
  ): AsyncResult<{ orderId: string }, "ORDER_FAILED"> =>
    ok({ orderId: "ord-1" });

  it("Errors infers union from multiple functions", async () => {
    type AllErrors = Errors<[typeof fetchUser, typeof fetchPosts, typeof createOrder]>;

    const result = await run<
      { user: User; posts: string[]; orderId: string },
      AllErrors
    >(async ({ step }) => {
      const user = await step("fetchUser", () => fetchUser("1"));
      const posts = await step("fetchPosts", () => fetchPosts(user.id));
      const order = await step("createOrder", () => createOrder(user.id));
      return { user, posts, orderId: order.orderId };
    });

    const value = unwrapOk(result);
    expect(value.user.email).toBe("alice@example.com");
    expect(value.posts).toEqual(["post-1"]);
    expect(value.orderId).toBe("ord-1");
  });

  it("Errors union catches errors from any dep in the tuple", async () => {
    type AllErrors = Errors<[typeof fetchUser, typeof fetchPosts]>;

    const result = await run<User, AllErrors>(async ({ step }) => {
      const user = await step("fetchUser", () => fetchUser("unknown"));
      return user;
    });

    const error = unwrapErr(result);
    expect(error).toBe("NOT_FOUND");
  });
});
