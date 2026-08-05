import { describe, expect, it } from "vitest";
import { ok, err, type AsyncResult } from "./index";
import { createWorkflow } from "./workflow";

type User = { id: string; name: string };

const getUser = async (id: string): AsyncResult<User, "NOT_FOUND"> =>
  id === "1" ? ok({ id: "1", name: "Alice" }) : err("NOT_FOUND");

describe("createWorkflow(deps) — anonymous, deps-first", () => {
  it("runs and infers errors identically to the named form", async () => {
    const wf = createWorkflow({ getUser });

    expect(await wf.run(async ({ steps }) => steps.getUser("1"))).toEqual({
      ok: true,
      value: { id: "1", name: "Alice" },
    });
    expect(await wf.run(async ({ steps }) => steps.getUser("nope"))).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });

  it("accepts options in the second position", async () => {
    const seen: string[] = [];
    const wf = createWorkflow({ getUser }, { onEvent: (e) => seen.push(e.type) });

    await wf.run(async ({ steps }) => steps.getUser("1"));
    expect(seen).toContain("step_success");
  });

  it("leaves workflowName undefined on emitted events", async () => {
    const names: unknown[] = [];
    const wf = createWorkflow({ getUser }, {
      onEvent: (e) => names.push((e as { workflowName?: string }).workflowName),
    });

    await wf.run(async ({ steps }) => steps.getUser("1"));
    expect(names.every((n) => n === undefined)).toBe(true);
  });

  it("still sets workflowName when a name is given", async () => {
    const names = new Set<unknown>();
    const wf = createWorkflow("checkout", { getUser }, {
      onEvent: (e) => names.add((e as { workflowName?: string }).workflowName),
    });

    await wf.run(async ({ steps }) => steps.getUser("1"));
    expect([...names]).toEqual(["checkout"]);
  });

  it("rejects an empty name and a non-object first argument", () => {
    expect(() => createWorkflow("")).toThrow(/non-empty string/);
    // @ts-expect-error — deliberately wrong call shape
    expect(() => createWorkflow(42)).toThrow(/deps object or a workflow name/);
  });
});
