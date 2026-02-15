import { describe, it, expect } from "vitest";
import {
  TaggedError,
  type TagOf,
  type ErrorByTag,
  type PropsOf,
} from "./tagged-error";

// =============================================================================
// Test Error Classes
// =============================================================================

// Pattern 1: Props via generic (default message = tag name)
class NotFoundError extends TaggedError("NotFoundError")<{
  id: string;
  resource: string;
}> {}

// Pattern 2: Props inferred from message callback annotation
class ValidationError extends TaggedError("ValidationError", {
  message: (p: { field: string; reason: string }) =>
    `Validation failed for ${p.field}: ${p.reason}`,
}) {}

class NetworkError extends TaggedError("NetworkError", {
  message: (p: { url: string; statusCode: number }) =>
    `Request to ${p.url} failed with ${p.statusCode}`,
}) {}

// Error with cause as domain data
class DomainError extends TaggedError("DomainError")<{
  cause: { field: string; reason: string };
}> {}

// Error with all optional props
class OptionalPropsError extends TaggedError("OptionalPropsError")<{
  code?: number;
  detail?: string;
}> {}

// Error with no props
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
class EmptyPropsError extends TaggedError("EmptyPropsError")<{}> {}

// Union type for matching tests
type TestAppError = NotFoundError | ValidationError | NetworkError;

// =============================================================================
// Construction Tests
// =============================================================================

describe("TaggedError", () => {
  describe("construction", () => {
    it("creates error with correct _tag", () => {
      const error = new NotFoundError({ id: "123", resource: "User" });
      expect(error._tag).toBe("NotFoundError");
    });

    it("creates error with correct name", () => {
      const error = new NotFoundError({ id: "123", resource: "User" });
      expect(error.name).toBe("NotFoundError");
    });

    it("uses tag as default message when no message option provided", () => {
      const error = new NotFoundError({ id: "123", resource: "User" });
      expect(error.message).toBe("NotFoundError");
    });

    it("uses custom message from factory option", () => {
      const error = new ValidationError({ field: "email", reason: "invalid" });
      expect(error.message).toBe("Validation failed for email: invalid");
    });

    it("preserves props as instance properties", () => {
      const error = new NotFoundError({ id: "123", resource: "User" });
      expect(error.id).toBe("123");
      expect(error.resource).toBe("User");
    });

    it("is instanceof Error", () => {
      const error = new NotFoundError({ id: "123", resource: "User" });
      expect(error instanceof Error).toBe(true);
    });

    it("is instanceof TaggedError (via Symbol.hasInstance)", () => {
      const error = new NotFoundError({ id: "123", resource: "User" });
      expect(error instanceof TaggedError).toBe(true);
    });

    it("has stack trace", () => {
      const error = new NotFoundError({ id: "123", resource: "User" });
      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe("string");
    });

    it("supports cause option for error chaining", () => {
      const original = new Error("original");
      const error = new NotFoundError(
        { id: "123", resource: "User" },
        { cause: original }
      );
      expect(error.cause).toBe(original);
    });
  });

  // ===========================================================================
  // Reserved Keys Tests
  // ===========================================================================

  describe("reserved keys", () => {
    it("strips _tag from props to prevent discriminant forgery", () => {
      class SafeError extends TaggedError("SafeError")<{
        _tag?: string;
        id: string;
      }> {}

      const error = new SafeError({
        _tag: "ForgedTag",
        id: "123",
      });

      expect(error._tag).toBe("SafeError"); // not "ForgedTag"
      expect(error.id).toBe("123");
    });

    it("strips name from props to preserve Error.name", () => {
      class NameError extends TaggedError("NameError")<{
        name?: string;
        id: string;
      }> {}

      const error = new NameError({
        name: "ForgedName",
        id: "123",
      });

      expect(error.name).toBe("NameError"); // not "ForgedName"
    });

    it("strips message from props to preserve Error.message", () => {
      class MessageError extends TaggedError("MessageError")<{
        message?: string;
        id: string;
      }> {}

      const error = new MessageError({
        message: "ForgedMessage",
        id: "123",
      });

      expect(error.message).toBe("MessageError"); // not "ForgedMessage"
    });

    it("strips stack from props to preserve Error.stack", () => {
      class StackError extends TaggedError("StackError")<{
        stack?: string;
        id: string;
      }> {}

      const error = new StackError({
        stack: "ForgedStack",
        id: "123",
      });

      expect(error.stack).not.toBe("ForgedStack"); // real stack trace
    });
  });

  // ===========================================================================
  // Cause Handling Tests
  // ===========================================================================

  describe("cause handling", () => {
    it("allows cause as a user-defined prop", () => {
      const error = new DomainError({
        cause: { field: "email", reason: "invalid format" },
      });

      expect(error.cause).toEqual({ field: "email", reason: "invalid format" });
      expect(error._tag).toBe("DomainError");
    });

    it("allows cause via ErrorOptions for error chaining", () => {
      const original = new Error("original error");
      const error = new NotFoundError(
        { id: "123", resource: "User" },
        { cause: original }
      );

      expect(error.cause).toBe(original);
    });

    it("throws TypeError when cause provided in both props and options", () => {
      expect(() => {
        new DomainError(
          { cause: { field: "email", reason: "invalid" } },
          { cause: new Error("original") }
        );
      }).toThrow(TypeError);

      expect(() => {
        new DomainError(
          { cause: { field: "email", reason: "invalid" } },
          { cause: new Error("original") }
        );
      }).toThrow(
        "TaggedError: cannot provide 'cause' in props when also setting ErrorOptions.cause"
      );
    });
  });

  // ===========================================================================
  // Constructor Optionality Tests
  // ===========================================================================

  describe("constructor optionality", () => {
    it("requires props argument when Props has required fields", () => {
      // This is a compile-time check - at runtime we just verify it works
      const error = new NotFoundError({ id: "123", resource: "User" });
      expect(error._tag).toBe("NotFoundError");
    });

    it("allows omitting argument when all props are optional", () => {
      const error = new OptionalPropsError();
      expect(error._tag).toBe("OptionalPropsError");
      expect(error.code).toBeUndefined();
    });

    it("allows omitting argument when props is empty", () => {
      const error = new EmptyPropsError();
      expect(error._tag).toBe("EmptyPropsError");
    });

    it("allows passing partial props when all optional", () => {
      const error = new OptionalPropsError({ code: 404 });
      expect(error.code).toBe(404);
      expect(error.detail).toBeUndefined();
    });
  });

  // ===========================================================================
  // Type Guard Tests
  // ===========================================================================

  describe("TaggedError.isError()", () => {
    it("returns true for Error instances", () => {
      expect(TaggedError.isError(new Error("test"))).toBe(true);
    });

    it("returns true for TaggedError instances", () => {
      expect(
        TaggedError.isError(new NotFoundError({ id: "123", resource: "User" }))
      ).toBe(true);
    });

    it("returns false for null", () => {
      expect(TaggedError.isError(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(TaggedError.isError(undefined)).toBe(false);
    });

    it("returns false for plain objects", () => {
      expect(TaggedError.isError({ message: "error" })).toBe(false);
    });
  });

  describe("TaggedError.isTaggedError()", () => {
    it("returns true for TaggedError instances", () => {
      expect(
        TaggedError.isTaggedError(
          new NotFoundError({ id: "123", resource: "User" })
        )
      ).toBe(true);
    });

    it("returns false for plain Error instances", () => {
      expect(TaggedError.isTaggedError(new Error("test"))).toBe(false);
    });

    it("returns false for null", () => {
      expect(TaggedError.isTaggedError(null)).toBe(false);
    });

    it("returns false for objects with _tag but not Error instance", () => {
      expect(TaggedError.isTaggedError({ _tag: "Fake" })).toBe(false);
    });

    it("returns false for forged Error with _tag (not created via factory)", () => {
      const forgedError = new Error("forged");
      (forgedError as unknown as { _tag: string })._tag = "ForgedTag";

      expect(TaggedError.isTaggedError(forgedError)).toBe(false);
      expect(forgedError instanceof TaggedError).toBe(false);
    });
  });

  // ===========================================================================
  // Pattern Matching Tests
  // ===========================================================================

  describe("TaggedError.match()", () => {
    it("matches NotFoundError", () => {
      const error: TestAppError = new NotFoundError({
        id: "123",
        resource: "User",
      });

      const result = TaggedError.match(error, {
        NotFoundError: (e: NotFoundError) => `Not found: ${e.resource} ${e.id}`,
        ValidationError: (e: ValidationError) => `Invalid: ${e.field}`,
        NetworkError: (e: NetworkError) => `Network: ${e.url}`,
      });

      expect(result).toBe("Not found: User 123");
    });

    it("matches ValidationError", () => {
      const error: TestAppError = new ValidationError({
        field: "email",
        reason: "invalid",
      });

      const result = TaggedError.match(error, {
        NotFoundError: (e: NotFoundError) => `Not found: ${e.id}`,
        ValidationError: (e: ValidationError) => `Invalid ${e.field}: ${e.reason}`,
        NetworkError: (e: NetworkError) => `Network: ${e.url}`,
      });

      expect(result).toBe("Invalid email: invalid");
    });

    it("returns correct type from handlers", () => {
      const error: TestAppError = new NotFoundError({
        id: "123",
        resource: "User",
      });

      const result = TaggedError.match(error, {
        NotFoundError: () => 404,
        ValidationError: () => 400,
        NetworkError: () => 500,
      });

      expect(typeof result).toBe("number");
      expect(result).toBe(404);
    });
  });

  describe("TaggedError.matchPartial()", () => {
    it("matches handled variant", () => {
      const error: TestAppError = new NotFoundError({
        id: "123",
        resource: "User",
      });

      const result = TaggedError.matchPartial<TestAppError, { NotFoundError: (e: NotFoundError) => string }, string>(
        error,
        { NotFoundError: (e: NotFoundError) => `Not found: ${e.id}` },
        (e) => `Other: ${e.message}`
      );

      expect(result).toBe("Not found: 123");
    });

    it("calls otherwise for unhandled variant", () => {
      const error: TestAppError = new ValidationError({
        field: "email",
        reason: "invalid",
      });

      const result = TaggedError.matchPartial<TestAppError, { NotFoundError: (e: NotFoundError) => string }, string>(
        error,
        { NotFoundError: (e: NotFoundError) => `Not found: ${e.id}` },
        (e) => `Fallback: ${e._tag}`
      );

      expect(result).toBe("Fallback: ValidationError");
    });

    it("handles undefined handler values correctly (calls fallback)", () => {
      const error: TestAppError = new NotFoundError({
        id: "123",
        resource: "User",
      });

      const maybeHandler = undefined as
        | ((e: NotFoundError) => string)
        | undefined;

      const result = TaggedError.matchPartial(
        error,
        { NotFoundError: maybeHandler },
        (e) => `Fallback: ${e._tag}`
      );

      expect(result).toBe("Fallback: NotFoundError");
    });
  });

  // ===========================================================================
  // Type Helper Tests (runtime verification)
  // ===========================================================================

  describe("type helpers", () => {
    it("TagOf extracts tag type", () => {
      // Runtime verification that the type works
      const tag: TagOf<NotFoundError> = "NotFoundError";
      expect(tag).toBe("NotFoundError");
    });

    it("ErrorByTag extracts variant by tag", () => {
      // Runtime verification
      type Extracted = ErrorByTag<TestAppError, "NotFoundError">;
      const error: Extracted = new NotFoundError({
        id: "123",
        resource: "User",
      });
      expect(error._tag).toBe("NotFoundError");
    });

    it("PropsOf extracts props (excludes reserved keys)", () => {
      // Runtime verification that PropsOf works correctly
      type Props = PropsOf<NotFoundError>;
      const props: Props = { id: "123", resource: "User" };
      expect(props.id).toBe("123");
      expect(props.resource).toBe("User");
    });

    it("PropsOf includes cause when defined as user prop", () => {
      // Runtime verification
      type Props = PropsOf<DomainError>;
      const props: Props = { cause: { field: "email", reason: "invalid" } };
      expect(props.cause.field).toBe("email");
    });
  });
});
