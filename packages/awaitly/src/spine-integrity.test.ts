import { describe, it, expect } from "vitest";
import {
  TimeoutError,
  RetryExhaustedError,
  RateLimitError,
  CircuitBreakerOpenError,
  CompensationError,
  UnexpectedError,
  AWAITLY_SYSTEM_ERROR_CLASSES,
} from "./errors";
import { ALL_SLUGS, isAwaitlySlug, type AwaitlySlug } from "./slugs";

/**
 * Sample props for each awaitly-system error class. Keyed by class name so
 * the spine-integrity test can drive its instances directly from
 * AWAITLY_SYSTEM_ERROR_CLASSES — adding a new class to the roster requires
 * adding a sample here, otherwise instantiation throws.
 */
const SYSTEM_ERROR_SAMPLE_PROPS: Record<string, Record<string, unknown>> = {
  TimeoutError: { operation: "x", ms: 1 },
  RetryExhaustedError: { operation: "x", attempts: 1 },
  RateLimitError: { retryAfterMs: 1 },
  CircuitBreakerOpenError: { circuitName: "x" },
  CompensationError: { step: "x" },
  UnexpectedError: { cause: "x" },
};

function buildSystemErrors(): Array<{
  name: string;
  instance: Error & {
    code?: AwaitlySlug;
    hint?: string;
    docsUrl?: string;
  };
}> {
  return AWAITLY_SYSTEM_ERROR_CLASSES.map((Cls) => {
    const name = Cls.name;
    const props = SYSTEM_ERROR_SAMPLE_PROPS[name];
    if (!props) {
      throw new Error(
        `spine-integrity: missing sample props for ${name}. Add an entry to SYSTEM_ERROR_SAMPLE_PROPS.`
      );
    }
    return {
      name,
      instance: new Cls(props) as Error & {
        code?: AwaitlySlug;
        hint?: string;
        docsUrl?: string;
      },
    };
  });
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
      expect(
        isAwaitlySlug(instance.code!),
        `${name}.code not a registered slug`
      ).toBe(true);
    }
  });

  it("every awaitly-system error's docsUrl is canonical", () => {
    for (const { name, instance } of buildSystemErrors()) {
      expect(instance.docsUrl, `${name}.docsUrl wrong`).toBe(
        `https://jagreehal.github.io/awaitly/rules/#${instance.code}`
      );
    }
  });

  it("every awaitly-system error's hint is non-empty and short", () => {
    for (const { name, instance } of buildSystemErrors()) {
      expect(instance.hint!.length, `${name}.hint empty`).toBeGreaterThan(0);
      expect(instance.hint!.length, `${name}.hint too long`).toBeLessThanOrEqual(
        160
      );
    }
  });

  it("the runtime-* slugs covered by system errors match the roster expectations", () => {
    const runtimeSlugsInRoster = new Set(
      buildSystemErrors().map((e) => e.instance.code)
    );
    const runtimeSlugsInNamespace = ALL_SLUGS.filter((s) =>
      s.startsWith("runtime-")
    );
    const expectedCovered: AwaitlySlug[] = [
      "runtime-step-timeout",
      "runtime-retry-exhausted",
      "runtime-rate-limit",
      "runtime-circuit-open",
      "runtime-saga-compensation",
      "runtime-unexpected",
    ];
    for (const slug of expectedCovered) {
      expect(
        runtimeSlugsInRoster.has(slug),
        `${slug} not covered by any system error`
      ).toBe(true);
    }
    expect(runtimeSlugsInNamespace.length).toBeGreaterThanOrEqual(
      expectedCovered.length
    );
  });

  it("roster has exactly 6 entries (update SYSTEM_ERROR_SAMPLE_PROPS when adding)", () => {
    expect(AWAITLY_SYSTEM_ERROR_CLASSES).toHaveLength(6);
    for (const Cls of AWAITLY_SYSTEM_ERROR_CLASSES) {
      expect(
        SYSTEM_ERROR_SAMPLE_PROPS[Cls.name],
        `Missing SYSTEM_ERROR_SAMPLE_PROPS entry for ${Cls.name}`
      ).toBeDefined();
    }
  });
});

// Suppress unused-import warnings — these are referenced by SYSTEM_ERROR_SAMPLE_PROPS
// keys but not directly instantiated in non-roster paths.
void TimeoutError;
void RetryExhaustedError;
void RateLimitError;
void CircuitBreakerOpenError;
void CompensationError;
void UnexpectedError;
