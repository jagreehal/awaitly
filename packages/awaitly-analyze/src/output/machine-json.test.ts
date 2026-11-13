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

  it("routes later-step errors through compensating states before failed", () => {
    const machine = machineOf(`
      import { createSagaWorkflow } from "awaitly/durable";
      import { ok, type AsyncResult } from "awaitly";
      type CopyFailed = { type: "COPY_FAILED" };
      const createUpload = async (): AsyncResult<string, CopyFailed> => ok("upload-1");
      const copyParts = async (): AsyncResult<string[], CopyFailed> => ok(["etag"]);
      const completeUpload = async (): AsyncResult<void, CopyFailed> => ok(undefined);
      const abortUpload = async (): AsyncResult<void, CopyFailed> => ok(undefined);
      const copyInParts = createSagaWorkflow("copyInParts", {
        createUpload, copyParts, completeUpload, abortUpload,
      });
      export async function copy() {
        return copyInParts.run(async ({ step, deps }) => {
          const uploadId = await step("createUpload", () => deps.createUpload(), {
            compensate: (id) => deps.abortUpload(id),
          });
          const parts = await step("copyParts", () => deps.copyParts());
          await step("completeUpload", () => deps.completeUpload());
          return { uploadId, parts };
        });
      }
    `);

    // Compensation is a real state, not only meta on createUpload.
    expect(machine.states.abortUpload!.invoke).toEqual({
      id: "abortUpload",
      src: "abortUpload",
      onDone: { target: "#failed" },
      onError: { target: "#compensation_failed" },
    });
    expect(machine.states.compensation_failed).toEqual({
      id: "compensation_failed",
      type: "final",
      description: "Fails with: SagaCompensationError",
      meta: { errors: ["SagaCompensationError"] },
    });

    // createUpload itself failed before anything succeeded → straight to failed.
    expect(machine.states.createUpload!.invoke!.onError).toEqual({ target: "#failed" });
    // Failures after createUpload succeeded roll back through abortUpload.
    expect(machine.states.copyParts!.invoke!.onError).toEqual({ target: "#abortUpload" });
    expect(machine.states.completeUpload!.invoke!.onError).toEqual({ target: "#abortUpload" });
    expect(reachable(machine).has("abortUpload")).toBe(true);
  });

  it("rolls back only the compensations on the path that ran", () => {
    const machine = machineOf(`
      import { createSagaWorkflow } from "awaitly/durable";
      import { ok } from "awaitly";
      const a = async () => ok(1);
      const b = async () => ok(2);
      const c = async () => ok(3);
      const undoA = async () => ok(undefined);
      const undoB = async () => ok(undefined);
      const saga = createSagaWorkflow("saga", { a, b, c, undoA, undoB });
      export async function run(flag: boolean) {
        return saga.run(async ({ step, deps }) => {
          if (flag) {
            await step("a", () => deps.a(), { compensate: () => deps.undoA() });
          } else {
            await step("b", () => deps.b(), { compensate: () => deps.undoB() });
          }
          await step("c", () => deps.c());
        });
      }
    `);

    // B is the alternative to A: its failure has nothing to undo.
    expect(machine.states.b!.invoke!.onError).toEqual({ target: "#failed" });
    expect(machine.states.undoA!.invoke!.onDone).toEqual({ target: "#failed" });
    expect(machine.states.undoB!.invoke!.onDone).toEqual({ target: "#failed" });
    // c is compiled once per path, each undoing only its own branch.
    const cs = Object.values(machine.states).filter((s) => s.invoke?.src === "c");
    expect(cs.map((s) => s.invoke!.onError.target).sort()).toEqual(["#undoA", "#undoB"]);
    expect(machine.states.a!.invoke!.onDone.target).not.toBe(machine.states.b!.invoke!.onDone.target);
  });

  it("keeps unwinding after a compensation fails, then ends in compensation_failed", () => {
    const machine = machineOf(`
      import { createSagaWorkflow } from "awaitly/durable";
      import { ok } from "awaitly";
      const reserve = async () => ok(1);
      const charge = async () => ok(2);
      const ship = async () => ok(3);
      const release = async () => ok(undefined);
      const refund = async () => ok(undefined);
      const saga = createSagaWorkflow("order", { reserve, charge, ship, release, refund });
      export async function run() {
        return saga.run(async ({ step, deps }) => {
          await step("reserve", () => deps.reserve(), { compensate: () => deps.release() });
          await step("charge", () => deps.charge(), { compensate: () => deps.refund() });
          await step("ship", () => deps.ship());
        });
      }
    `);

    expect(machine.states.ship!.invoke!.onError).toEqual({ target: "#refund" });
    expect(machine.states.refund!.invoke!.onDone).toEqual({ target: "#release" });
    // A failed refund still releases the reservation.
    expect(machine.states.refund!.invoke!.onError).toEqual({ target: "#release_after_failure" });
    expect(machine.states.release_after_failure!.invoke).toEqual({
      id: "release_after_failure",
      src: "release",
      onDone: { target: "#compensation_failed" },
      onError: { target: "#compensation_failed" },
    });
    expect(machine.states.release!.invoke!.onError).toEqual({ target: "#compensation_failed" });
  });

  const sagaOf = (body: string) =>
    machineOf(`
      import { createSagaWorkflow } from "awaitly/durable";
      import { ok, allAsync, allSettledAsync } from "awaitly";
      const a = async () => ok(1);
      const b = async () => ok(2);
      const c = async () => ok(3);
      const undoA = async () => ok(undefined);
      const undoB = async () => ok(undefined);
      const saga = createSagaWorkflow("saga", { a, b, c, undoA, undoB });
      export async function run(items: string[]) {
        return saga.run(async ({ step, deps }) => { ${body} });
      }
    `);
  const stepA = `step("a", () => deps.a(), { compensate: () => deps.undoA() })`;
  const stepB = `step("b", () => deps.b(), { compensate: () => deps.undoB() })`;

  it("undoes loop iterations from a hub, so zero or many iterations both roll back right", () => {
    const machine = sagaOf(`for (const i of items) { await ${stepA}; } await step("c", () => deps.c());`);

    // Nothing undone yet in this iteration: go straight to the hub of earlier iterations.
    expect(machine.states.a!.invoke!.onError).toEqual({ target: "#loop_items_undo" });
    expect(machine.states.c!.invoke!.onError).toEqual({ target: "#loop_items_undo" });
    // Each undone iteration returns to the hub; `done` (zero or no more iterations) continues down.
    expect(machine.states.loop_items_undo!.on).toEqual({
      "undo:undoA": { target: "#undoA" },
      done: { target: "#failed" },
    });
    expect(machine.states.undoA!.invoke!.onDone).toEqual({ target: "#loop_items_undo" });
    expect(machine.states.undoA!.invoke!.onError).toEqual({ target: "#loop_items_undo_after_failure" });
  });

  it("undoes parallel steps one pick at a time, since completion order is only known at runtime", () => {
    const machine = sagaOf(`await allAsync([${stepA}, ${stepB}]); await step("c", () => deps.c());`);
    const byId = statesById(machine);

    // A region failing mid-flight can't know how far the other got: pick from the hub.
    expect(byId.get("a")!.invoke!.onError).toEqual({ target: "#parallel_1_undo" });
    expect(byId.get("b")!.invoke!.onError).toEqual({ target: "#parallel_1_undo" });
    expect(machine.states.parallel_1_undo!.on).toEqual({
      "undo:undoA": { target: "#undoA" },
      "undo:undoB": { target: "#undoB" },
      done: { target: "#failed" },
    });
    // Compensations are top-level, so entering one leaves the parallel state; each returns to the hub.
    expect(machine.states.undoA!.invoke!.onDone).toEqual({ target: "#parallel_1_undo" });
    expect(machine.states.undoB!.invoke!.onDone).toEqual({ target: "#parallel_1_undo" });
    // After the join, the order is still a runtime fact: pick it.
    expect(machine.states.c!.invoke!.onError).toEqual({ target: "#parallel_1_undo" });
  });

  it("rolls back when a plain step or child workflow fails after a compensated step", () => {
    const irs = analyzeWorkflowSource(`
      import { createSagaWorkflow } from "awaitly/durable";
      import { createWorkflow, ok } from "awaitly";
      const reserve = async () => ok(1);
      const notify = async () => ok(2);
      const release = async () => ok(undefined);
      const child = createWorkflow("child", { notify });
      const saga = createSagaWorkflow("saga", { reserve, notify, release });
      export async function run() {
        return saga.run(async ({ step, deps }) => {
          await step("reserve", () => deps.reserve(), { compensate: () => deps.release() });
          await step("notify", () => deps.notify());
          await step.workflow("runChild", () => child.run(async ({ step }) => step("n", () => deps.notify())));
        });
      }
    `);
    const machine = renderMachineJSON(irs.find((ir) => ir.root.workflowName === "saga")!);
    const failing = Object.values(machine.states).filter((st) => st.invoke && !st.meta?.compensationFor && st.id !== "reserve");
    expect(failing.length).toBeGreaterThan(0);
    for (const st of failing) expect(st.invoke!.onError).toEqual({ target: "#release" });
  });

  it("leaves out compensations that no later failure can reach", () => {
    const machine = sagaOf(`await step("c", () => deps.c()); await ${stepA};`);
    expect(machine.states.undoA).toBeUndefined();
    expect(machine.states.compensation_failed).toBeUndefined();
    expect(machine.states.a!.invoke!.onError).toEqual({ target: "#failed" });
  });

  it("keeps a nested allSettled failure inside its enclosing allSettled region", () => {
    const machine = sagaOf(`await allSettledAsync([allSettledAsync([${stepA}]), ${stepB}]);`);
    const byId = statesById(machine);
    const inner = [...byId.values()].find((st) => st.type === "parallel" && st.id !== "parallel_1");
    const join = inner!.on!["xstate.done.state"] as MachineJSONTransition[];
    // The inner failure ends only the outer region; the outer join decides rollback.
    expect(join[0]!.target).toBe("#parallel_1_branch_0_failed");
  });

  it("defers allSettled rollback to the join", () => {
    const machine = sagaOf(`await allSettledAsync([${stepA}, ${stepB}]);`);
    const byId = statesById(machine);

    expect(byId.get("a")!.invoke!.onError).toEqual({ target: "#parallel_1_branch_0_failed" });
    const join = machine.states.parallel_1!.on!["xstate.done.state"] as MachineJSONTransition[];
    expect(join[0]!.target).toBe("#parallel_1_undo");
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
