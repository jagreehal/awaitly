/**
 * Tests for the XState MachineJSON renderer.
 *
 * These pin the shape `machineFromJSON` accepts (object transitions,
 * `xstate.done.state` for parallel completion) and check that every
 * definition is a connected machine: each `#target` names a state and each
 * state is reachable from the initial one.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter, renderMachineJSON } from "../index";
import type { MachineJSON, MachineJSONState, MachineJSONTransition } from "./machine-json";

const FIXTURES_DIR = join(__dirname, "..", "__fixtures__");

function machineOf(source: string): MachineJSON {
  const [ir] = analyzeWorkflowSource(source);
  return renderMachineJSON(ir!);
}

/** Every state in the machine, nested ones included, keyed by id. */
function statesById(machine: MachineJSON): Map<string, MachineJSONState> {
  const byId = new Map<string, MachineJSONState>();
  const walk = (states: Record<string, MachineJSONState>) => {
    for (const state of Object.values(states)) {
      byId.set(state.id, state);
      if (state.states) walk(state.states);
    }
  };
  walk(machine.states);
  return byId;
}

function transitionsOf(state: MachineJSONState): MachineJSONTransition[] {
  return [
    ...Object.values(state.on ?? {}).flat(),
    ...(state.invoke ? [state.invoke.onDone, state.invoke.onError] : []),
  ];
}

/** States reachable from the initial state: transitions, a compound's initial, and every parallel region. */
function reachable(machine: MachineJSON): Set<string> {
  const byId = statesById(machine);
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const state = byId.get(id)!;
    if (state.type === "parallel") Object.values(state.states ?? {}).forEach((region) => visit(region.id));
    else if (state.initial) visit(state.states![state.initial]!.id);
    for (const t of transitionsOf(state)) visit(t.target.slice(1));
  };
  visit(machine.states[machine.initial]!.id);
  return seen;
}

function fixtureFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return fixtureFiles(path);
    return path.endsWith(".ts") && !path.includes(".test.") ? [path] : [];
  });
}

describe("renderMachineJSON", () => {
  beforeEach(() => resetIdCounter());

  it("chains steps as invoked actors that end in done or failed", () => {
    const machine = machineOf(`
      import { createWorkflow, ok, err, type AsyncResult } from "awaitly";
      const getUser = async (): AsyncResult<{ id: string }, { type: "NOT_FOUND" }> => ok({ id: "1" });
      const charge = async (): AsyncResult<void, { type: "DECLINED" }> => ok(undefined);
      const w = createWorkflow("checkout", { getUser, charge });
      export async function run() {
        return await w.run(async ({ step, deps }) => {
          await step("getUser", () => deps.getUser());
          await step("charge", () => deps.charge());
        });
      }
    `);

    expect(machine.id).toBe("checkout");
    expect(machine.initial).toBe("getUser");
    expect(machine.states.getUser!.invoke).toEqual({
      id: "getUser",
      src: "getUser",
      onDone: { target: "#charge" },
      onError: { target: "#failed" },
    });
    expect(machine.states.charge!.invoke!.onDone).toEqual({ target: "#done" });
    expect(machine.states.done).toEqual({ id: "done", type: "final" });
    expect(machine.states.failed!.type).toBe("final");
    expect(machine.states.failed!.meta!.errors).toEqual(["NOT_FOUND", "DECLINED"]);
  });

  it("maps parallel branches to regions joined by xstate.done.state", () => {
    const machine = machineOf(`
      import { createWorkflow, ok, allAsync } from "awaitly";
      const a = async () => ok(1);
      const b = async () => ok(2);
      const w = createWorkflow("w", { a, b });
      export async function run() {
        return await w.run(async ({ step, deps }) => {
          await allAsync([step("a", () => deps.a()), step("b", () => deps.b())]);
        });
      }
    `);
    const parallel = Object.values(machine.states).find((s) => s.type === "parallel")!;

    expect(parallel).toBeDefined();
    expect(Object.keys(parallel.states!)).toHaveLength(2);
    for (const region of Object.values(parallel.states!)) {
      expect(Object.values(region.states!).some((s) => s.type === "final")).toBe(true);
    }
    expect(parallel.on!["xstate.done.state"]).toEqual({
      target: "#done",
      matches: { stateId: parallel.id },
    });
    expect(parallel).not.toHaveProperty("onDone");
  });

  it("lets every allSettled branch settle before choosing the outcome", () => {
    const machine = machineOf(`
      import { createWorkflow, ok, allSettledAsync } from "awaitly";
      const a = async () => ok(1);
      const b = async () => ok(2);
      const w = createWorkflow("w", { a, b });
      export async function run() {
        return await w.run(async ({ step, deps }) => {
          await allSettledAsync([step("a", () => deps.a()), step("b", () => deps.b())]);
        });
      }
    `);
    const parallel = Object.values(machine.states).find((s) => s.type === "parallel")!;
    const regions = Object.values(parallel.states!);
    const byId = statesById(machine);

    // A branch error ends only its own region, in a local final state.
    for (const step of ["a", "b"]) {
      const local = byId.get(byId.get(step)!.invoke!.onError.target.slice(1))!;
      expect(local.type).toBe("final");
      expect(local.id).not.toBe("failed");
      expect(regions.some((region) => region.states![local.id] === local)).toBe(true);
    }

    // Once every region is final: any failed region fails the machine, else it goes on.
    const join = parallel.on!["xstate.done.state"] as MachineJSONTransition[];
    const matches = { stateId: parallel.id };
    expect(join.slice(0, -1)).toEqual(
      ["a", "b"].map((step) => ({
        target: "#failed",
        matches,
        guard: { type: "@xstate.stateIn", params: { stateId: byId.get(step)!.invoke!.onError.target } },
      }))
    );
    expect(join.at(-1)).toEqual({ target: "#done", matches });
  });

  it("fails fast on the first branch error in all mode", () => {
    const machine = machineOf(`
      import { createWorkflow, ok, allAsync } from "awaitly";
      const a = async () => ok(1);
      const b = async () => ok(2);
      const w = createWorkflow("w", { a, b });
      export async function run() {
        return await w.run(async ({ step, deps }) => {
          await allAsync([step("a", () => deps.a()), step("b", () => deps.b())]);
        });
      }
    `);

    expect(statesById(machine).get("a")!.invoke!.onError).toEqual({ target: "#failed" });
  });

  it("gives each branch of a decision its own event, and a missing else goes on", () => {
    const machine = machineOf(`
      import { createWorkflow, ok } from "awaitly";
      const a = async () => ok(1);
      const w = createWorkflow("w", { a });
      export async function run(flag: boolean) {
        return await w.run(async ({ step, deps }) => {
          if (flag) {
            await step("a", () => deps.a());
          }
        });
      }
    `);
    const decision = machine.states[machine.initial]!;

    expect(decision.on!.true).toEqual({ target: "#a" });
    expect(decision.on!.false).toEqual({ target: "#done" });
  });

  it("loops through the body and leaves on done", () => {
    const machine = machineOf(`
      import { createWorkflow, ok } from "awaitly";
      const a = async () => ok(1);
      const w = createWorkflow("w", { a });
      export async function run(items: string[]) {
        return await w.run(async ({ step, deps }) => {
          for (const item of items) {
            await step("a", () => deps.a());
          }
        });
      }
    `);
    const loop = machine.states[machine.initial]!;

    expect(loop.on!.iterate).toEqual({ target: "#a" });
    expect(loop.on!.done).toEqual({ target: "#done" });
    expect(machine.states.a!.invoke!.onDone).toEqual({ target: `#${loop.id}` });
  });

  it("passes straight through a race with no statically known racers", () => {
    const machine = machineOf(`
      import { createWorkflow, ok } from "awaitly";
      const a = async () => ok(1);
      const w = createWorkflow("w", { a });
      export async function run() {
        return await w.run(async ({ step, deps }) => {
          await step.race("solo", () => deps.a());
        });
      }
    `);

    expect(machine.states.solo!.on).toEqual({ done: { target: "#done" } });
  });

  it("makes ids XState can target: no '.' or '#', unique, and never the machine id", () => {
    const machine = machineOf(`
      import { createWorkflow, ok } from "awaitly";
      const a = async () => ok(1);
      const w = createWorkflow("w", { a });
      export async function run() {
        return await w.run(async ({ step, deps }) => {
          await step("user.load", () => deps.a());
          await step("user.load", () => deps.a());
          await step("w", () => deps.a());
        });
      }
    `);
    const ids = [...statesById(machine).keys()];

    expect(ids).toContain("user_load");
    expect(ids).toContain("user_load_2");
    expect(ids).toContain("w_2");
    expect(ids.some((id) => /[.#]/.test(id))).toBe(false);
    expect(machine.states.user_load!.meta!.stepId).toBe("user.load");
  });

  it.each(["done", "failed"])("keeps terminal ids apart from a workflow named %s", (name) => {
    const machine = machineOf(`
      import { createWorkflow, ok } from "awaitly";
      const a = async () => ok(1);
      const w = createWorkflow("${name}", { a });
      export async function run() {
        return await w.run(async ({ step, deps }) => {
          await step("a", () => deps.a());
        });
      }
    `);
    const ids = [...statesById(machine).keys()];

    expect(machine.id).toBe(name);
    expect(ids).not.toContain(name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(machine.states.a!.invoke!.onDone.target.slice(1)).toBe(ids.find((id) => machine.states[id]?.type === "final" && id.startsWith("done")));
  });

  it("keeps authored keys like __proto__ as ordinary states and events", () => {
    const machine = JSON.parse(
      JSON.stringify(
        machineOf(`
          import { createWorkflow, ok } from "awaitly";
          const a = async () => ok(1);
          const w = createWorkflow("w", { a });
          export async function run(flag: boolean) {
            return await w.run(async ({ step, deps }) => {
              await step("__proto__", () => deps.a());
              if (step.if("check", "__proto__", () => flag)) {
                await step("b", () => deps.a());
              }
            });
          }
        `)
      )
    ) as MachineJSON;

    expect(machine.initial).toBe("__proto__");
    expect(Object.keys(machine.states)).toContain("__proto__");
    expect(Object.hasOwn(machine.states, "__proto__")).toBe(true);
    // The step.if label is the branch event's name.
    expect(machine.states.check!.on!["__proto__"]).toEqual({ target: "#b" });
    expect(Object.hasOwn(machine.states.check!.on!, "__proto__")).toBe(true);
    expect(reachable(machine).has("b")).toBe(true);
  });

  describe("every fixture renders a connected machine", () => {
    for (const file of fixtureFiles(FIXTURES_DIR)) {
      it(file.slice(FIXTURES_DIR.length + 1), () => {
        resetIdCounter();
        for (const ir of analyzeWorkflowSource(readFileSync(file, "utf-8"))) {
          const machine = renderMachineJSON(ir);
          const byId = statesById(machine);

          for (const state of byId.values()) {
            expect(state).not.toHaveProperty("onDone");
            for (const t of transitionsOf(state)) {
              expect(typeof t).toBe("object");
              expect(byId.has(t.target.slice(1)), `${state.id} → ${t.target}`).toBe(true);
            }
          }
          expect([...byId.keys()].filter((id) => !reachable(machine).has(id))).toEqual([]);
        }
      });
    }
  });
});
