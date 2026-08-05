/**
 * Executable README examples.
 *
 * Every test here mirrors a snippet in the root README, named by its section.
 * The README is the first thing anyone reads, and nothing was compiling it —
 * which is how it came to document `strict: true` on the wrong object, carry
 * `as const` the type parameters no longer need, and call workflows with a
 * form removed two majors ago. If an example changes, change it here too; if
 * this file stops compiling, the README is wrong.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ok,
  err,
  run,
  match,
  createWorkflow,
  isUnexpectedError,
  type AsyncResult,
  type Errors,
  type Result,
  type StepCache,
} from "./index";

const __dirname = dirname(fileURLToPath(import.meta.url));

type User = { id: string; name: string };
type Order = { id: string; userId: string; total: number };
type Payment = { id: string; amount: number };

const getOrder = async (id: string): AsyncResult<Order, "ORDER_NOT_FOUND"> =>
  id === "o-1" ? ok({ id, userId: "u-1", total: 42 }) : err("ORDER_NOT_FOUND");

const getUser = async (id: string): AsyncResult<User, "USER_NOT_FOUND"> =>
  id === "u-1" ? ok({ id, name: "Alice" }) : err("USER_NOT_FOUND");

const charge = async (total: number): AsyncResult<Payment, "CHARGE_DECLINED"> =>
  total < 100 ? ok({ id: "p-1", amount: total }) : err("CHARGE_DECLINED");

describe("README: run() — Simple Composition", () => {
  it("unwraps ok values and exits early on err", async () => {
    const result = await run({ getOrder, getUser, charge }, async (s) => {
      const order = await s.getOrder("o-1");
      const user = await s.getUser(order.userId);
      expect(user.name).toBe("Alice");
      return await s.charge(order.total);
    });

    expect(result).toEqual({ ok: true, value: { id: "p-1", amount: 42 } });
  });

  it("short-circuits at the first err, skipping later steps", async () => {
    const laterStep = vi.fn(charge);

    const result = await run(
      { getOrder, getUser, charge: laterStep },
      async (s) => {
        const order = await s.getOrder("missing");
        return await s.charge(order.total);
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ORDER_NOT_FOUND");
    expect(laterStep).not.toHaveBeenCalled();
  });
});

describe("README: the explicit form, run(fn) with step('id', () => fn())", () => {
  it("takes the error union as a type parameter", async () => {
    type AllErrors = Errors<[typeof getOrder, typeof getUser, typeof charge]>;

    const result = await run<Payment, AllErrors>(async ({ step }) => {
      const order = await step("getOrder", () => getOrder("o-1"));
      const user = await step("getUser", () => getUser(order.userId));
      expect(user.name).toBe("Alice");
      return await step("charge", () => charge(order.total));
    });

    expect(result).toEqual({ ok: true, value: { id: "p-1", amount: 42 } });
  });

  it("still returns step errors at runtime when called with no type params", async () => {
    // The README's warning: the compiler types this error as UnexpectedError
    // alone, but the runtime value is the step's own error.
    const result = await run(async ({ step }) => {
      return await step("getOrder", () => getOrder("missing"));
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ORDER_NOT_FOUND");
  });
});

describe("README: UnexpectedError — The Safety Net", () => {
  it("catches a throw and exposes the original cause", async () => {
    const explodes = async (): AsyncResult<number, "NEVER"> => {
      throw new Error("SDK blew up");
    };

    const result = await run({ explodes }, async (s) => s.explodes());

    expect(result.ok).toBe(false);
    if (!result.ok && isUnexpectedError(result.error)) {
      expect((result.error.cause as { thrown?: Error }).thrown ?? result.error.cause)
        .toBeDefined();
    } else {
      throw new Error("expected an UnexpectedError");
    }
  });
});

describe("README: createWorkflow", () => {
  it("runs through workflow.run() with the bound steps object", async () => {
    const workflow = createWorkflow({ getUser, getOrder });

    const result = await workflow.run(async ({ steps }) => {
      const user = await steps.getUser("u-1");
      const order = await steps.getOrder("o-1");
      return { user, order };
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.user.name).toBe("Alice");
  });

  it("has no callable form — .run() is the only entry point", () => {
    const workflow = createWorkflow({ getUser });
    expect(typeof workflow).toBe("object");
    expect(typeof workflow.run).toBe("function");
    expect(typeof (workflow as unknown as () => void)).not.toBe("function");
  });
});

describe("README: Smart Caching (never double-charge)", () => {
  it("skips a keyed step whose result is already cached", async () => {
    const cache: StepCache = new Map<string, Result<unknown, unknown, unknown>>();
    const chargeCard = vi.fn(
      async (amount: number): AsyncResult<Payment, "DECLINED"> =>
        ok({ id: "p-1", amount })
    );

    const processPayment = createWorkflow("processPayment", { chargeCard }, { cache });
    const body = async ({ step, deps }: Parameters<Parameters<typeof processPayment.run>[0]>[0]) =>
      step("chargeCard", () => deps.chargeCard(42), { key: "charge:idem-1" });

    const first = await processPayment.run(body);
    const second = await processPayment.run(body);

    expect(first).toEqual({ ok: true, value: { id: "p-1", amount: 42 } });
    expect(second).toEqual({ ok: true, value: { id: "p-1", amount: 42 } });
    expect(chargeCard).toHaveBeenCalledTimes(1);
  });
});

describe("README: Closing the Error Union", () => {
  it("maps unexpected exceptions to a literal tag without `as const`", async () => {
    const explodes = async (): AsyncResult<number, "NEVER"> => {
      throw new Error("boom");
    };

    const workflow = createWorkflow({ explodes }, {
      catchUnexpected: (cause) => ({ type: "UNEXPECTED", cause }),
    });

    const result = await workflow.run(async ({ step, deps }) =>
      step("explodes", () => deps.explodes())
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ type: "UNEXPECTED" });
  });
});

describe("README: Declaring Extra Errors", () => {
  const fetchRow = async (id: string): AsyncResult<{ body: string }, "ROW_NOT_FOUND"> =>
    id === "1" ? ok({ body: '{"n":1}' }) : err("ROW_NOT_FOUND");

  it("lets step.try introduce an error no dep produces", async () => {
    const wf = createWorkflow("ingest", { fetchRow }, { errors: ["PARSE_FAILED"] });

    const result = await wf.run(async ({ step, deps }) => {
      const row = await step("fetchRow", () => deps.fetchRow("1"));
      return await step.try("parse", () => JSON.parse(row.body) as { n: number }, {
        error: "PARSE_FAILED",
      });
    });

    expect(result).toEqual({ ok: true, value: { n: 1 } });
  });

  it("surfaces the declared error when the throwing step fails", async () => {
    const wf = createWorkflow("ingest", { fetchRow }, { errors: ["PARSE_FAILED"] });

    const result = await wf.run(async ({ step, deps }) => {
      await step("fetchRow", () => deps.fetchRow("1"));
      return await step.try("parse", () => JSON.parse("nope") as { n: number }, {
        error: "PARSE_FAILED",
      });
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("PARSE_FAILED");
  });
});

describe("README: Common Patterns", () => {
  it("wraps throwing code with step.try — no `as const` on the error", async () => {
    const result = await run<{ n: number }, "HTTP_FAILED">(async ({ step }) => {
      return await step.try("fetch", async () => JSON.parse('{"n":1}') as { n: number }, {
        error: "HTTP_FAILED",
      });
    });

    expect(result).toEqual({ ok: true, value: { n: 1 } });
  });
});

describe("README: Mapping errors at the boundary", () => {
  type TaskNotFound = { type: "TASK_NOT_FOUND"; id: string };

  const loadTask = async (id: string): AsyncResult<{ id: string }, TaskNotFound> =>
    id === "t-1" ? ok({ id }) : err({ type: "TASK_NOT_FOUND", id });

  const toResponse = (result: Awaited<ReturnType<typeof runTask>>) =>
    match(result, {
      ok: (task) => ({ statusCode: 200, body: task }),
      TASK_NOT_FOUND: (e) => ({
        statusCode: 404,
        body: { message: `No task ${e.id}` },
      }),
      UnexpectedError: (e) => {
        void e.cause;
        return { statusCode: 500, body: { message: "Internal error" } };
      },
    });

  const runTask = (id: string) => run({ loadTask }, async (s) => s.loadTask(id));

  it("maps ok to 200", async () => {
    expect(toResponse(await runTask("t-1"))).toEqual({
      statusCode: 200,
      body: { id: "t-1" },
    });
  });

  it("maps a tagged error to 404 by its type", async () => {
    expect(toResponse(await runTask("missing"))).toEqual({
      statusCode: 404,
      body: { message: "No task missing" },
    });
  });
});

/**
 * Mechanical guards against the two shapes that went stale in the README
 * without anything noticing: a form removed two majors ago, and casts the
 * `const` type parameters made unnecessary.
 */
describe("README: no stale API shapes", () => {
  const readme = readFileSync(join(__dirname, "..", "README.md"), "utf8");
  const codeBlocks = [...readme.matchAll(/```typescript\n([\s\S]*?)```/g)].map((m) => m[1]!);

  it("never calls a workflow directly — createWorkflow returns an object", () => {
    // `await someWorkflow(async ({ step }) => ...)` was removed; it is
    // `someWorkflow.run(...)`. `run(...)` itself is a function, so it is exempt.
    const offenders = codeBlocks.flatMap((block, i) =>
      [...block.matchAll(/await\s+([A-Za-z_$][\w$]*)\((?:async\s*)?\(/g)]
        .map((m) => m[1]!)
        .filter((name) => !["run", "durable", "match", "expect", "Promise"].includes(name))
        .filter((name) => !/^[A-Z]/.test(name))
        .map((name) => `block ${i + 1}: await ${name}(...) — use ${name}.run(...)`)
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("has no `as const` on error declarations", () => {
    const offenders = codeBlocks.flatMap((block, i) =>
      block
        .split("\n")
        .filter((line) => /(errors?|catchUnexpected):/.test(line) && /as const/.test(line))
        .map((line) => `block ${i + 1}: ${line.trim()}`)
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
