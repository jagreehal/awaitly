/**
 * Basic typed workflow fixture for type extraction testing.
 *
 * This fixture tests:
 * - Direct AsyncResult<T, E, C> extraction
 * - Basic step output types
 * - Simple dependency signatures
 */

import { createWorkflow, ok, err, type AsyncResult, type Result } from "awaitly";

interface User {
  id: string;
  name: string;
  email: string;
}

class UserNotFoundError extends Error {
  readonly _tag = "UserNotFoundError";
  constructor(userId: string) {
    super(`User not found: ${userId}`);
  }
}

class DatabaseError extends Error {
  readonly _tag = "DatabaseError";
  constructor(message: string) {
    super(message);
  }
}

const userWorkflow = createWorkflow("user-workflow", {
  fetchUser: async (id: string): AsyncResult<User, UserNotFoundError | DatabaseError> => {
    if (id === "not-found") {
      return err(new UserNotFoundError(id));
    }
    return ok({ id, name: "Test User", email: "test@example.com" });
  },

  validateEmail: async (user: User): Result<boolean, Error> => {
    return ok(user.email.includes("@"));
  },
});

export async function run(id: string) {
  return await userWorkflow.run(async ({ step, deps }) => {
    const user = await step("fetch-user", () => deps.fetchUser(id), {
      errors: ["UserNotFoundError", "DatabaseError"],
      out: "user",
    });

    if (user.isErr()) {
      return user;
    }

    const isValid = await step("validate-email", () => deps.validateEmail(user.value), {
      errors: ["ValidationError"],
    });

    return ok({ user: user.value, isValid: isValid.isOk() ? isValid.value : false });
  });
}
