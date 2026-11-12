/**
 * Fixture for type-display.test.ts. Not a runtime test — it exists so the test
 * can ask the compiler how these types PRINT in hovers, which is the thing
 * users actually see and which tsd cannot check (tsd resolves `NoInfer<X>`
 * to `X`, so a leak passes every structural assertion).
 */
import {
  type AsyncResult,
  createWorkflow,
  err,
  from,
  mapErrorTry,
  ok,
  run,
  tryAsync,
} from "../index";

type User = { id: string; name: string };
type UserNotFound = { type: "USER_NOT_FOUND"; userId: string };

async function getUser(id: string): AsyncResult<User, UserNotFound> {
  if (id === "u-1") return ok({ id, name: "Alice" });
  return err({ type: "USER_NOT_FOUND", userId: id });
}

export const runResult = await run({ getUser }, async (s) => s.getUser("pok"));

export const workflow = createWorkflow({ getUser });

// Not one `as const` below: `const E extends ErrorValue` must keep the `type`
// literal through a callback's return position, so hovers show
// `{ type: "PARSE_ERROR" }` rather than `{ type: string }`.
export const stringMapper = from(
  () => JSON.parse("{}") as unknown,
  () => ({ type: "PARSE_ERROR" })
);
export const asyncStringMapper = await tryAsync(
  async () => 1,
  () => ({ type: "FETCH_ERROR" })
);
export const twoStringMappers = mapErrorTry(
  err({ type: "A" }),
  () => ({ type: "FORMAT_ERROR" }),
  () => ({ type: "TRANSFORM_ERROR" })
);
export const objectMapper = err({ type: "NOT_FOUND", id: "1" });

// step.withTimeout's custom error must reach the result union. It used to be
// typed `unknown`, so a custom timeout error silently vanished from it.
const timeoutWorkflow = createWorkflow({ getUser }, { errors: ["API_TIMEOUT"] });
export const timeoutResult = await timeoutWorkflow.run(async ({ step, deps }) =>
  step.withTimeout("slow", () => deps.getUser("1"), {
    ms: 5000,
    onTimeout: () => ({ type: "API_TIMEOUT" }),
  })
);
