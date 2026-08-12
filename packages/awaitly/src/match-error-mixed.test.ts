import { describe, expect, it } from "vitest";
import { err, matchError, ok, run, TaggedError } from "./index";
import type { AsyncResult } from "./index";

class ValidationError extends TaggedError("ValidationError")<{
  userId: string;
}> {}
type User = { id: string; name: string };

const getUser = async (
  id: string
): AsyncResult<User, "NOT_FOUND" | ValidationError> =>
  id === ""
    ? err(new ValidationError({ userId: id }))
    : id === "1"
      ? ok({ id: "1", name: "Alice" })
      : err("NOT_FOUND");

const describeError = (id: string) =>
  run({ getUser }, async (s) => s.getUser(id)).then((r) =>
    r.ok
      ? `ok:${r.value.name}`
      : matchError(r.error, {
          NOT_FOUND: () => "not found",
          ValidationError: (e) => `bad input: ${e.userId}`,
          UnexpectedError: () => "boom",
        })
  );

describe("matchError over a mixed string + TaggedError union", () => {
  it("dispatches a string tag", async () => {
    expect(await describeError("nope")).toBe("not found");
  });
  it("dispatches a TaggedError class and narrows its props", async () => {
    expect(await describeError("")).toBe("bad input: ");
  });
  it("passes ok values through", async () => {
    expect(await describeError("1")).toBe("ok:Alice");
  });
});
