import { describe, it, expect } from "vitest";
import {
  AWAITLY_SLUGS,
  ALL_SLUGS,
  slugCategory,
  slugDocsUrl,
  isAwaitlySlug,
  type AwaitlySlug,
} from "./slugs";

describe("slugs namespace", () => {
  it("exposes every key with itself as value", () => {
    for (const [k, v] of Object.entries(AWAITLY_SLUGS)) {
      expect(v).toBe(k);
    }
  });

  it("contains exactly 31 slugs", () => {
    expect(ALL_SLUGS).toHaveLength(31);
  });

  it("every slug starts with a known category prefix", () => {
    const categories = new Set([
      "step",
      "workflow",
      "result",
      "error",
      "concurrency",
      "runtime",
    ]);
    for (const slug of ALL_SLUGS) {
      const prefix = slug.split("-", 1)[0];
      expect(categories.has(prefix)).toBe(true);
    }
  });

  it("slugCategory returns the prefix", () => {
    expect(slugCategory("step-require-id")).toBe("step");
    expect(slugCategory("workflow-no-floating")).toBe("workflow");
    expect(slugCategory("result-no-floating")).toBe("result");
    expect(slugCategory("error-access-cause")).toBe("error");
    expect(slugCategory("concurrency-no-promise-all")).toBe("concurrency");
    expect(slugCategory("runtime-step-timeout")).toBe("runtime");
  });

  it("slugDocsUrl renders the canonical URL", () => {
    expect(slugDocsUrl("runtime-step-timeout")).toBe(
      "https://jagreehal.github.io/awaitly/rules/#runtime-step-timeout"
    );
  });

  it("isAwaitlySlug accepts known slugs and rejects unknown", () => {
    expect(isAwaitlySlug("runtime-step-timeout")).toBe(true);
    expect(isAwaitlySlug("not-a-slug")).toBe(false);
    // Defends against Object.prototype keys: hasOwnProperty.call vs `in` operator
    expect(isAwaitlySlug("constructor")).toBe(false);
    expect(isAwaitlySlug("hasOwnProperty")).toBe(false);
  });

  it("all slugs are kebab-case (lowercase + hyphens, no spaces)", () => {
    for (const slug of ALL_SLUGS) {
      expect(slug).toMatch(/^[a-z]+(-[a-z]+)+$/);
    }
  });

  it("compile-time: AwaitlySlug union accepts known keys", () => {
    const a: AwaitlySlug = "step-require-id";
    expect(a).toBe("step-require-id");
  });
});
