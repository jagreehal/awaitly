import { describe, it, expect, vi } from "vitest";
import { ok, err, type AsyncResult, isOk, isErr, type WorkflowEvent } from ".";
import { run } from "../workflow-entry";

describe("step.withResource", () => {
  it("acquire ok, use ok → release called, returns use value", async () => {
    const releaseFn = vi.fn();

    const result = await run(async ({ step }) => {
      const value = await step.withResource("useDb", {
        acquire: (): AsyncResult<{ conn: string }, never> =>
          Promise.resolve(ok({ conn: "db-connection" })),
        use: (db): AsyncResult<string, never> =>
          Promise.resolve(ok(`queried-${db.conn}`)),
        release: releaseFn,
      });
      return value;
    });

    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("queried-db-connection");
    }
    expect(releaseFn).toHaveBeenCalledTimes(1);
    expect(releaseFn).toHaveBeenCalledWith({ conn: "db-connection" });
  });

  it("acquire err → use/release NOT called, step_error emitted", async () => {
    const useFn = vi.fn();
    const releaseFn = vi.fn();
    const events: WorkflowEvent<unknown>[] = [];

    const result = await run(
      async ({ step }) => {
        const value = await step.withResource("useDb", {
          acquire: (): AsyncResult<string, "CONNECT_FAILED"> =>
            Promise.resolve(err("CONNECT_FAILED")),
          use: useFn as (resource: string) => AsyncResult<string, never>,
          release: releaseFn,
        });
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
      expect(result.error).toBe("CONNECT_FAILED");
    }
    expect(useFn).not.toHaveBeenCalled();
    expect(releaseFn).not.toHaveBeenCalled();

    const stepError = events.find((e) => e.type === "step_error");
    expect(stepError).toBeDefined();
  });

  it("use err → release called once, error propagated", async () => {
    const releaseFn = vi.fn();

    const result = await run(async ({ step }) => {
      const value = await step.withResource("useDb", {
        acquire: (): AsyncResult<string, never> =>
          Promise.resolve(ok("db-conn")),
        use: (): AsyncResult<string, "QUERY_FAILED"> =>
          Promise.resolve(err("QUERY_FAILED")),
        release: releaseFn,
      });
      return value;
    });

    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error).toBe("QUERY_FAILED");
    }
    expect(releaseFn).toHaveBeenCalledTimes(1);
    expect(releaseFn).toHaveBeenCalledWith("db-conn");
  });

  it("use throws → release called once, error mapped to UNEXPECTED_ERROR", async () => {
    const releaseFn = vi.fn();

    const result = await run(async ({ step }) => {
      const value = await step.withResource("useDb", {
        acquire: (): AsyncResult<string, never> =>
          Promise.resolve(ok("db-conn")),
        use: (): AsyncResult<string, never> => {
          throw new Error("unexpected crash");
        },
        release: releaseFn,
      });
      return value;
    });

    expect(isErr(result)).toBe(true);
    expect(releaseFn).toHaveBeenCalledTimes(1);
    expect(releaseFn).toHaveBeenCalledWith("db-conn");
  });

  it("release throws after use ok → still returns ok, logs warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await run(async ({ step }) => {
      const value = await step.withResource("useDb", {
        acquire: (): AsyncResult<string, never> =>
          Promise.resolve(ok("db-conn")),
        use: (): AsyncResult<string, never> =>
          Promise.resolve(ok("success-value")),
        release: () => {
          throw new Error("release failed");
        },
      });
      return value;
    });

    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("success-value");
    }
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("release throws after use err → returns use err, logs warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await run(async ({ step }) => {
      const value = await step.withResource("useDb", {
        acquire: (): AsyncResult<string, never> =>
          Promise.resolve(ok("db-conn")),
        use: (): AsyncResult<string, "QUERY_FAILED"> =>
          Promise.resolve(err("QUERY_FAILED")),
        release: () => {
          throw new Error("release failed");
        },
      });
      return value;
    });

    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error).toBe("QUERY_FAILED");
    }
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("acquire throws → use/release NOT called, error propagated", async () => {
    const useFn = vi.fn();
    const releaseFn = vi.fn();

    const result = await run(async ({ step }) => {
      const value = await step.withResource("useDb", {
        acquire: (): AsyncResult<string, never> => {
          throw new Error("connection refused");
        },
        use: useFn as (resource: string) => AsyncResult<string, never>,
        release: releaseFn,
      });
      return value;
    });

    expect(isErr(result)).toBe(true);
    expect(useFn).not.toHaveBeenCalled();
    expect(releaseFn).not.toHaveBeenCalled();
  });
});
