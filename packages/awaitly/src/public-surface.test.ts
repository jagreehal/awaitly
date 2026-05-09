import { describe, it, expect } from "vitest";
import * as awaitly from "./index";
import * as core from "./core-entry";
import * as slugs from "./slugs";

describe("public surface re-exports", () => {
  it("awaitly/slugs entry exposes the full slug namespace", () => {
    expect(typeof slugs.slugDocsUrl).toBe("function");
    expect(typeof slugs.isAwaitlySlug).toBe("function");
    expect(typeof slugs.slugCategory).toBe("function");
    expect(slugs.AWAITLY_SLUGS["runtime-step-timeout"]).toBe(
      "runtime-step-timeout"
    );
    expect(slugs.ALL_SLUGS).toContain("runtime-step-timeout");
  });

  it("awaitly/core re-exports the full slug namespace", () => {
    expect(typeof core.slugDocsUrl).toBe("function");
    expect(typeof core.isAwaitlySlug).toBe("function");
    expect(typeof core.slugCategory).toBe("function");
    expect(core.AWAITLY_SLUGS["runtime-step-timeout"]).toBe(
      "runtime-step-timeout"
    );
    expect(core.ALL_SLUGS).toContain("runtime-step-timeout");
  });

  it("awaitly root deliberately re-exports types only (runtime helpers live at /slugs or /core)", () => {
    // Type-only export means these are not present on the runtime module object.
    expect((awaitly as Record<string, unknown>).AWAITLY_SLUGS).toBeUndefined();
    expect((awaitly as Record<string, unknown>).slugDocsUrl).toBeUndefined();
    expect((awaitly as Record<string, unknown>).isAwaitlySlug).toBeUndefined();
  });

  it("type-only exports compile correctly through the root entry", () => {
    type S = import("./index").AwaitlySlug;
    type C = import("./index").AwaitlySlugCategory;
    const s: S = "runtime-step-timeout";
    const c: C = "runtime";
    expect(s).toBe("runtime-step-timeout");
    expect(c).toBe("runtime");
  });
});
