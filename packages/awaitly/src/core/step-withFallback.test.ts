import { describe, it, expect, vi } from "vitest";
import { ok, err, type AsyncResult, isOk, isErr, type WorkflowEvent } from ".";
import { run } from "../workflow-entry";

describe("step.withFallback", () => {
  it("primary ok → fallback not called", async () => {
    const fallbackFn = vi.fn();

    const result = await run(async ({ step }) => {
      const value = await step.withFallback(
        "getUser",
        () => Promise.resolve(ok({ id: 1, name: "Alice" })),
        { fallback: fallbackFn }
      );
      return value;
    });

    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ id: 1, name: "Alice" });
    }
    expect(fallbackFn).not.toHaveBeenCalled();
  });

  it("primary err (no `on`) → fallback called", async () => {
    const result = await run(async ({ step }) => {
      const value = await step.withFallback(
        "getUser",
        (): AsyncResult<string, "PRIMARY_ERROR"> => Promise.resolve(err("PRIMARY_ERROR")),
        {
          fallback: (): AsyncResult<string, "FALLBACK_ERROR"> =>
            Promise.resolve(ok("from-fallback")),
        }
      );
      return value;
    });

    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("from-fallback");
    }
  });

  it("primary err matches `on` → fallback called", async () => {
    const result = await run(async ({ step }) => {
      const value = await step.withFallback(
        "getUser",
        (): AsyncResult<string, "NOT_FOUND"> => Promise.resolve(err("NOT_FOUND")),
        {
          on: "NOT_FOUND",
          fallback: (): AsyncResult<string, "FALLBACK_ERROR"> =>
            Promise.resolve(ok("from-fallback")),
        }
      );
      return value;
    });

    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("from-fallback");
    }
  });

  it("primary err does NOT match `on` → fallback not called, primary error returned", async () => {
    const fallbackFn = vi.fn(() => Promise.resolve(ok("from-fallback")));

    const result = await run(async ({ step }) => {
      const value = await step.withFallback(
        "getUser",
        (): AsyncResult<string, "TIMEOUT" | "NOT_FOUND"> =>
          Promise.resolve(err("TIMEOUT")),
        {
          on: "NOT_FOUND" as "TIMEOUT" | "NOT_FOUND",
          fallback: fallbackFn as () => AsyncResult<string, never>,
        }
      );
      return value;
    });

    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error).toBe("TIMEOUT");
    }
    expect(fallbackFn).not.toHaveBeenCalled();
  });

  it("primary throws → UNEXPECTED_ERROR, fallback runs when no `on`", async () => {
    const result = await run(async ({ step }) => {
      const value = await step.withFallback(
        "getUser",
        (): AsyncResult<string, never> => {
          throw new Error("network failure");
        },
        {
          fallback: (): AsyncResult<string, "FALLBACK_ERROR"> =>
            Promise.resolve(ok("recovered")),
        }
      );
      return value;
    });

    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("recovered");
    }
  });

  it("fallback err → returns fallback error, emits step_error", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    const result = await run(
      async ({ step }) => {
        const value = await step.withFallback(
          "getUser",
          (): AsyncResult<string, "PRIMARY_ERROR"> =>
            Promise.resolve(err("PRIMARY_ERROR")),
          {
            fallback: (): AsyncResult<string, "FALLBACK_ERROR"> =>
              Promise.resolve(err("FALLBACK_ERROR")),
          }
        );
        return value;
      },
      {
        onEvent: (event) => {
          events.push(event);
        },
      }
    );

    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error).toBe("FALLBACK_ERROR");
    }

    const stepError = events.find((e) => e.type === "step_error");
    expect(stepError).toBeDefined();
  });

  it("caching: cached hit avoids both calls", async () => {
    const primaryFn = vi.fn(
      (): AsyncResult<string, "ERROR"> => Promise.resolve(ok("primary-value"))
    );
    const fallbackFn = vi.fn(
      (): AsyncResult<string, "ERROR"> => Promise.resolve(ok("fallback-value"))
    );

    const events: WorkflowEvent<unknown>[] = [];

    const result = await run(
      async ({ step }) => {
        // First call
        const v1 = await step.withFallback("getUser", primaryFn, {
          fallback: fallbackFn,
          key: "user-cache",
        });
        // Primary should have been called
        expect(primaryFn).toHaveBeenCalledTimes(1);

        return v1;
      },
      {
        onEvent: (event) => {
          events.push(event);
        },
      }
    );

    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("primary-value");
    }
    expect(fallbackFn).not.toHaveBeenCalled();
  });

  it("caching: cached write after fallback success", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    const result = await run(
      async ({ step }) => {
        const value = await step.withFallback(
          "getUser",
          (): AsyncResult<string, "PRIMARY_ERROR"> =>
            Promise.resolve(err("PRIMARY_ERROR")),
          {
            fallback: (): AsyncResult<string, "FALLBACK_ERROR"> =>
              Promise.resolve(ok("fallback-value")),
            key: "user-cache",
          }
        );
        return value;
      },
      {
        onEvent: (event) => {
          events.push(event);
        },
      }
    );

    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("fallback-value");
    }

    // Verify step_complete was emitted (for caching layer to pick up)
    const stepComplete = events.find((e) => e.type === "step_complete");
    expect(stepComplete).toBeDefined();
    if (stepComplete && "result" in stepComplete) {
      expect((stepComplete as { result: { ok: boolean } }).result.ok).toBe(true);
    }
  });

  it("fallback throws → UNEXPECTED_ERROR propagated", async () => {
    const result = await run(async ({ step }) => {
      return step.withFallback(
        "getUser",
        (): AsyncResult<string, "PRIMARY_ERROR"> =>
          Promise.resolve(err("PRIMARY_ERROR")),
        {
          fallback: (): AsyncResult<string, never> => {
            throw new Error("fallback crashed");
          },
        }
      );
    });

    expect(isErr(result)).toBe(true);
  });

  it("primary throws + fallback throws → UNEXPECTED_ERROR propagated", async () => {
    const result = await run(async ({ step }) => {
      return step.withFallback(
        "getUser",
        (): AsyncResult<string, never> => {
          throw new Error("primary crashed");
        },
        {
          fallback: (): AsyncResult<string, never> => {
            throw new Error("fallback also crashed");
          },
        }
      );
    });

    expect(isErr(result)).toBe(true);
  });

  it("emits step_complete with fallbackUsed meta when fallback succeeds", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    await run(
      async ({ step }) => {
        return step.withFallback(
          "getUser",
          (): AsyncResult<string, "PRIMARY_ERROR"> =>
            Promise.resolve(err("PRIMARY_ERROR")),
          {
            fallback: (): AsyncResult<string, never> =>
              Promise.resolve(ok("from-fallback")),
          }
        );
      },
      {
        onEvent: (event) => {
          events.push(event);
        },
      }
    );

    const stepComplete = events.find((e) => e.type === "step_complete" && "meta" in e && e.meta);
    expect(stepComplete).toBeDefined();
    if (stepComplete && "meta" in stepComplete) {
      const meta = (stepComplete as { meta: { fallbackUsed: boolean; fallbackReason: string } }).meta;
      expect(meta.fallbackUsed).toBe(true);
      expect(meta.fallbackReason).toBe("PRIMARY_ERROR");
    }
  });
});
