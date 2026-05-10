# Slug Spine Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the source-of-truth slug namespace (`slugs.ts`) and extend `TaggedError` so every awaitly-system error carries `code` (slug), `hint`, and `docsUrl`. This is the foundation every other surface (lint plugin, analyzer, visualizer, skill catalogue, docs generator) consumes.

**Architecture:** A single `packages/awaitly/src/slugs.ts` exports a typed const map of all 31 slugs, the `AwaitlySlug` union type, and a `slugDocsUrl(code)` helper. The existing `TaggedError` factory gains optional `slug` / `hint` parameters; when supplied, the constructed error instance carries a readonly `code: AwaitlySlug`, `hint: string`, and `docsUrl: string`. Every pre-built error class in `errors.ts` is migrated to set these. A cross-cutting integrity test asserts that every awaitly-system error class produces instances with all three fields populated and a slug present in `slugs.ts`.

**Tech Stack:** TypeScript, vitest, pnpm workspaces, tsup (existing).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/awaitly/src/slugs.ts` | **Create** | Source-of-truth slug namespace and helpers |
| `packages/awaitly/src/slugs.test.ts` | **Create** | Tests for slug namespace shape and helpers |
| `packages/awaitly/src/tagged-error.ts` | **Modify** | Extend factory to accept optional `slug`/`hint` |
| `packages/awaitly/src/tagged-error.test.ts` | **Create** | Tests for new fields on tagged error instances |
| `packages/awaitly/src/errors.ts` | **Modify** | Migrate all pre-built classes to set slug + hint |
| `packages/awaitly/src/errors-spine.test.ts` | **Create** | Cross-cutting integrity test |
| `packages/awaitly/src/core-entry.ts` | **Modify** | Re-export `AwaitlySlug` and `slugDocsUrl` |
| `packages/awaitly/src/index.ts` | **Modify** | Re-export from public surface |
| `packages/awaitly/CHANGELOG.md` | **Modify** | Document breaking change |

Out of scope (separate follow-on plans):
- `StepTimeoutError` (currently a type alias / object shape) — needs structural rewrite to a class
- `ResolverNotFoundError` and `SagaCompensationError` migration — touches resolver.ts and saga.ts
- ESLint plugin rule rename + new rules
- `awaitly-analyze` slug-keyed diagnostics
- `awaitly-visualizer` error event variant
- Skill catalogue split
- Docs site generator

---

## Task 1: Create `slugs.ts` with the slug namespace

**Files:**
- Create: `packages/awaitly/src/slugs.ts`

- [ ] **Step 1: Write `slugs.ts` with full slug namespace**

Create `packages/awaitly/src/slugs.ts`:

```ts
/**
 * awaitly/slugs
 *
 * Source-of-truth slug namespace. Every concept that surfaces as a runtime
 * error, lint rule, static-analyzer diagnostic, visualizer event, or skill rule
 * has exactly one canonical kebab-case slug here.
 *
 * Slugs are public API. Renames are a major version bump. Adds are non-breaking.
 *
 * Categories:
 * - step-*       step() discipline
 * - workflow-*   createWorkflow / run / runWithState shape
 * - result-*     Result usage
 * - error-*      Boundary handling
 * - concurrency-* step.all/map/race vs Promise.*
 * - runtime-*    Failures only observable at runtime
 */

export const AWAITLY_SLUGS = {
  // --- step-* ---
  "step-require-id": "step-require-id",
  "step-no-immediate-execution": "step-no-immediate-execution",
  "step-require-thunk-for-key": "step-require-thunk-for-key",
  "step-no-bare-await": "step-no-bare-await",
  "step-no-try-catch-wrap": "step-no-try-catch-wrap",
  "step-stable-cache-keys": "step-stable-cache-keys",

  // --- workflow-* ---
  "workflow-no-floating": "workflow-no-floating",
  "workflow-options-position": "workflow-options-position",
  "workflow-callback-shape": "workflow-callback-shape",
  "workflow-no-callable-form": "workflow-no-callable-form",
  "workflow-no-dynamic-import": "workflow-no-dynamic-import",

  // --- result-* ---
  "result-no-floating": "result-no-floating",
  "result-require-handling": "result-require-handling",
  "result-no-double-wrap": "result-no-double-wrap",
  "result-no-manual-propagation": "result-no-manual-propagation",
  "result-no-direct-ok-err": "result-no-direct-ok-err",

  // --- error-* ---
  "error-check-unexpected-first": "error-check-unexpected-first",
  "error-access-cause": "error-access-cause",
  "error-normalize": "error-normalize",
  "error-no-throw-in-deps": "error-no-throw-in-deps",

  // --- concurrency-* ---
  "concurrency-no-promise-all": "concurrency-no-promise-all",
  "concurrency-no-promise-race": "concurrency-no-promise-race",
  "concurrency-no-promise-allsettled": "concurrency-no-promise-allsettled",

  // --- runtime-* ---
  "runtime-step-timeout": "runtime-step-timeout",
  "runtime-step-aborted": "runtime-step-aborted",
  "runtime-retry-exhausted": "runtime-retry-exhausted",
  "runtime-rate-limit": "runtime-rate-limit",
  "runtime-circuit-open": "runtime-circuit-open",
  "runtime-unexpected": "runtime-unexpected",
  "runtime-resolver-not-found": "runtime-resolver-not-found",
  "runtime-saga-compensation": "runtime-saga-compensation",
} as const;

/** All canonical awaitly slugs as a string-literal union. */
export type AwaitlySlug = keyof typeof AWAITLY_SLUGS;

/** Categories derived from slug prefixes. */
export type AwaitlySlugCategory =
  | "step"
  | "workflow"
  | "result"
  | "error"
  | "concurrency"
  | "runtime";

/** Returns the category (prefix) of a slug. */
export function slugCategory(slug: AwaitlySlug): AwaitlySlugCategory {
  return slug.split("-", 1)[0] as AwaitlySlugCategory;
}

/** Returns the canonical docs URL for a slug. */
export function slugDocsUrl(slug: AwaitlySlug): string {
  return `https://awaitly.dev/rules/${slug}`;
}

/** Type guard: is a string a known awaitly slug? */
export function isAwaitlySlug(value: string): value is AwaitlySlug {
  return Object.prototype.hasOwnProperty.call(AWAITLY_SLUGS, value);
}

/** All slugs as an array. */
export const ALL_SLUGS: readonly AwaitlySlug[] = Object.keys(
  AWAITLY_SLUGS
) as AwaitlySlug[];
```

- [ ] **Step 2: Write tests for the slug namespace**

Create `packages/awaitly/src/slugs.test.ts`:

```ts
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
    expect(slugCategory("runtime-step-timeout")).toBe("runtime");
  });

  it("slugDocsUrl renders the canonical URL", () => {
    expect(slugDocsUrl("runtime-step-timeout")).toBe(
      "https://awaitly.dev/rules/runtime-step-timeout"
    );
  });

  it("isAwaitlySlug accepts known slugs and rejects unknown", () => {
    expect(isAwaitlySlug("runtime-step-timeout")).toBe(true);
    expect(isAwaitlySlug("not-a-slug")).toBe(false);
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
```

- [ ] **Step 3: Run the slug tests (expected: PASS — pure file additions)**

Run: `pnpm --filter awaitly test src/slugs.test.ts`

Expected output (final lines):
```
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

- [ ] **Step 4: Commit**

```bash
git add packages/awaitly/src/slugs.ts packages/awaitly/src/slugs.test.ts
git commit -m "feat(awaitly): add slugs namespace as source of truth for AI-DX spine"
```

---

## Task 2: Extend `TaggedError` factory with optional `slug` / `hint`

**Files:**
- Modify: `packages/awaitly/src/tagged-error.ts:38-93,166-228`
- Create: `packages/awaitly/src/tagged-error.spine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/awaitly/src/tagged-error.spine.test.ts`:

```ts
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
    expect(e.docsUrl).toBe("https://awaitly.dev/rules/runtime-step-timeout");
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

  it("spine fields are readonly on the instance", () => {
    const e = new WithSpine({ ms: 1 });
    // @ts-expect-error code is readonly
    e.code = "step-require-id";
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter awaitly test src/tagged-error.spine.test.ts`

Expected: FAIL — `TS2353: Object literal may only specify known properties, and 'slug' does not exist in type 'TaggedErrorCreateOptions'` (or similar) on the `class WithSpine extends TaggedError(...)` line.

- [ ] **Step 3: Extend the `TaggedErrorCreateOptions` interface**

Modify `packages/awaitly/src/tagged-error.ts`. Replace the existing `TaggedErrorCreateOptions` interface (around lines 45-48) with:

```ts
import { type AwaitlySlug, slugDocsUrl } from "./slugs";

/**
 * Options for TaggedError factory with type-safe message callback.
 */
export interface TaggedErrorCreateOptions<Props extends Record<string, unknown>> {
  /** Custom message generator from props. Annotate parameter for type safety. */
  message: (props: Props) => string;
  /**
   * Canonical awaitly slug for this error class. When set, instances carry
   * `code`, `hint`, and `docsUrl` populated from the slugs namespace.
   * Required together with `hint` for awaitly-system errors.
   */
  slug?: AwaitlySlug;
  /**
   * One-line "do X instead" guidance shown alongside the error.
   * Required when `slug` is set.
   */
  hint?: string;
}
```

- [ ] **Step 4: Update `TaggedErrorBase` interface to include optional spine fields**

In the same file, replace the existing `TaggedErrorBase` interface (around lines 53-55) with:

```ts
/**
 * Base interface for all tagged errors.
 */
export interface TaggedErrorBase extends Error {
  readonly _tag: string;
  /** Canonical slug for awaitly-system errors. Undefined for user errors that opt out. */
  readonly code?: AwaitlySlug;
  /** One-line guidance. Undefined when no slug is set. */
  readonly hint?: string;
  /** Canonical docs URL. Undefined when no slug is set. */
  readonly docsUrl?: string;
}
```

- [ ] **Step 5: Update the factory implementation to set spine fields**

In `tagged-error.ts`, find the `TaggedError` implementation function (around line 166) and update the `class extends InternalTaggedErrorBase` block. After `this.name = tag;` (around line 180), insert:

```ts
      // Spine fields: populate when factory was given a slug + hint
      if (options?.slug !== undefined) {
        Object.defineProperty(this, "code", {
          value: options.slug,
          enumerable: true,
          writable: false,
        });
        Object.defineProperty(this, "hint", {
          value: options.hint ?? "",
          enumerable: true,
          writable: false,
        });
        Object.defineProperty(this, "docsUrl", {
          value: slugDocsUrl(options.slug),
          enumerable: true,
          writable: false,
        });
      }
```

- [ ] **Step 6: Update the typed instance return shape**

In `tagged-error.ts`, find the `TaggedErrorInstance` type (around lines 67-71) and replace with:

```ts
/**
 * Instance type for factory-created TaggedErrors.
 */
type TaggedErrorInstance<Tag extends string, Props> = TaggedErrorBase & {
  readonly _tag: Tag;
} & Readonly<Props>;
```

(Already that shape — no change needed if it already matches. The `code`/`hint`/`docsUrl` come from `TaggedErrorBase` once that interface is updated above.)

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter awaitly test src/tagged-error.spine.test.ts`

Expected output (final lines):
```
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

- [ ] **Step 8: Run the existing tagged-error tests to confirm no regression**

Run: `pnpm --filter awaitly test src/tagged-error`

Expected: all existing `tagged-error.test.ts` tests still pass; new `tagged-error.spine.test.ts` passes.

- [ ] **Step 9: Commit**

```bash
git add packages/awaitly/src/tagged-error.ts packages/awaitly/src/tagged-error.spine.test.ts
git commit -m "feat(awaitly): TaggedError factory accepts slug+hint for AI-DX spine fields"
```

---

## Task 3: Migrate `errors.ts` pre-built classes to set slugs

**Files:**
- Modify: `packages/awaitly/src/errors.ts:74-327` (every pre-built error class)

The pre-built classes that map to runtime-* slugs:

| Class | Slug | Hint |
|---|---|---|
| `TimeoutError` | `runtime-step-timeout` | `"Increase the step's timeout option, or check why the upstream operation is slow."` |
| `RetryExhaustedError` | `runtime-retry-exhausted` | `"All retry attempts failed. Inspect the cause and decide whether to surface it or compensate."` |
| `RateLimitError` | `runtime-rate-limit` | `"Wait retryAfterMs before retrying, or apply step.cache to deduplicate calls."` |
| `CircuitBreakerOpenError` | `runtime-circuit-open` | `"The circuit is open. Wait for it to half-open or fall back to a degraded path."` |
| `CompensationError` | `runtime-saga-compensation` | `"A saga compensation step failed. Inspect compensationError and ensure compensation is idempotent."` |
| `UnexpectedError` | `runtime-unexpected` | `"An unexpected exception escaped a step. Inspect cause; consider returning a typed Result instead of throwing."` |

The convenience domain classes (`ValidationError`, `NotFoundError`, `UnauthorizedError`, `NetworkError`) are user-instantiable conveniences; they are deliberately NOT slugged in this plan — they're shaped to look like awaitly-system errors but represent user domain failures. Document this decision in the file header.

- [ ] **Step 1: Write the failing test**

Create `packages/awaitly/src/errors-spine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  TimeoutError,
  RetryExhaustedError,
  RateLimitError,
  CircuitBreakerOpenError,
  CompensationError,
  UnexpectedError,
  ValidationError,
  NotFoundError,
} from "./errors";
import { isAwaitlySlug } from "./slugs";

describe("pre-built awaitly-system errors carry the spine", () => {
  it("TimeoutError has the runtime-step-timeout slug", () => {
    const e = new TimeoutError({ operation: "fetchUser", ms: 5000 });
    expect(e.code).toBe("runtime-step-timeout");
    expect(typeof e.hint).toBe("string");
    expect(e.hint!.length).toBeGreaterThan(0);
    expect(e.docsUrl).toBe("https://awaitly.dev/rules/runtime-step-timeout");
  });

  it("RetryExhaustedError has the runtime-retry-exhausted slug", () => {
    const e = new RetryExhaustedError({ operation: "send", attempts: 3 });
    expect(e.code).toBe("runtime-retry-exhausted");
  });

  it("RateLimitError has the runtime-rate-limit slug", () => {
    const e = new RateLimitError({ retryAfterMs: 1000 });
    expect(e.code).toBe("runtime-rate-limit");
  });

  it("CircuitBreakerOpenError has the runtime-circuit-open slug", () => {
    const e = new CircuitBreakerOpenError({ circuitName: "db" });
    expect(e.code).toBe("runtime-circuit-open");
  });

  it("CompensationError has the runtime-saga-compensation slug", () => {
    const e = new CompensationError({ step: "chargeCard" });
    expect(e.code).toBe("runtime-saga-compensation");
  });

  it("UnexpectedError has the runtime-unexpected slug", () => {
    const e = new UnexpectedError({ cause: new Error("boom") });
    expect(e.code).toBe("runtime-unexpected");
  });

  it("every system error's hint is one short sentence (≤ 160 chars)", () => {
    const errs = [
      new TimeoutError({ operation: "x", ms: 1 }),
      new RetryExhaustedError({ operation: "x", attempts: 1 }),
      new RateLimitError({ retryAfterMs: 1 }),
      new CircuitBreakerOpenError({ circuitName: "x" }),
      new CompensationError({ step: "x" }),
      new UnexpectedError({ cause: "x" }),
    ];
    for (const e of errs) {
      expect(e.hint!.length).toBeLessThanOrEqual(160);
    }
  });

  it("every system error's code is a valid slug", () => {
    const errs = [
      new TimeoutError({ operation: "x", ms: 1 }),
      new RetryExhaustedError({ operation: "x", attempts: 1 }),
      new RateLimitError({ retryAfterMs: 1 }),
      new CircuitBreakerOpenError({ circuitName: "x" }),
      new CompensationError({ step: "x" }),
      new UnexpectedError({ cause: "x" }),
    ];
    for (const e of errs) {
      expect(isAwaitlySlug(e.code!)).toBe(true);
    }
  });

  it("user-domain convenience errors deliberately have no spine", () => {
    const v = new ValidationError({ field: "email", reason: "required" });
    const n = new NotFoundError({ resource: "User", id: "1" });
    expect((v as unknown as { code?: string }).code).toBeUndefined();
    expect((n as unknown as { code?: string }).code).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter awaitly test src/errors-spine.test.ts`

Expected: FAIL — first assertion fails because `e.code` is `undefined` (the migration hasn't happened yet).

- [ ] **Step 3: Migrate `TimeoutError` in `errors.ts`**

In `packages/awaitly/src/errors.ts`, find the `TimeoutError` class and modify its `TaggedError(...)` options to add `slug` and `hint`:

```ts
export class TimeoutError extends TaggedError("TimeoutError", {
  slug: "runtime-step-timeout",
  hint: "Increase the step's timeout option, or check why the upstream operation is slow.",
  message: (p: { operation: string; ms: number }) =>
    `TimeoutError: ${p.operation} timed out after ${p.ms}ms`,
}) {}
```

(Preserve the existing message/props shape exactly as-is; only add `slug` and `hint`.)

- [ ] **Step 4: Migrate `RetryExhaustedError`**

```ts
export class RetryExhaustedError extends TaggedError("RetryExhaustedError", {
  slug: "runtime-retry-exhausted",
  hint: "All retry attempts failed. Inspect the cause and decide whether to surface it or compensate.",
  message: (p: { operation: string; attempts: number; cause?: unknown }) =>
    `RetryExhaustedError: ${p.operation} failed after ${p.attempts} attempts`,
}) {}
```

- [ ] **Step 5: Migrate `RateLimitError`**

```ts
export class RateLimitError extends TaggedError("RateLimitError", {
  slug: "runtime-rate-limit",
  hint: "Wait retryAfterMs before retrying, or apply step.cache to deduplicate calls.",
  message: (p: { retryAfterMs: number; limit?: number; window?: number }) =>
    `RateLimitError: rate limited, retry after ${p.retryAfterMs}ms`,
}) {}
```

(Match the existing props shape — read the current class to confirm.)

- [ ] **Step 6: Migrate `CircuitBreakerOpenError`**

```ts
export class CircuitBreakerOpenError extends TaggedError("CircuitBreakerOpenError", {
  slug: "runtime-circuit-open",
  hint: "The circuit is open. Wait for it to half-open or fall back to a degraded path.",
  message: (p: { circuitName: string; failureCount?: number }) =>
    `CircuitBreakerOpenError: circuit ${p.circuitName} is open`,
}) {}
```

(Match the existing props shape exactly — confirm by reading the file.)

- [ ] **Step 7: Migrate `CompensationError`**

```ts
export class CompensationError extends TaggedError("CompensationError", {
  slug: "runtime-saga-compensation",
  hint: "A saga compensation step failed. Inspect compensationError and ensure compensation is idempotent.",
  message: (p: {
    step: string;
    originalError?: unknown;
    compensationError?: unknown;
  }) => `CompensationError: Failed to compensate step ${p.step}`,
}) {}
```

- [ ] **Step 8: Migrate `UnexpectedError`**

```ts
export class UnexpectedError extends TaggedError("UnexpectedError", {
  slug: "runtime-unexpected",
  hint: "An unexpected exception escaped a step. Inspect cause; consider returning a typed Result instead of throwing.",
  message: (p: { cause?: unknown }) =>
    `UnexpectedError: ${p.cause instanceof Error ? p.cause.message : String(p.cause ?? "unknown")}`,
}) {}
```

- [ ] **Step 9: Add a header comment documenting the deliberate non-slugging of user-domain classes**

In `errors.ts`, near the top (after the existing module JSDoc), add:

```ts
/**
 * Spine policy:
 *
 * Awaitly-system errors (raised by awaitly internals on workflow execution
 * failure modes) carry a `slug` + `hint` so they participate in the
 * AI-DX spine: TimeoutError, RetryExhaustedError, RateLimitError,
 * CircuitBreakerOpenError, CompensationError, UnexpectedError.
 *
 * Convenience domain errors (ValidationError, NotFoundError,
 * UnauthorizedError, NetworkError) are deliberately NOT slugged — they
 * represent USER domain failures and would force user code into the
 * awaitly slug namespace. Users can opt in by adding `slug` + `hint`
 * to their own TaggedError subclasses.
 */
```

- [ ] **Step 10: Run the new test**

Run: `pnpm --filter awaitly test src/errors-spine.test.ts`

Expected output (final lines):
```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

- [ ] **Step 11: Run the full errors test suite to verify no regressions**

Run: `pnpm --filter awaitly test src/errors`

Expected: all existing tests in `errors.test.ts` pass; the new `errors-spine.test.ts` passes.

- [ ] **Step 12: Commit**

```bash
git add packages/awaitly/src/errors.ts packages/awaitly/src/errors-spine.test.ts
git commit -m "feat(awaitly): migrate pre-built awaitly-system errors to slug spine"
```

---

## Task 4: Re-export `AwaitlySlug` and helpers from public surface

**Files:**
- Modify: `packages/awaitly/src/core-entry.ts`
- Modify: `packages/awaitly/src/index.ts`

- [ ] **Step 1: Read current public exports**

Run: `head -200 packages/awaitly/src/index.ts`

Note the export style (named re-exports from `./core` and friends).

- [ ] **Step 2: Add slugs exports to `core-entry.ts`**

In `packages/awaitly/src/core-entry.ts`, append (or place alongside other type re-exports):

```ts
export {
  type AwaitlySlug,
  type AwaitlySlugCategory,
  AWAITLY_SLUGS,
  ALL_SLUGS,
  slugCategory,
  slugDocsUrl,
  isAwaitlySlug,
} from "./slugs";
```

- [ ] **Step 3: Add slugs exports to `index.ts`**

In `packages/awaitly/src/index.ts`, find the existing `export { ... }` block(s) and add:

```ts
export {
  type AwaitlySlug,
  type AwaitlySlugCategory,
  AWAITLY_SLUGS,
  ALL_SLUGS,
  slugCategory,
  slugDocsUrl,
  isAwaitlySlug,
} from "./slugs";
```

(Place beside other top-level type re-exports.)

- [ ] **Step 4: Verify the package's public types compile**

Run: `pnpm --filter awaitly typecheck`

Expected: no errors. (If there is no `typecheck` script, run `pnpm --filter awaitly build` instead — tsup will emit type errors during the build.)

- [ ] **Step 5: Write a smoke test for the public surface**

Append to `packages/awaitly/src/slugs.test.ts`:

```ts
import * as awaitly from "./index";
import * as core from "./core-entry";

describe("public surface re-exports", () => {
  it("index re-exports AwaitlySlug helpers", () => {
    expect(typeof awaitly.slugDocsUrl).toBe("function");
    expect(typeof awaitly.isAwaitlySlug).toBe("function");
    expect(awaitly.AWAITLY_SLUGS["runtime-step-timeout"]).toBe(
      "runtime-step-timeout"
    );
  });

  it("core-entry re-exports AwaitlySlug helpers", () => {
    expect(typeof core.slugDocsUrl).toBe("function");
    expect(core.AWAITLY_SLUGS["runtime-step-timeout"]).toBe(
      "runtime-step-timeout"
    );
  });
});
```

- [ ] **Step 6: Run the smoke test**

Run: `pnpm --filter awaitly test src/slugs.test.ts`

Expected: all tests pass (now 9 total in this file).

- [ ] **Step 7: Commit**

```bash
git add packages/awaitly/src/core-entry.ts packages/awaitly/src/index.ts packages/awaitly/src/slugs.test.ts
git commit -m "feat(awaitly): export AwaitlySlug and helpers from public surface"
```

---

## Task 5: Cross-cutting integrity test

**Files:**
- Create: `packages/awaitly/src/spine-integrity.test.ts`

- [ ] **Step 1: Write the integrity test**

Create `packages/awaitly/src/spine-integrity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  TimeoutError,
  RetryExhaustedError,
  RateLimitError,
  CircuitBreakerOpenError,
  CompensationError,
  UnexpectedError,
} from "./errors";
import { ALL_SLUGS, isAwaitlySlug, type AwaitlySlug } from "./slugs";

/**
 * The "system errors" spine roster: every awaitly-system error class that must
 * carry a slug. Adding a new system error means adding it here AND adding its
 * slug to slugs.ts. This test is the integrity gate.
 */
function buildSystemErrors(): Array<{ name: string; instance: Error & { code?: AwaitlySlug; hint?: string; docsUrl?: string } }> {
  return [
    { name: "TimeoutError", instance: new TimeoutError({ operation: "x", ms: 1 }) },
    {
      name: "RetryExhaustedError",
      instance: new RetryExhaustedError({ operation: "x", attempts: 1 }),
    },
    { name: "RateLimitError", instance: new RateLimitError({ retryAfterMs: 1 }) },
    {
      name: "CircuitBreakerOpenError",
      instance: new CircuitBreakerOpenError({ circuitName: "x" }),
    },
    { name: "CompensationError", instance: new CompensationError({ step: "x" }) },
    { name: "UnexpectedError", instance: new UnexpectedError({ cause: "x" }) },
  ];
}

describe("spine integrity", () => {
  it("every awaitly-system error has all three spine fields populated", () => {
    for (const { name, instance } of buildSystemErrors()) {
      expect(typeof instance.code, `${name}.code missing`).toBe("string");
      expect(typeof instance.hint, `${name}.hint missing`).toBe("string");
      expect(typeof instance.docsUrl, `${name}.docsUrl missing`).toBe("string");
    }
  });

  it("every awaitly-system error's code is in slugs.ts", () => {
    for (const { name, instance } of buildSystemErrors()) {
      expect(isAwaitlySlug(instance.code!), `${name}.code not a registered slug`).toBe(true);
    }
  });

  it("every awaitly-system error's docsUrl is canonical", () => {
    for (const { name, instance } of buildSystemErrors()) {
      expect(instance.docsUrl, `${name}.docsUrl wrong`).toBe(
        `https://awaitly.dev/rules/${instance.code}`
      );
    }
  });

  it("every awaitly-system error's hint is non-empty and short", () => {
    for (const { name, instance } of buildSystemErrors()) {
      expect(instance.hint!.length, `${name}.hint empty`).toBeGreaterThan(0);
      expect(instance.hint!.length, `${name}.hint too long`).toBeLessThanOrEqual(160);
    }
  });

  it("the runtime-* slugs covered by system errors match the roster size", () => {
    const runtimeSlugsInRoster = new Set(
      buildSystemErrors().map((e) => e.instance.code)
    );
    const runtimeSlugsInNamespace = ALL_SLUGS.filter((s) => s.startsWith("runtime-"));
    // The roster covers exactly the runtime slugs that this plan migrates.
    // runtime-step-timeout, runtime-step-aborted, runtime-resolver-not-found
    // are intentionally NOT yet wired up — they're follow-on plan scope.
    const expectedCovered = [
      "runtime-retry-exhausted",
      "runtime-rate-limit",
      "runtime-circuit-open",
      "runtime-saga-compensation",
      "runtime-unexpected",
    ];
    for (const slug of expectedCovered) {
      expect(runtimeSlugsInRoster.has(slug as AwaitlySlug), `${slug} not in roster`).toBe(true);
    }
    // Sanity: runtime namespace has more slugs than the roster (others are follow-on).
    expect(runtimeSlugsInNamespace.length).toBeGreaterThanOrEqual(expectedCovered.length);
  });
});
```

Note: `TimeoutError` carries `runtime-step-timeout` even though `StepTimeoutError` (the type alias) is not yet migrated. The class-based `TimeoutError` IS a system error that participates in the spine; the type-alias `StepTimeoutError` migration is follow-on scope.

- [ ] **Step 2: Run the test**

Run: `pnpm --filter awaitly test src/spine-integrity.test.ts`

Expected output (final lines):
```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [ ] **Step 3: Run the full awaitly test suite to confirm nothing broke**

Run: `pnpm --filter awaitly test`

Expected: all suites pass. If anything in `errors.test.ts` or other files asserts on the precise shape of an error (e.g., `Object.keys(err).length === N`), that test may need updating. If a regression appears, inspect the failure and either:
- update the assertion to allow the new `code`/`hint`/`docsUrl` properties, or
- if the regression is unrelated, raise it before continuing.

- [ ] **Step 4: Commit**

```bash
git add packages/awaitly/src/spine-integrity.test.ts
git commit -m "test(awaitly): cross-cutting integrity test for AI-DX slug spine"
```

---

## Task 6: Document the breaking change

**Files:**
- Modify: `packages/awaitly/CHANGELOG.md`

- [ ] **Step 1: Read the current CHANGELOG entry style**

Run: `head -40 packages/awaitly/CHANGELOG.md`

Note the format used (likely keep-a-changelog or release-please style).

- [ ] **Step 2: Add the unreleased entry**

Prepend to the relevant section in `packages/awaitly/CHANGELOG.md` (under the next major-version heading, or `## Unreleased` if that's the project convention):

```markdown
### BREAKING CHANGES

- Pre-built awaitly-system errors now carry three new readonly fields: `code` (canonical slug), `hint` (one-line guidance), and `docsUrl`. Affects `TimeoutError`, `RetryExhaustedError`, `RateLimitError`, `CircuitBreakerOpenError`, `CompensationError`, and `UnexpectedError`. Code that does shallow equality on error instances (`Object.keys(err).length`, snapshot tests) must update.
- `TaggedError` factory accepts new optional `slug` and `hint` options. User-defined `TaggedError` subclasses are unaffected unless they opt in.

### Added

- `awaitly/slugs` module: source-of-truth slug namespace with `AwaitlySlug` union type, `slugDocsUrl(code)`, `isAwaitlySlug(s)`, `slugCategory(s)`, `ALL_SLUGS`, `AWAITLY_SLUGS`. Re-exported from the package root.
- Foundational layer for the AI-friendly redesign (see docs/superpowers/specs/2026-05-09-ai-friendly-redesign-design.md).
```

- [ ] **Step 3: Commit**

```bash
git add packages/awaitly/CHANGELOG.md
git commit -m "docs(awaitly): changelog entry for slug spine foundation"
```

---

## Self-Review Notes

Spec coverage check (against the foundation portion of the spec):
- ✅ `slugs.ts` source-of-truth namespace: Task 1
- ✅ `TaggedError` extension to carry spine fields: Task 2
- ✅ Pre-built awaitly-system errors carry slug/hint/docsUrl: Task 3
- ✅ Public-surface re-exports: Task 4
- ✅ Cross-cutting integrity test: Task 5
- ✅ Documented breaking change: Task 6
- ❌ `StepTimeoutError` migration (type alias → class): explicitly deferred to follow-on plan
- ❌ `ResolverNotFoundError`, `SagaCompensationError`: not in `errors.ts` — live in `resolver.ts` and `saga.ts`. Deferred.

Type consistency check: `AwaitlySlug` is used identically across all tasks. The `TaggedError` `slug` option type, the `code` instance field, the slugs union, and the `isAwaitlySlug` guard all reference the same source.

Placeholder scan: no TBD/TODO/etc. found. Each step has runnable code or commands.

---

## Follow-on plans (not in this plan)

Each is independently shippable once this foundation lands.

1. **`StepTimeoutError` class migration** — convert the `{ type: "STEP_TIMEOUT" }` object shape to a `TaggedError` class with slug `runtime-step-timeout`. Update `core/index.ts`, marker handling, and all `.type === "STEP_TIMEOUT"` consumers. Touches the largest awaitly internals.
2. **`ResolverNotFoundError` and `SagaCompensationError` slug migration** — assigns `runtime-resolver-not-found` and `runtime-saga-compensation` (or similar) to the existing classes in `resolver.ts` / `saga.ts`.
3. **ESLint plugin slug rename + new rules** — rename ten existing rules to slugs, add ten new rules.
4. **`awaitly-analyze` slug-keyed diagnostics** — strict-diagnostics emits `{ code: AwaitlySlug, ... }`.
5. **`awaitly-visualizer` error event variant** — new event type carrying `code`.
6. **Skill catalogue split** — `awaitly-patterns/SKILL.md` → `SKILL.md` + `rules/<slug>.md`.
7. **Docs site generator** — generates `awaitly.dev/rules/<slug>` pages from `slugs.ts` + skill rule frontmatter.
