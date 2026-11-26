/**
 * step.allSettled: every operation is a tracked step, every returned err is
 * kept, and everything else still ends the run.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { type AsyncResult, err, ok, partition, run, UnexpectedError, type WorkflowEvent } from "./index";
import { durable, type SnapshotStore } from "./durable";
import type { WorkflowSnapshot } from "./persistence";
import { createWorkflow } from "./workflow";

type NameRequired = { type: "NAME_REQUIRED" };
type TooYoung = { type: "TOO_YOUNG"; minimum: number };
type NotFound = { type: "NOT_FOUND" };

const getUser = async (id: string): AsyncResult<{ name: string; age: number }, NotFound> =>
  id === "1" ? ok({ name: "", age: 17 }) : err({ type: "NOT_FOUND" });
const checkName = async (name: string): AsyncResult<string, NameRequired> =>
  name ? ok(name) : err({ type: "NAME_REQUIRED" });
const checkAge = async (age: number): AsyncResult<number, TooYoung> =>
  age >= 18 ? ok(age) : err({ type: "TOO_YOUNG", minimum: 18 });
const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const preview = (name: string, age: number, onEvent?: (e: WorkflowEvent<unknown>) => void) =>
  run({ getUser }, async (s, { step }) => {
    await s.getUser("1");
    return step.allSettled("checks", {
      name: () => checkName(name),
      age: () => checkAge(age),
    });
  }, { onEvent });

describe("step.allSettled", () => {
  it("keeps every failure, in declaration order, and the run succeeds", async () => {
    const result = await run({ getUser }, async (_s, { step }) =>
      step.allSettled("checks", {
        name: async () => { await later(10); return checkName(""); },
        age: () => checkAge(17),
      })
    );
    expect(result).toEqual(
      ok({ values: {}, errors: [{ type: "NAME_REQUIRED" }, { type: "TOO_YOUNG", minimum: 18 }] })
    );
  });

  it("returns the values that succeeded by key", async () => {
    const result = await preview("Ada", 17);
    expect(result).toEqual(ok({ values: { name: "Ada" }, errors: [{ type: "TOO_YOUNG", minimum: 18 }] }));
  });

  it("returns no errors when everything passes, and accepts no operations", async () => {
    expect(await preview("Ada", 18)).toEqual(ok({ values: { name: "Ada", age: 18 }, errors: [] }));
    expect(await run(async ({ step }) => step.allSettled("none", {}))).toEqual(ok({ values: {}, errors: [] }));
  });

  it("types errors as the union of the operations and keeps them out of the run's union", async () => {
    const result = await preview("Ada", 18);
    if (!result.ok) {
      expectTypeOf(result.error).toEqualTypeOf<NotFound | UnexpectedError>();
      return;
    }
    expectTypeOf(result.value.errors).toEqualTypeOf<(NameRequired | TooYoung)[]>();
    expectTypeOf(result.value.values).toEqualTypeOf<{ name?: string; age?: number }>();
  });

  it("runs each operation as a step inside an allSettled scope", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    await preview("Ada", 17, (e) => events.push(e));
    const scope = events.find((e) => e.type === "scope_start");
    expect(scope).toMatchObject({ scopeType: "allSettled", name: "checks" });
    expect(events.filter((e) => e.type === "scope_end")).toHaveLength(1);
    expect(events.filter((e) => e.type === "step_success").map((e) => e.name)).toEqual(["getUser", "checks.name"]);
    expect(events.filter((e) => e.type === "step_error").map((e) => e.name)).toEqual(["checks.age"]);
  });

  it("ends the run when an operation throws, after the others finish", async () => {
    let finished = false;
    const result = await run(async ({ step }) =>
      step.allSettled("checks", {
        crash: async (): AsyncResult<number, TooYoung> => { throw new Error("boom"); },
        slow: async () => { await later(10); finished = true; return ok(1); },
      })
    );
    expect(finished).toBe(true);
    expect(!result.ok && result.error).toBeInstanceOf(UnexpectedError);
  });

  it("ends the run with the error of a step that exits inside an operation", async () => {
    const result = await run({ getUser }, async (s, { step }) =>
      step.allSettled("checks", {
        user: async () => { const u = await s.getUser("2"); return checkAge(u.age); },
        age: () => checkAge(17),
      })
    );
    expect(result).toMatchObject({ ok: false, error: { type: "NOT_FOUND" } });
  });

  it("rejects a missing name and a non-object", async () => {
    const bad = await run(async ({ step }) => step.allSettled("" as string, {}));
    expect(!bad.ok && String((bad.error as UnexpectedError).cause)).toContain("first argument must be a string");
    const arr = await run(async ({ step }) => step.allSettled("x", [] as never));
    expect(!arr.ok && String((arr.error as UnexpectedError).cause)).toContain("object of operations");
  });

  it("accepts partition's shape for the same checks", async () => {
    const { errors } = partition([await checkName(""), await checkAge(17)]);
    const result = await preview("", 17);
    expect(result.ok && result.value.errors).toEqual(errors);
  });
});

describe("step.allSettled in createWorkflow", () => {
  const cached = () => {
    const calls: string[] = [];
    const wf = createWorkflow("wf", {
      getUser,
      checkName: async (n: string) => { calls.push("name"); return checkName(n); },
      checkAge: async (a: number) => { calls.push("age"); return checkAge(a); },
    }, { cache: new Map() });
    return { calls, wf };
  };

  it("caches each operation, failures included, and replays the same outcome", async () => {
    const { calls, wf } = cached();
    const once = () =>
      wf.run(async ({ step, deps }) =>
        step.allSettled("checks", { name: () => deps.checkName("Ada"), age: () => deps.checkAge(17) })
      );
    const first = await once();
    expect(first).toEqual(ok({ values: { name: "Ada" }, errors: [{ type: "TOO_YOUNG", minimum: 18 }] }));
    expect(await once()).toEqual(first);
    expect(calls).toEqual(["name", "age"]);
  });

  it("replays a nested exit as an exit, not as a collected failure", async () => {
    const { wf } = cached();
    const once = () =>
      wf.run(async ({ step, deps }) =>
        step.allSettled("checks", {
          user: async () => { const u = await step("load", () => deps.getUser("2")); return checkAge(u.age); },
        })
      );
    expect(await once()).toMatchObject({ ok: false, error: { type: "NOT_FOUND" } });
    expect(await once()).toMatchObject({ ok: false, error: { type: "NOT_FOUND" } });
  });

  it("keeps groups and loop iterations apart with key", async () => {
    const { wf } = cached();
    const result = await wf.run(async ({ step, deps }) => {
      const out: number[] = [];
      for (const age of [17, 18]) {
        const { errors } = await step.allSettled("checks", { age: () => deps.checkAge(age) }, { key: `age-${age}` });
        out.push(errors.length);
      }
      const other = await step.allSettled("again", { age: () => deps.checkAge(17) });
      return [...out, other.errors.length];
    });
    expect(result).toEqual(ok([1, 0, 1]));
  });

  it("keys by iteration inside step.forEach", async () => {
    const { wf } = cached();
    const result = await wf.run(async ({ step, deps }) =>
      step.forEach("people", [17, 18], {
        maxIterations: 5,
        run: async (age) => (await step.allSettled("checks", { age: () => deps.checkAge(age) })).errors.length,
      })
    );
    expect(result).toEqual(ok([1, 0]));
  });
});

describe("step.allSettled in durable.run", () => {
  it("resumes without repeating checks that already ran", async () => {
    const snapshots = new Map<string, WorkflowSnapshot>();
    const store: SnapshotStore = {
      save: async (id, snapshot) => void snapshots.set(id, structuredClone(snapshot)),
      load: async (id) => snapshots.get(id) ?? null,
      delete: async (id) => void snapshots.delete(id),
      list: async () => [],
      close: async () => {},
    };
    const calls: string[] = [];
    let crash = true;
    const deps = {
      checkName: async (n: string) => { calls.push("name"); return checkName(n); },
      checkAge: async (a: number) => { calls.push("age"); return checkAge(a); },
      finish: async (): AsyncResult<string, never> => {
        if (crash) throw new Error("crash");
        return ok("done");
      },
    };
    const go = () =>
      durable.run(deps, async ({ step, deps: d }) => {
        const { errors } = await step.allSettled("checks", { name: () => d.checkName("Ada"), age: () => d.checkAge(17) });
        await step("finish", () => d.finish());
        return errors;
      }, { id: "settled", store });

    expect((await go()).ok).toBe(false);
    crash = false;
    expect(await go()).toEqual(ok([{ type: "TOO_YOUNG", minimum: 18 }]));
    expect(calls).toEqual(["name", "age"]);
  });
});
