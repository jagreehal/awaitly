import { describe, it, expect } from "vitest";
import { TaggedError } from "./tagged-error";

class WithSpine extends TaggedError("WithSpine", {
  slug: "runtime-step-timeout",
  hint: "Increase the step timeout option.",
  message: (p: { ms: number }) => `Timed out after ${p.ms}ms`,
}) {}

class WithoutSpine extends TaggedError("WithoutSpine", {
  message: (p: { x: number }) => `x=${p.x}`,
}) {}

describe("TaggedError spine fields", () => {
  it("populates code, hint, docsUrl when slug+hint provided", () => {
    const e = new WithSpine({ ms: 5000 });
    expect(e.code).toBe("runtime-step-timeout");
    expect(e.hint).toBe("Increase the step timeout option.");
    expect(e.docsUrl).toBe("https://jagreehal.github.io/awaitly/rules/#runtime-step-timeout");
  });

  it("preserves message generator behaviour with spine fields", () => {
    const e = new WithSpine({ ms: 5000 });
    expect(e.message).toBe("Timed out after 5000ms");
    expect(e._tag).toBe("WithSpine");
  });

  it("user errors without a slug have undefined spine fields", () => {
    const e = new WithoutSpine({ x: 1 });
    expect((e as unknown as { code?: string }).code).toBeUndefined();
    expect((e as unknown as { hint?: string }).hint).toBeUndefined();
    expect((e as unknown as { docsUrl?: string }).docsUrl).toBeUndefined();
  });

  it("spine fields are readonly and enumerable on the instance", () => {
    const e = new WithSpine({ ms: 1 });
    const codeDesc = Object.getOwnPropertyDescriptor(e, "code");
    expect(codeDesc?.writable).toBe(false);
    expect(codeDesc?.enumerable).toBe(true);
    expect(codeDesc?.configurable).toBe(false);
    const hintDesc = Object.getOwnPropertyDescriptor(e, "hint");
    expect(hintDesc?.writable).toBe(false);
    expect(hintDesc?.enumerable).toBe(true);
    expect(hintDesc?.configurable).toBe(false);
    const docsUrlDesc = Object.getOwnPropertyDescriptor(e, "docsUrl");
    expect(docsUrlDesc?.writable).toBe(false);
    expect(docsUrlDesc?.enumerable).toBe(true);
    expect(docsUrlDesc?.configurable).toBe(false);
  });

  it("spine fields are typed as readonly (compile-time)", () => {
    const e = new WithSpine({ ms: 1 });
    // @ts-expect-error code is readonly at the type level
    // Wrap in try/catch: strict-mode environments throw TypeError, sloppy-mode silently ignores.
    try { e.code = "step-require-id"; } catch { /* expected in strict mode */ }
    // What matters is that TypeScript rejects the assignment above.
    expect(true).toBe(true);
  });
});

describe("TaggedError spine misconfiguration", () => {
  it("throws when slug is set without a hint", () => {
    class Misconfigured extends TaggedError("Misconfigured", {
      slug: "runtime-step-timeout",
      // hint deliberately omitted to trigger guard
      message: () => "test",
    } as { slug: "runtime-step-timeout"; message: () => string }) {}
    expect(() => new Misconfigured()).toThrow(TypeError);
    expect(() => new Misconfigured()).toThrow(/hint.*required/);
  });
});
