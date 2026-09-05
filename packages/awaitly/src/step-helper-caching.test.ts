/**
 * Caching and checkpointing for the step helpers.
 *
 * Mutation testing reported the cache paths of `step.fromResult` and
 * `step.withResource` uncovered: the hit branch, the miss event, and the
 * error-caching branch could all be deleted with the suite green. Under
 * `durable.run` those branches decide whether a resumed workflow redoes a
 * step or restores what it decided, which for a failed step is the difference
 * between retrying a charge and replaying its refusal.
 */

import { describe, it, expect, vi } from "vitest";
import { createWorkflow } from "./workflow";
import { createMemoryCache } from "./persistence";
import { ok, err, type AsyncResult } from "./core";
import type { WorkflowEvent } from "./workflow/types";

const cacheEvents = (events: WorkflowEvent<unknown>[]) =>
  events
    .filter((e) => e.type === "step_cache_hit" || e.type === "step_cache_miss")
    .map((e) => `${e.type}:${(e as { stepKey: string }).stepKey}`);

describe("step.fromResult caching", () => {
  it("runs once and restores the value on a second run under the same cache", async () => {
    const cache = createMemoryCache();
    const lookup = vi.fn(async (): AsyncResult<{ id: string }, "MISSING"> => ok({ id: "u1" }));

    const run = async () => {
      const workflow = createWorkflow("fetch", { lookup }, { cache });
      return workflow.run(async ({ step }) =>
        step.fromResult("lookup", () => lookup(), { error: "LOOKUP_FAILED" as const })
      );
    };

    const first = await run();
    const second = await run();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
    if (second.ok) expect(second.value).toEqual({ id: "u1" });
  });

  it("emits a miss then a hit for the same step key", async () => {
    const cache = createMemoryCache();
    const events: WorkflowEvent<unknown>[] = [];
    const lookup = async (): AsyncResult<string, "MISSING"> => ok("v");

    const run = async () => {
      const workflow = createWorkflow("fetch", { lookup }, { cache, onEvent: (e) => events.push(e) });
      return workflow.run(async ({ step }) =>
        step.fromResult("lookup", () => lookup(), { error: "LOOKUP_FAILED" as const })
      );
    };

    await run();
    await run();

    expect(cacheEvents(events)).toEqual(["step_cache_miss:lookup", "step_cache_hit:lookup"]);
  });

  it("caches a mapped failure so the second run replays it without re-running", async () => {
    const cache = createMemoryCache();
    const charge = vi.fn(async (): AsyncResult<never, "DECLINED"> => err("DECLINED"));

    const run = async () => {
      const workflow = createWorkflow("pay", { charge }, { cache });
      return workflow.run(async ({ step }) =>
        step.fromResult("charge", () => charge(), { error: "CHARGE_FAILED" as const })
      );
    };

    const first = await run();
    const second = await run();

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("CHARGE_FAILED");
    // A decided failure stays decided; re-running it would charge twice on a
    // step that already reported its outcome.
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it("maps the result error through onError before caching it", async () => {
    const cache = createMemoryCache();
    const charge = async (): AsyncResult<never, "DECLINED"> => err("DECLINED");

    const workflow = createWorkflow("pay", { charge }, { cache });
    const result = await workflow.run(async ({ step }) =>
      step.fromResult("charge", () => charge(), {
        onError: (e) => `mapped:${e}` as const,
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("mapped:DECLINED");
  });

  it("keys by an explicit key when one is given", async () => {
    const cache = createMemoryCache();
    const lookup = vi.fn(async (): AsyncResult<string, "MISSING"> => ok("v"));

    const run = async (key: string) => {
      const workflow = createWorkflow("fetch", { lookup }, { cache });
      return workflow.run(async ({ step }) =>
        step.fromResult("lookup", () => lookup(), { error: "E" as const, key })
      );
    };

    await run("tenant-a");
    await run("tenant-b");
    await run("tenant-a");

    // Two distinct keys mean two executions; the repeat of the first is a hit.
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});

describe("step.withResource caching", () => {
  it("acquires once, then restores the value without touching the resource", async () => {
    const cache = createMemoryCache();
    const acquire = vi.fn(async (): AsyncResult<{ db: string }, "CONNECT_FAILED"> => ok({ db: "conn" }));
    const use = vi.fn(async (): AsyncResult<string[], "QUERY_FAILED"> => ok(["row"]));
    const release = vi.fn();

    const run = async () => {
      const workflow = createWorkflow("query", { acquire, use }, { cache });
      return workflow.run(async ({ step }) =>
        step.withResource("query", { acquire, use, release })
      );
    };

    const first = await run();
    const second = await run();

    expect(first.ok).toBe(true);
    if (second.ok) expect(second.value).toEqual(["row"]);
    // The value is restored; the connection is not reopened and not re-closed.
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(use).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases the resource even when use fails, and caches the failure", async () => {
    const cache = createMemoryCache();
    const release = vi.fn();
    const use = vi.fn(async (): AsyncResult<never, "QUERY_FAILED"> => err("QUERY_FAILED"));

    const run = async () => {
      const workflow = createWorkflow("query", {}, { cache });
      return workflow.run(async ({ step }) =>
        step.withResource("query", {
          acquire: async () => ok({ db: "conn" }),
          use,
          release,
        })
      );
    };

    const first = await run();
    const second = await run();

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("QUERY_FAILED");
    expect(release).toHaveBeenCalledTimes(1);
    expect(use).toHaveBeenCalledTimes(1);
  });

  it("does not run use when acquire fails", async () => {
    const use = vi.fn(async (): AsyncResult<string, "QUERY_FAILED"> => ok("never"));
    const release = vi.fn();

    const workflow = createWorkflow("query", {}, { cache: createMemoryCache() });
    const result = await workflow.run(async ({ step }) =>
      step.withResource("query", {
        acquire: async (): AsyncResult<{ db: string }, "CONNECT_FAILED"> => err("CONNECT_FAILED"),
        use,
        release,
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("CONNECT_FAILED");
    expect(use).not.toHaveBeenCalled();
    // Nothing was acquired, so nothing is released.
    expect(release).not.toHaveBeenCalled();
  });

  it("emits a miss then a hit for the same resource step", async () => {
    const cache = createMemoryCache();
    const events: WorkflowEvent<unknown>[] = [];

    const run = async () => {
      const workflow = createWorkflow("query", {}, { cache, onEvent: (e) => events.push(e) });
      return workflow.run(async ({ step }) =>
        step.withResource("query", {
          acquire: async () => ok({ db: "conn" }),
          use: async () => ok("rows"),
          release: () => {},
        })
      );
    };

    await run();
    await run();

    expect(cacheEvents(events)).toEqual(["step_cache_miss:query", "step_cache_hit:query"]);
  });

  it("runs normally with no cache configured", async () => {
    const acquire = vi.fn(async (): AsyncResult<{ db: string }, "CONNECT_FAILED"> => ok({ db: "c" }));

    const workflow = createWorkflow("query", {});
    const result = await workflow.run(async ({ step }) =>
      step.withResource("query", {
        acquire,
        use: async () => ok("rows"),
        release: () => {},
      })
    );

    expect(result.ok).toBe(true);
    expect(acquire).toHaveBeenCalledTimes(1);
  });
});
