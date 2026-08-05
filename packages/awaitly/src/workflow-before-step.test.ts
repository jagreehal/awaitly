import { describe, expect, it } from "vitest";
import { ok, err, type AsyncResult, type RunStep } from "./core";
import { createWorkflow } from "./workflow";

const getUser = async (id: string): AsyncResult<{ id: string }, "NOT_FOUND"> =>
  id === "x" ? err("NOT_FOUND") : ok({ id });

describe("onBeforeStep", () => {
  it("fires before each step, in execution order", async () => {
    const seen: string[] = [];
    const wf = createWorkflow({ getUser }, { onBeforeStep: (k) => void seen.push(k) });

    await wf.run(async ({ step, deps }) => {
      await step("first", () => deps.getUser("1"));
      await step("second", () => deps.getUser("2"));
      return null;
    });

    expect(seen).toEqual(["first", "second"]);
  });

  it("fires before the operation runs, not after", async () => {
    const order: string[] = [];
    const wf = createWorkflow(
      { getUser },
      { onBeforeStep: (k) => void order.push(`before:${k}`) }
    );

    await wf.run(async ({ step }) => {
      await step("fetch", async () => {
        order.push("operation");
        return ok(1);
      });
      return null;
    });

    expect(order).toEqual(["before:fetch", "operation"]);
  });

  it("fires for a cached step, before the cached value is read", async () => {
    const cache = new Map();
    const seen: string[] = [];
    let executions = 0;

    const wf = createWorkflow(
      { getUser },
      { cache, onBeforeStep: (k) => void seen.push(k) }
    );

    const body = async ({ step }: { step: RunStep }) => {
      await step("fetch", async () => {
        executions++;
        return ok(1);
      }, { key: "k1" });
      return null;
    };

    await wf.run(body);
    await wf.run(body);

    // Second run is served from cache — the operation did not re-run, but the
    // hook still fired, which is what lets a caller veto a stale value.
    expect(executions).toBe(1);
    expect(seen).toEqual(["k1", "k1"]);
  });

  it("aborts the step and fails the run when it throws", async () => {
    let executed = false;
    const wf = createWorkflow({ getUser }, {
      onBeforeStep: (k) => {
        if (k === "blocked") throw new Error("vetoed");
      },
    });

    const result = await wf.run(async ({ step }) => {
      await step("blocked", async () => {
        executed = true;
        return ok(1);
      });
      return "unreachable";
    });

    expect(executed).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("can be supplied per-run and overrides the creation-time hook", async () => {
    const creation: string[] = [];
    const perRun: string[] = [];
    const wf = createWorkflow({ getUser }, { onBeforeStep: (k) => void creation.push(k) });

    await wf.run(
      async ({ step, deps }) => {
        await step("fetch", () => deps.getUser("1"));
        return null;
      },
      { onBeforeStep: (k) => void perRun.push(k) }
    );

    expect(perRun).toEqual(["fetch"]);
    expect(creation).toEqual([]);
  });

  // Regression: step.try / step.fromResult / step.withFallback implement their
  // own cache lookup instead of delegating to the main step function, so they
  // silently skipped the hook — letting a resumed value through the durable
  // shape guard. Every helper that can read a cached value is covered here.
  describe("fires for every step helper", () => {
    const helpers: Array<[string, (step: RunStep) => Promise<unknown>]> = [
      ["step", (step) => step("h", async () => ok(1))],
      ["step.try", (step) => step.try("h", async () => 1, { error: "E" as const })],
      ["step.fromResult", (step) => step.fromResult("h", async () => ok(1), { error: "E" as const })],
      ["step.withFallback", (step) => step.withFallback("h", async () => err("X"), () => 2)],
      ["step.retry", (step) => step.retry("h", async () => ok(1), { attempts: 1 })],
      ["step.withTimeout", (step) => step.withTimeout("h", async () => ok(1), { ms: 1000 })],
    ];

    for (const [label, invoke] of helpers) {
      it(`${label} runs the hook`, async () => {
        const seen: string[] = [];
        const wf = createWorkflow({ getUser }, { onBeforeStep: (k) => void seen.push(k) });

        await wf.run(async ({ step }) => {
          await invoke(step);
          return null;
        });

        expect(seen, `${label} did not run onBeforeStep`).toContain("h");
      });

      it(`${label} runs the hook before reading a cached value`, async () => {
        const cache = new Map();
        const seen: string[] = [];
        const wf = createWorkflow(
          { getUser },
          { cache, onBeforeStep: (k) => void seen.push(k) }
        );
        const body = async ({ step }: { step: RunStep }) => {
          await invoke(step);
          return null;
        };

        await wf.run(body);
        const afterFirst = seen.length;
        await wf.run(body);

        // The second run may be served from cache; the hook must still fire,
        // which is what lets a caller veto a stale value.
        expect(seen.length, `${label} skipped the hook on the cached path`).toBeGreaterThan(
          afterFirst - 1
        );
        expect(seen.filter((k) => k === "h").length).toBeGreaterThanOrEqual(2);
      });
    }
  });
});
