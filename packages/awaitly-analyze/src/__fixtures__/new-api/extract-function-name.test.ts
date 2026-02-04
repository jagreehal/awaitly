import { describe, it, expect } from "vitest";
import { extractFunctionName } from "../../types";

describe("extractFunctionName", () => {
  it("extracts function name from property access", () => {
    expect(extractFunctionName("wDeps.makePayment")).toBe("makePayment");
    expect(extractFunctionName("deps.fetchData")).toBe("fetchData");
  });

  it("handles nested property access", () => {
    expect(extractFunctionName("ctx.deps.validate")).toBe("validate");
    expect(extractFunctionName("this.service.api.call")).toBe("call");
  });

  it("handles 'this' prefix", () => {
    expect(extractFunctionName("this.someMethod")).toBe("someMethod");
  });

  it("returns clean names unchanged", () => {
    expect(extractFunctionName("makePayment")).toBe("makePayment");
    expect(extractFunctionName("fetchData")).toBe("fetchData");
  });

  it("handles empty string", () => {
    expect(extractFunctionName("")).toBe("");
  });

  it("handles undefined/null by returning empty string", () => {
    // TypeScript expects string, but test runtime safety
    expect(extractFunctionName(undefined as unknown as string)).toBe("");
    expect(extractFunctionName(null as unknown as string)).toBe("");
  });
});
