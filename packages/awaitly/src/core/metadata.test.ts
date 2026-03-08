/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import {
  extractErrorTag,
  lookupErrorClassification,
  extractStepMetadata,
  type ErrorClassification,
  type StepOptions,
} from "./index.js";

// =============================================================================
// extractErrorTag
// =============================================================================

describe("extractErrorTag", () => {
  it("returns 'unknown' for null", () => {
    expect(extractErrorTag(null)).toBe("unknown");
  });

  it("returns 'unknown' for undefined", () => {
    expect(extractErrorTag(undefined)).toBe("unknown");
  });

  it("returns the string itself for a non-empty string", () => {
    expect(extractErrorTag("MY_ERROR")).toBe("MY_ERROR");
  });

  it("trims whitespace from strings", () => {
    expect(extractErrorTag("  MY_ERROR  ")).toBe("MY_ERROR");
  });

  it("returns 'unknown' for empty string", () => {
    expect(extractErrorTag("")).toBe("unknown");
  });

  it("returns 'unknown' for whitespace-only string", () => {
    expect(extractErrorTag("   ")).toBe("unknown");
  });

  it("extracts _tag from object (TaggedError pattern)", () => {
    expect(extractErrorTag({ _tag: "NotFound" })).toBe("NotFound");
  });

  it("extracts tag from object", () => {
    expect(extractErrorTag({ tag: "TIMEOUT" })).toBe("TIMEOUT");
  });

  it("extracts string code from object", () => {
    expect(extractErrorTag({ code: "ECONNRESET" })).toBe("ECONNRESET");
  });

  it("extracts numeric code from object", () => {
    expect(extractErrorTag({ code: 404 })).toBe("404");
  });

  it("extracts numeric code 0 from object", () => {
    expect(extractErrorTag({ code: 0 })).toBe("0");
  });

  it("extracts Error.name as fallback", () => {
    const e = new TypeError("bad type");
    expect(extractErrorTag(e)).toBe("TypeError");
  });

  it("returns Error.name for plain Error (fallback-grade — often too coarse)", () => {
    const e = new Error("something");
    expect(extractErrorTag(e)).toBe("Error");
  });

  it("returns 'unknown' for a plain object with no relevant fields", () => {
    expect(extractErrorTag({ foo: "bar" })).toBe("unknown");
  });

  it("returns 'unknown' for a number", () => {
    expect(extractErrorTag(42)).toBe("unknown");
  });

  it("returns 'unknown' for a boolean", () => {
    expect(extractErrorTag(true)).toBe("unknown");
  });

  // Priority tests
  describe("priority order", () => {
    it("_tag wins over tag", () => {
      expect(extractErrorTag({ _tag: "A", tag: "B", code: "C" })).toBe("A");
    });

    it("tag wins over code", () => {
      expect(extractErrorTag({ tag: "B", code: "C" })).toBe("B");
    });

    it("code wins over Error.name", () => {
      const e = new Error("fail");
      (e as unknown as Record<string, unknown>).code = "CUSTOM";
      expect(extractErrorTag(e)).toBe("CUSTOM");
    });

    it("falls through empty _tag to tag", () => {
      expect(extractErrorTag({ _tag: "  ", tag: "B" })).toBe("B");
    });

    it("falls through empty tag to code", () => {
      expect(extractErrorTag({ _tag: "", tag: "", code: "C" })).toBe("C");
    });
  });

  it("is case-sensitive", () => {
    expect(extractErrorTag({ _tag: "NotFound" })).toBe("NotFound");
    expect(extractErrorTag({ _tag: "notfound" })).toBe("notfound");
  });
});

// =============================================================================
// lookupErrorClassification
// =============================================================================

describe("lookupErrorClassification", () => {
  const meta: Record<string, ErrorClassification> = {
    NOT_FOUND: { retryable: false, severity: "business", description: "Not found" },
    TIMEOUT: { retryable: true, severity: "infrastructure" },
  };

  it("returns the matching classification", () => {
    expect(lookupErrorClassification("NOT_FOUND", meta)).toEqual({
      retryable: false,
      severity: "business",
      description: "Not found",
    });
  });

  it("returns undefined on miss", () => {
    expect(lookupErrorClassification("UNKNOWN_TAG", meta)).toBeUndefined();
  });

  it("returns undefined when errorMeta is undefined", () => {
    expect(lookupErrorClassification("NOT_FOUND", undefined)).toBeUndefined();
  });

  it("returns undefined when tag is empty", () => {
    expect(lookupErrorClassification("", meta)).toBeUndefined();
  });
});

// =============================================================================
// extractStepMetadata
// =============================================================================

describe("extractStepMetadata", () => {
  it("returns undefined when no metadata fields are set", () => {
    const opts: StepOptions = {};
    expect(extractStepMetadata(opts)).toBeUndefined();
  });

  it("returns undefined when arrays are empty", () => {
    const opts: StepOptions = {
      tags: [],
      stateChanges: [],
      emits: [],
      calls: [],
    };
    expect(extractStepMetadata(opts)).toBeUndefined();
  });

  it("returns metadata with only populated fields", () => {
    const opts: StepOptions = {
      intent: "charge customer",
      domain: "payments",
      tags: ["critical"],
    };
    const result = extractStepMetadata(opts);
    expect(result).toEqual({
      intent: "charge customer",
      domain: "payments",
      tags: ["critical"],
    });
    // Should NOT include owner, stateChanges, emits, calls
    expect(result).not.toHaveProperty("owner");
    expect(result).not.toHaveProperty("stateChanges");
    expect(result).not.toHaveProperty("emits");
    expect(result).not.toHaveProperty("calls");
  });

  it("returns all fields when all are populated", () => {
    const opts: StepOptions = {
      intent: "charge",
      domain: "payments",
      owner: "team-billing",
      tags: ["critical"],
      stateChanges: ["order.charged"],
      emits: ["payment.completed"],
      calls: ["stripe.charges.create"],
    };
    const result = extractStepMetadata(opts);
    expect(result).toEqual({
      intent: "charge",
      domain: "payments",
      owner: "team-billing",
      tags: ["critical"],
      stateChanges: ["order.charged"],
      emits: ["payment.completed"],
      calls: ["stripe.charges.create"],
    });
  });
});

// =============================================================================
// Integration tests: step event metadata & diagnostics
// =============================================================================

import { run } from "../workflow-entry";
import { ok, err, type WorkflowEvent, type AsyncResult } from "./index.js";

describe("step event metadata integration", () => {
  it("step events include metadata when StepOptions has agent metadata fields", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    await run(
      async ({ step }) => {
        await step("charge", () => ok("done"), {
          domain: "payments",
          intent: "charge customer",
          owner: "team-billing",
          tags: ["critical"],
        });
        return ok("success");
      },
      { onEvent: (e) => events.push(e) }
    );

    const startEvent = events.find((e) => e.type === "step_start");
    expect(startEvent).toBeDefined();
    expect((startEvent as any).metadata).toEqual({
      domain: "payments",
      intent: "charge customer",
      owner: "team-billing",
      tags: ["critical"],
    });

    const successEvent = events.find((e) => e.type === "step_success");
    expect(successEvent).toBeDefined();
    expect((successEvent as any).metadata).toEqual({
      domain: "payments",
      intent: "charge customer",
      owner: "team-billing",
      tags: ["critical"],
    });

    const completeEvent = events.find((e) => e.type === "step_complete");
    expect(completeEvent).toBeDefined();
    expect((completeEvent as any).metadata).toEqual({
      domain: "payments",
      intent: "charge customer",
      owner: "team-billing",
      tags: ["critical"],
    });
  });

  it("step events omit metadata when StepOptions has no agent metadata", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    await run(
      async ({ step }) => {
        await step("simple", () => ok("done"));
        return ok("success");
      },
      { onEvent: (e) => events.push(e) }
    );

    const startEvent = events.find((e) => e.type === "step_start");
    expect(startEvent).toBeDefined();
    expect((startEvent as any).metadata).toBeUndefined();

    const successEvent = events.find((e) => e.type === "step_success");
    expect((successEvent as any).metadata).toBeUndefined();
  });

  it("step_error events include diagnostics with correct tag and classification from errorMeta", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    await run(
      async ({ step }) => {
        await step(
          "failStep",
          (): AsyncResult<string, { _tag: string }> =>
            Promise.resolve(err({ _tag: "NOT_FOUND" })),
          {
            domain: "users",
            errorMeta: {
              NOT_FOUND: { retryable: false, severity: "business", description: "User not found" },
            },
          }
        );
        return ok("unreachable");
      },
      { onEvent: (e) => events.push(e) }
    );

    const errorEvent = events.find((e) => e.type === "step_error");
    expect(errorEvent).toBeDefined();
    const diag = (errorEvent as any).diagnostics;
    expect(diag).toBeDefined();
    expect(diag.tag).toBe("NOT_FOUND");
    expect(diag.origin).toBe("result");
    expect(diag.classification).toEqual({
      retryable: false,
      severity: "business",
      description: "User not found",
    });
    // metadata should also be present
    expect((errorEvent as any).metadata).toEqual({ domain: "users" });
  });

  it("step_retry events include diagnostics with attempt number and origin", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    let callCount = 0;
    await run(
      async ({ step }) => {
        await step(
          "retryStep",
          (): AsyncResult<string, string> => {
            callCount++;
            if (callCount < 3) return Promise.resolve(err("TRANSIENT"));
            return Promise.resolve(ok("done"));
          },
          {
            domain: "api",
            retry: { attempts: 3, initialDelay: 1 },
            errorMeta: {
              TRANSIENT: { retryable: true, severity: "infrastructure" },
            },
          }
        );
        return ok("success");
      },
      { onEvent: (e) => events.push(e) }
    );

    const retryEvents = events.filter((e) => e.type === "step_retry");
    expect(retryEvents.length).toBe(2);

    const firstRetry = retryEvents[0] as any;
    expect(firstRetry.diagnostics).toBeDefined();
    expect(firstRetry.diagnostics.tag).toBe("TRANSIENT");
    expect(firstRetry.diagnostics.origin).toBe("result");
    expect(firstRetry.diagnostics.attempt).toBe(1);
    expect(firstRetry.diagnostics.classification).toEqual({
      retryable: true,
      severity: "infrastructure",
    });
    expect(firstRetry.metadata).toEqual({ domain: "api" });

    const secondRetry = retryEvents[1] as any;
    expect(secondRetry.diagnostics.attempt).toBe(2);
  });

  it("step_retries_exhausted events include diagnostics", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    await run(
      async ({ step }) => {
        await step(
          "exhaustStep",
          (): AsyncResult<string, string> => Promise.resolve(err("FAIL")),
          {
            intent: "exhaust retries",
            retry: { attempts: 2, initialDelay: 1 },
            errorMeta: {
              FAIL: { retryable: true, severity: "infrastructure" },
            },
          }
        );
        return ok("unreachable");
      },
      { onEvent: (e) => events.push(e) }
    );

    const exhaustedEvent = events.find((e) => e.type === "step_retries_exhausted");
    expect(exhaustedEvent).toBeDefined();
    const diag = (exhaustedEvent as any).diagnostics;
    expect(diag).toBeDefined();
    expect(diag.tag).toBe("FAIL");
    expect(diag.origin).toBe("result");
    expect(diag.attempt).toBe(2);
    expect(typeof diag.cumulativeDurationMs).toBe("number");
    expect((exhaustedEvent as any).metadata).toEqual({ intent: "exhaust retries" });
  });

  it("step_timeout events include diagnostics with origin 'timeout'", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    await run(
      async ({ step }) => {
        await step(
          "slowStep",
          async (): AsyncResult<string, never> => {
            await new Promise((r) => setTimeout(r, 200));
            return ok("done");
          },
          {
            domain: "slow",
            timeout: { ms: 10 },
          }
        );
        return ok("unreachable");
      },
      { onEvent: (e) => events.push(e) }
    );

    const timeoutEvent = events.find((e) => e.type === "step_timeout");
    expect(timeoutEvent).toBeDefined();
    const diag = (timeoutEvent as any).diagnostics;
    expect(diag).toBeDefined();
    expect(diag.origin).toBe("timeout");
    expect(diag.attempt).toBe(1);
    expect((timeoutEvent as any).metadata).toEqual({ domain: "slow" });
  });

  it("step_error from thrown exception includes diagnostics with origin 'throw'", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    await run(
      async ({ step }) => {
        await step(
          "throwStep",
          () => {
            throw new TypeError("bad input");
          },
          {
            domain: "validation",
            errorMeta: {
              TypeError: { retryable: false, severity: "validation" },
            },
          }
        );
        return ok("unreachable");
      },
      { onEvent: (e) => events.push(e) }
    );

    const errorEvent = events.find((e) => e.type === "step_error");
    expect(errorEvent).toBeDefined();
    const diag = (errorEvent as any).diagnostics;
    expect(diag).toBeDefined();
    expect(diag.tag).toBe("TypeError");
    expect(diag.origin).toBe("throw");
    expect(diag.classification).toEqual({ retryable: false, severity: "validation" });
    expect((errorEvent as any).metadata).toEqual({ domain: "validation" });
  });
});
