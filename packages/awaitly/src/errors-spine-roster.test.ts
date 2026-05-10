import { describe, it, expect } from "vitest";
import {
  AWAITLY_SYSTEM_ERROR_CLASSES,
  TimeoutError,
  RetryExhaustedError,
  RateLimitError,
  CircuitBreakerOpenError,
  CompensationError,
  UnexpectedError,
} from "./errors";
import { isAwaitlySlug } from "./slugs";

describe("AWAITLY_SYSTEM_ERROR_CLASSES roster", () => {
  it("contains exactly the six awaitly-system error classes", () => {
    expect(AWAITLY_SYSTEM_ERROR_CLASSES).toHaveLength(6);
    expect(AWAITLY_SYSTEM_ERROR_CLASSES).toContain(TimeoutError);
    expect(AWAITLY_SYSTEM_ERROR_CLASSES).toContain(RetryExhaustedError);
    expect(AWAITLY_SYSTEM_ERROR_CLASSES).toContain(RateLimitError);
    expect(AWAITLY_SYSTEM_ERROR_CLASSES).toContain(CircuitBreakerOpenError);
    expect(AWAITLY_SYSTEM_ERROR_CLASSES).toContain(CompensationError);
    expect(AWAITLY_SYSTEM_ERROR_CLASSES).toContain(UnexpectedError);
  });

  it("each class produces an instance with a registered slug", () => {
    const samples: Array<
      [
        new (props: Record<string, unknown>) => unknown,
        Record<string, unknown>,
      ]
    > = [
      [TimeoutError, { operation: "x", ms: 1 }],
      [RetryExhaustedError, { operation: "x", attempts: 1 }],
      [RateLimitError, { retryAfterMs: 1 }],
      [CircuitBreakerOpenError, { circuitName: "x" }],
      [CompensationError, { step: "x" }],
      [UnexpectedError, { cause: "x" }],
    ];
    for (const [Cls, props] of samples) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const instance = new (Cls as any)(props) as {
        code?: string;
        hint?: string;
        docsUrl?: string;
      };
      expect(typeof instance.code).toBe("string");
      expect(isAwaitlySlug(instance.code!)).toBe(true);
      expect(typeof instance.hint).toBe("string");
      expect(instance.hint!.length).toBeGreaterThan(0);
      expect(typeof instance.docsUrl).toBe("string");
    }
  });
});
