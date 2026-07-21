import { describe, expect, it } from "vitest";

import { isUnexpectedError, ok, run, type AsyncResult } from "./index";
import { createWorkflow } from "./workflow-entry";

const fetchUser = async (id: string): AsyncResult<{ id: string }, "NOT_FOUND"> => ok({ id });

describe("declared graph validation", () => {
  it("allows declared step ids", async () => {
    const result = await run(
      async ({ step }) => {
        return step("fetchUser", () => fetchUser("1"));
      },
      { graph: ["fetchUser"] }
    );
    expect(result.ok).toBe(true);
  });

  it("fails the workflow on an undeclared step id", async () => {
    const result = await run(
      async ({ step }) => {
        return step("rogueStep", () => fetchUser("1"));
      },
      { graph: ["fetchUser"] }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isUnexpectedError(result.error)).toBe(true);
      if (isUnexpectedError(result.error)) {
        expect(String(result.error.cause)).toContain('"rogueStep" is not in the declared workflow graph');
      }
    }
  });

  it("accepts a DSL-shaped graph ({ states })", async () => {
    const result = await run(
      async ({ step }) => {
        return step("fetchUser", () => fetchUser("1"));
      },
      { graph: { states: [{ id: "fetchUser" }, { id: "initial" }] } }
    );
    expect(result.ok).toBe(true);
  });

  it("uses semanticId when a diagram node id has a collision suffix", async () => {
    const result = await run(
      async ({ step }) => step("start", () => fetchUser("1")),
      { graph: { states: [{ id: "start#2", semanticId: "start" }] } }
    );
    expect(result.ok).toBe(true);
  });

  it("matches {placeholder} patterns for per-item ids", async () => {
    const result = await run(
      async ({ step }) => {
        const a = await step("item-0", () => fetchUser("a"));
        const b = await step("item-1", () => fetchUser("b"));
        return [a, b];
      },
      { graph: ["item-{i}"] }
    );
    expect(result.ok).toBe(true);
  });

  it("validates decision ids from step.if", async () => {
    const result = await run(
      async ({ step }) => {
        if (step.if("rogue-decision", "cond", () => true)) return "a";
        return "b";
      },
      { graph: ["fetchUser"] }
    );
    expect(result.ok).toBe(false);
    if (!result.ok && isUnexpectedError(result.error)) {
      expect(String(result.error.cause)).toContain('decision id "rogue-decision"');
    }
  });

  describe("every step helper with an id enforces the graph", () => {
    const okOp = () => fetchUser("1");

    const helpers: Array<[string, (step: Parameters<Parameters<typeof run>[0]>[0]["step"]) => Promise<unknown>]> = [
      ["step", (step) => step("rogue", okOp)],
      ["step.try", (step) => step.try("rogue", () => 1, { error: "E" })],
      ["step.fromResult", (step) => step.fromResult("rogue", okOp, { error: "E" })],
      ["step.fromNullable", (step) => step.fromNullable("rogue", () => 1, () => "E")],
      ["step.retry", (step) => step.retry("rogue", okOp, { attempts: 1 })],
      ["step.withTimeout", (step) => step.withTimeout("rogue", okOp, { ms: 1000 })],
      ["step.sleep", (step) => step.sleep("rogue", 1)],
      ["step.workflow", (step) => step.workflow("rogue", okOp)],
      ["step.map", (step) => step.map("rogue", ["1"], (id) => fetchUser(id))],
      ["step.withFallback", (step) => step.withFallback("rogue", okOp, { fallback: okOp })],
      [
        "step.withResource",
        (step) =>
          step.withResource("rogue", {
            acquire: () => fetchUser("1"),
            use: () => fetchUser("2"),
            release: () => {},
          }),
      ],
    ];

    it.each(helpers)("%s rejects an undeclared id", async (_name, invoke) => {
      const result = await run(
        async ({ step }) => {
          return invoke(step);
        },
        { graph: ["allowed"] }
      );
      expect(result.ok).toBe(false);
    });

    it.each(helpers)("%s allows a declared id", async (_name, invoke) => {
      const result = await run(
        async ({ step }) => {
          return invoke(step);
        },
        { graph: ["rogue"] }
      );
      expect(result.ok).toBe(true);
    });
  });

  it("createWorkflow: creation-time graph enforced, per-run graph overrides", async () => {
    const workflow = createWorkflow("wf", { fetchUser }, { graph: ["fetchUser"] });

    const bad = await workflow.run(async ({ step, deps }) => {
      return step("rogueStep", () => deps.fetchUser("1"));
    });
    expect(bad.ok).toBe(false);

    const good = await workflow.run(
      async ({ step, deps }) => {
        return step("rogueStep", () => deps.fetchUser("1"));
      },
      { graph: ["rogueStep"] }
    );
    expect(good.ok).toBe(true);
  });
});
