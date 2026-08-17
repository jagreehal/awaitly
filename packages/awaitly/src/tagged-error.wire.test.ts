import { describe, expect, it } from "vitest";
import { TaggedError } from "./tagged-error";

/**
 * Tagged errors crossing a process boundary.
 *
 * Server actions, RPC and cache layers put errors through JSON. `Error` keeps
 * `message` and `stack` non-enumerable, so a spread or `JSON.stringify` drops
 * the message and leaves the receiver holding props with no explanation.
 */

class NotFoundError extends TaggedError("NotFoundError", {
  message: (p: { id: string }) => `No user with id ${p.id}`,
})<{ id: string }> {}

describe("JSON.stringify of a tagged error", () => {
  it("keeps the discriminant, the message and the props", () => {
    const wire = JSON.parse(JSON.stringify(new NotFoundError({ id: "u1" })));

    expect(wire).toEqual({
      type: "NotFoundError",
      message: "No user with id u1",
      id: "u1",
    });
  });

  it("omits the stack so the wire payload leaks no file paths", () => {
    const wire = JSON.parse(JSON.stringify(new NotFoundError({ id: "u1" })));

    expect(wire).not.toHaveProperty("stack");
  });

  it("omits the deprecated _tag alias", () => {
    const wire = JSON.parse(JSON.stringify(new NotFoundError({ id: "u1" })));

    expect(wire).not.toHaveProperty("_tag");
  });
});
