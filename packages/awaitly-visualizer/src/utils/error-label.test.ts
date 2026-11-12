import { describe, expect, it } from "vitest";
import { errorLabel } from "./error-label";

describe("errorLabel", () => {
  it("shows the tag of a plain tagged object", () => {
    expect(errorLabel({ type: "NOT_FOUND", id: "1" })).toBe("NOT_FOUND");
  });
  it("keeps the message of Error instances", () => {
    expect(errorLabel(new Error("boom"))).toBe("Error: boom");
  });
  it("falls back to String() for anything else", () => {
    expect(errorLabel(42)).toBe("42");
  });
});
