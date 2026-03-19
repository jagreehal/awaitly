/**
 * Tests for input validation using Standard Schema spec.
 */
import { describe, it, expect } from "vitest";
import { validateInput, isInputValidationError, type InputValidationError } from "./validation";
import type { StandardSchemaV1 } from "@standard-schema/spec";

// Mock Standard Schema object (sync validation)
const mockSchema: StandardSchemaV1 = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (input: unknown) => {
      if (typeof input === "object" && input !== null && "name" in input) {
        return { value: input };
      }
      return {
        issues: [{ message: "Expected object with name", path: [{ key: "name" }] }],
      };
    },
  },
};

// Mock Standard Schema object (async validation)
const mockAsyncSchema: StandardSchemaV1 = {
  "~standard": {
    version: 1,
    vendor: "test-async",
    validate: (input: unknown) => {
      return Promise.resolve(
        typeof input === "object" && input !== null && "name" in input
          ? { value: input }
          : {
              issues: [
                { message: "Expected object with name (async)", path: [{ key: "name" }] },
              ],
            }
      );
    },
  },
};

describe("validateInput", () => {
  it("returns ok with validated value for valid input", async () => {
    const input = { name: "Alice" };
    const result = await validateInput(mockSchema, input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: "Alice" });
    }
  });

  it("returns err with InputValidationError for invalid input", async () => {
    const result = await validateInput(mockSchema, { invalid: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("INPUT_VALIDATION_ERROR");
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].message).toBe("Expected object with name");
      expect(result.error.issues[0].path).toEqual(["name"]);
      expect(result.error.message).toContain("Input validation failed");
    }
  });

  it("handles async schema validation (valid input)", async () => {
    const input = { name: "Bob" };
    const result = await validateInput(mockAsyncSchema, input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: "Bob" });
    }
  });

  it("handles async schema validation (invalid input)", async () => {
    const result = await validateInput(mockAsyncSchema, 42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("INPUT_VALIDATION_ERROR");
      expect(result.error.issues[0].message).toBe("Expected object with name (async)");
    }
  });

  it("handles issues without path", async () => {
    const schemaNoPath: StandardSchemaV1 = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: () => ({
          issues: [{ message: "Invalid" }],
        }),
      },
    };
    const result = await validateInput(schemaNoPath, null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues[0].path).toBeUndefined();
    }
  });
});

describe("isInputValidationError", () => {
  it("returns true for InputValidationError objects", () => {
    const error: InputValidationError = {
      type: "INPUT_VALIDATION_ERROR",
      issues: [{ message: "bad" }],
      message: "Input validation failed: bad",
    };
    expect(isInputValidationError(error)).toBe(true);
  });

  it("returns false for non-matching objects", () => {
    expect(isInputValidationError({ type: "NOT_FOUND" })).toBe(false);
    expect(isInputValidationError(null)).toBe(false);
    expect(isInputValidationError(undefined)).toBe(false);
    expect(isInputValidationError("string")).toBe(false);
    expect(isInputValidationError(42)).toBe(false);
  });
});
