/**
 * XState MachineJSON renderer.
 *
 * Converts StaticWorkflowIR to an XState v6 MachineJSON definition. `machineFromJSON`
 * revives it, and statechart tools draw and step it without running workflow code.
 *
 * Mapping:
 * - step / saga step / workflow ref → a state invoking the dep as an actor;
 *   `onDone` goes on, `onError` enters the undo chain of the compensations
 *   recorded so far, or `failed` when there are none.
 * - saga step with `compensate` → also a compensating invoke state. Each
 *   compensation's `onDone` continues the chain, newest first, down to
 *   `failed`. Its `onError` continues through `<id>_after_failure` copies of
 *   the older ones, which end on `compensation_failed` (`SagaCompensationError`),
 *   matching the runtime.
 *   The chain follows the executed path: after a branch, the steps that follow
 *   compile once per distinct chain. Loop iterations and parallel steps complete
 *   in an order known at runtime, so their compensations return to a
 *   `<id>_undo` hub: send `undo:<compensation>` for each completed iteration
 *   or parallel step, then `done`. Compensations are top-level states, so entering one leaves any
 *   parallel state.
 * - parallel → `type: "parallel"`, one region per branch, then an
 *   `xstate.done.state` transition once every region reaches its final state.
 *   `all` fails fast: a branch error leaves at once and rolls back. `allSettled`
 *   waits: a branch error ends only its region (in `<region>_failed`), and
 *   once all regions finish, a built-in `@xstate.stateIn` guard sends the
 *   machine to rollback if any region failed, else on.
 * - race → a state with one `race:<n>` event per racer, so you pick the winner.
 * - if / step.if / switch → a state with one event per branch.
 * - loop → `iterate` into the body, back to the loop state, `done` to leave.
 *
 * Errors lead to the `failed` final state, and its `meta.errors` lists the error
 * tags. Targets use `#id`. Ids are the DSL's semantic ids with `.` and `#`
 * replaced by `_`, since XState reads both as target syntax.
 */

import { stepStateId } from "./dsl";
import {
  extractFunctionName,
  getStaticChildren,
  type SourceLocation,
  type StaticFlowNode,
  type StaticWorkflowIR,
} from "../types";

/** A transition in the object form MachineJSON accepts. */
export interface MachineJSONTransition {
  target: string;
  matches?: { stateId: string };
  /** XState's built-in guard: tools evaluate it from the active states. */
  guard?: { type: "@xstate.stateIn"; params: { stateId: string } };
}

export interface MachineJSONState {
  id: string;
  type?: "parallel" | "final";
  initial?: string;
  description?: string;
  states?: Record<string, MachineJSONState>;
  invoke?: { id: string; src: string; onDone: MachineJSONTransition; onError: MachineJSONTransition };
  /** A list is tried in order: the first transition whose guard passes is taken. */
  on?: Record<string, MachineJSONTransition | MachineJSONTransition[]>;
  meta?: Record<string, unknown>;
}

export interface MachineJSON {
  id: string;
  initial: string;
  description?: string;
  states: Record<string, MachineJSONState>;
}

interface Ctx {
  used: Set<string>;
  errors: Set<string>;
  counter: number;
  /** Ids of the terminal states, allocated after the machine id so every id stays unique. */
  done: string;
  failed: string;
  /** Final state for a compensation that itself fails; allocated on first use. */
  compensationFailed: string | null;
  /** Newest compensation on the current path; each one's `onDone` already links to the one before it. */
  compensationTop: string | undefined;
  compensations: Map<string, Compensation>;
  /** Compensation id → its copy used once an earlier compensation has failed. */
  afterFailure: Map<string, string>;
  /** Hub of the innermost parallel being compiled: its steps undo one at a time, in any order. */
  parallelHub: string | undefined;
  /** Inside an `allSettled` region: a step error ends the region and rollback waits for the join. */
  deferUndo: boolean;
  /** Top-level states: compensations live here so entering one never re-enters a parallel state. */
  root: Record<string, MachineJSONState>;
}

/**
 * A node in the undo chain. `prev` is the next one to run (none: end in `failed`).
 * A hub stands for steps whose count or progress is only known at runtime (loop
 * iterations, concurrent parallel regions): you pick each completed one to undo, then `done`.
 */
type Compensation =
  | { kind: "step"; src: string; forStepId: string; prev: string | undefined }
  | { kind: "hub"; description: string; prev: string | undefined; failed: string; on: Record<string, MachineJSONTransition>; targets?: string[] };

/** Prototype-free record: authored keys such as `__proto__` stay ordinary keys. */
const dict = <V>(): Record<string, V> => Object.create(null) as Record<string, V>;

/** A way out of a fragment: a setter for where it goes next, and the compensation top on that path. */
interface Out {
  to: (target: string) => void;
  top: string | undefined;
}

/** A compiled node: its entry state (null when it compiles to nothing) and its ways out. */
interface Fragment {
  entry: string | null;
  outs: Out[];
}

const out = (ctx: Ctx, to: Out["to"]): Out => ({ to, top: ctx.compensationTop });

const ref = (id: string): MachineJSONTransition => ({ target: `#${id}` });

function stateId(ctx: Ctx, raw: string): string {
  const base = raw.replace(/[.#]/g, "_") || "state";
  let id = base;
  for (let n = 2; ctx.used.has(id); n++) id = `${base}_${n}`;
  ctx.used.add(id);
  return id;
}

function location(loc?: SourceLocation): Record<string, unknown> {
  return loc ? { location: { filePath: loc.filePath, line: loc.line, column: loc.column } } : {};
}

function ensureCompensationFailed(ctx: Ctx): string {
  if (!ctx.compensationFailed) {
    ctx.compensationFailed = stateId(ctx, "compensation_failed");
  }
  return ctx.compensationFailed;
}

/** The rest of the undo chain after a compensation failed: it still runs, then ends in `compensation_failed`. */
function afterCompensationFailure(ctx: Ctx, prev: string | undefined): string {
  if (!prev) return ensureCompensationFailed(ctx);
  const existing = ctx.afterFailure.get(prev);
  if (existing) return existing;
  const c = ctx.compensations.get(prev)!;
  const id = stateId(ctx, `${prev}_after_failure`);
  ctx.afterFailure.set(prev, id);
  if (c.kind === "hub") {
    ctx.root[id] = { id, description: `${c.description} (after a failed compensation)`, on: dict() };
    if (c.targets) fillHub(ctx, prev);
    return id;
  }
  const next = afterCompensationFailure(ctx, c.prev);
  ctx.root[id] = {
    id,
    description: `compensate: ${c.src} (after a failed compensation)`,
    invoke: { id, src: c.src, onDone: ref(next), onError: ref(next) },
    meta: { compensationFor: c.forStepId },
  };
  return id;
}

/** Emit a compensating invoke state whose `onDone` continues into `prev` (or `failed`). */
function emitCompensation(
  ctx: Ctx,
  raw: string,
  c: { src?: string; forStepId: string; prev: string | undefined; failed: string }
): string {
  const id = stateId(ctx, raw);
  const src = c.src || id;
  ctx.compensations.set(id, { kind: "step", src, forStepId: c.forStepId, prev: c.prev });
  ctx.root[id] = {
    id,
    description: `compensate: ${src}`,
    invoke: { id, src, onDone: ref(c.prev ?? c.failed), onError: ref(afterCompensationFailure(ctx, c.prev)) },
    meta: { compensationFor: c.forStepId },
  };
  return id;
}

/** Make a step's compensation the newest on this path. */
function pushCompensation(ctx: Ctx, forStepId: string, compensationCallee: string | undefined): void {
  const src = compensationCallee ? extractFunctionName(compensationCallee) : undefined;
  // In a parallel region each undo returns to the hub, so any completion order can be replayed.
  const pin = ctx.parallelHub;
  const id = emitCompensation(ctx, src || `undo_${forStepId}`, {
    src,
    forStepId,
    prev: pin ?? ctx.compensationTop,
    failed: ctx.failed,
  });
  ctx.compensationTop = pin ?? id;
}

/** Open a hub on the current path; the steps inside link down to it. Call `closeHub` once its targets are known. */
function openHub(ctx: Ctx, raw: string, description: string): string {
  const id = stateId(ctx, raw);
  const on = dict<MachineJSONTransition>();
  ctx.compensations.set(id, { kind: "hub", description, prev: ctx.compensationTop, failed: ctx.failed, on });
  ctx.root[id] = { id, description, on };
  ctx.compensationTop = id;
  return id;
}

function closeHub(ctx: Ctx, hub: string, targets: Iterable<string | undefined>): void {
  const c = ctx.compensations.get(hub) as Extract<Compensation, { kind: "hub" }>;
  c.targets = [...new Set(targets)].filter((t): t is string => !!t && t !== hub);
  fillHub(ctx, hub);
}

/** Write a hub's events: `undo:<id>` enters that compensation (which returns here), `done` continues down. */
function fillHub(ctx: Ctx, hub: string): void {
  const c = ctx.compensations.get(hub) as Extract<Compensation, { kind: "hub" }>;
  const after = ctx.afterFailure.get(hub);
  for (const t of c.targets!) c.on[`undo:${t}`] = ref(t);
  c.on.done = ref(c.prev ?? c.failed);
  if (!after) return;
  const on = ctx.root[after]!.on!;
  for (const t of c.targets!) on[`undo:${t}`] = ref(afterCompensationFailure(ctx, t));
  on.done = ref(afterCompensationFailure(ctx, c.prev));
}

/** Does any step under these nodes register a compensation? */
const compensates = (nodes: StaticFlowNode[]): boolean =>
  nodes.some((n) => (n.type === "saga-step" && n.hasCompensation) || compensates(getStaticChildren(n)));

function invoking(
  ctx: Ctx,
  states: Record<string, MachineJSONState>,
  id: string,
  src: string,
  extra: Partial<MachineJSONState>
): Fragment {
  // Any failing invoke rolls back what has completed so far, unless an allSettled region defers it to the join.
  const onErrorTarget = ctx.deferUndo ? ctx.failed : (ctx.compensationTop ?? ctx.failed);
  const state: MachineJSONState = {
    id,
    ...extra,
    // Explicit actor id, so its events read `xstate.done.actor.<state id>`.
    invoke: { id, src, onDone: ref(ctx.done), onError: ref(onErrorTarget) },
  };
  states[id] = state;
  return { entry: id, outs: [out(ctx, (t) => (state.invoke!.onDone = ref(t)))] };
}

/** A state that leaves through named events; `branches` maps event → compiled branch. */
function choice(
  ctx: Ctx,
  states: Record<string, MachineJSONState>,
  id: string,
  extra: Partial<MachineJSONState>,
  branches: Array<[event: string, branch: Fragment]>
): Fragment {
  const on = dict<MachineJSONTransition>();
  const state: MachineJSONState = { id, ...extra, on };
  states[id] = state;
  const outs: Fragment["outs"] = [];
  // With no branches, the state continues on `done`.
  for (const [event, branch] of branches.length ? branches : [["done", { entry: null, outs: [] }] as const]) {
    if (branch.entry) {
      on[event] = ref(branch.entry);
      outs.push(...branch.outs);
    } else {
      outs.push(out(ctx, (t) => (on[event] = ref(t))));
    }
  }
  return { entry: id, outs };
}

function compileSequence(nodes: StaticFlowNode[], states: Record<string, MachineJSONState>, ctx: Ctx): Fragment {
  for (let i = 0; i < nodes.length; i++) {
    const head = compileNode(nodes[i]!, states, ctx);
    if (!head.entry) continue;
    // Paths out of a branch can hold different compensations, so each compiles its own copy of the rest.
    const byTop = new Map<string | undefined, Out[]>();
    for (const o of head.outs) byTop.set(o.top, [...(byTop.get(o.top) ?? []), o]);
    const outs: Out[] = [];
    for (const [top, group] of byTop) {
      ctx.compensationTop = top;
      const tail = compileSequence(nodes.slice(i + 1), states, ctx);
      if (!tail.entry) {
        outs.push(...group);
        continue;
      }
      for (const o of group) o.to(tail.entry);
      outs.push(...tail.outs);
    }
    return { entry: head.entry, outs };
  }
  return { entry: null, outs: [] };
}

/** Compile one alternative from the compensations in place before the choice, and restore them after. */
function compileBranch(nodes: StaticFlowNode[], states: Record<string, MachineJSONState>, ctx: Ctx): Fragment {
  const top = ctx.compensationTop;
  const fragment = compileSequence(nodes, states, ctx);
  ctx.compensationTop = top;
  return fragment;
}

function compileNode(node: StaticFlowNode, states: Record<string, MachineJSONState>, ctx: Ctx): Fragment {
  switch (node.type) {
    case "step": {
      const raw = stepStateId(node);
      const id = stateId(ctx, raw);
      for (const error of node.errors ?? []) ctx.errors.add(error);
      const src = node.depSource ?? (node.callee ? extractFunctionName(node.callee) : raw);
      return invoking(ctx, states, id, src || raw, {
        ...(node.description ? { description: node.description } : {}),
        meta: {
          ...(id !== raw ? { stepId: raw } : {}),
          ...(node.callee ? { callee: node.callee } : {}),
          ...(node.key && node.key !== "<dynamic>" ? { key: node.key } : {}),
          ...(node.errors?.length ? { errors: node.errors } : {}),
          ...location(node.location),
        },
      });
    }
    case "saga-step": {
      const raw = stepStateId(node);
      const id = stateId(ctx, raw);
      const src = node.depSource ?? (node.callee ? extractFunctionName(node.callee) : raw);
      const fragment = invoking(
        ctx,
        states,
        id,
        src || raw,
        {
          ...(node.description ? { description: node.description } : {}),
          meta: {
            ...(id !== raw ? { stepId: raw } : {}),
            ...(node.compensationCallee ? { compensation: node.compensationCallee } : {}),
            ...location(node.location),
          },
        }
      );
      // After success, later failures enter this step's compensation first.
      if (node.hasCompensation) {
        pushCompensation(ctx, raw, node.compensationCallee);
        fragment.outs[0]!.top = ctx.compensationTop;
      }
      return fragment;
    }
    case "workflow-ref": {
      const id = stateId(ctx, node.workflowName);
      return invoking(ctx, states, id, node.workflowName, { meta: { workflow: node.workflowName, ...location(node.location) } });
    }
    case "sequence":
      return compileSequence(node.children, states, ctx);
    case "parallel": {
      const id = stateId(ctx, node.name ?? `parallel_${++ctx.counter}`);
      if (node.children.length === 0) return choice(ctx, states, id, { description: "Parallel", meta: location(node.location) }, []);
      const settled = node.mode === "allSettled";
      const regions = dict<MachineJSONState>();
      const regionFailures: string[] = [];
      const outerFailed = ctx.failed;
      const outerDefer = ctx.deferUndo;
      const before = ctx.compensationTop;
      // Regions run concurrently, so on failure the others' progress is unknown: their steps share a hub.
      const hub = compensates(node.children)
        ? openHub(ctx, `${id}_undo`, "Undo the parallel steps that completed, newest first: pick each, then done")
        : undefined;
      const known = ctx.compensations.size;
      const outerHub = ctx.parallelHub;
      if (hub) ctx.parallelHub = hub;
      node.children.forEach((child, i) => {
        const regionId = stateId(ctx, `${id}_branch_${i}`);
        const finalId = stateId(ctx, `${regionId}_done`);
        const inner = dict<MachineJSONState>();
        // allSettled: a branch error ends only this region; the outcome is decided once all have finished.
        const failedId = settled ? stateId(ctx, `${regionId}_failed`) : outerFailed;
        ctx.failed = failedId;
        ctx.compensationTop = hub ?? before;
        ctx.deferUndo = outerDefer || settled;
        const branch = compileNode(child, inner, ctx);
        ctx.failed = outerFailed;
        ctx.deferUndo = outerDefer;
        inner[finalId] = { id: finalId, type: "final" };
        if (settled) {
          inner[failedId] = { id: failedId, type: "final" };
          regionFailures.push(failedId);
        }
        for (const o of branch.outs) o.to(finalId);
        regions[regionId] = { id: regionId, initial: branch.entry ?? finalId, states: inner };
      });
      const on = dict<MachineJSONTransition | MachineJSONTransition[]>();
      states[id] = {
        id,
        type: "parallel",
        description: settled ? "Parallel (allSettled)" : "Parallel",
        states: regions,
        on,
        meta: location(node.location),
      };
      // The parallel state completes through `xstate.done.state`, matched on its id.
      const matches = { stateId: id };
      ctx.parallelHub = outerHub;
      // After the join, rollback still picks from the hub: completion order is a runtime fact.
      if (hub) closeHub(ctx, hub, [...ctx.compensations.keys()].slice(known));
      // A failed allSettled region fails the workflow and rolls back, unless an enclosing allSettled
      // region contains it: then it fails only that region, and rollback waits for the outer join.
      const settledFailed = outerDefer ? outerFailed : (hub ?? before ?? outerFailed);
      ctx.compensationTop = hub ?? before;
      return {
        entry: id,
        outs: [
          out(ctx, (t) =>
            (on["xstate.done.state"] = settled
              ? [
                  ...regionFailures.map((failedId) => ({
                    ...ref(settledFailed),
                    matches,
                    guard: { type: "@xstate.stateIn" as const, params: { stateId: `#${failedId}` } },
                  })),
                  { ...ref(t), matches },
                ]
              : { ...ref(t), matches })),
        ],
      };
    }
    case "race": {
      const id = stateId(ctx, node.name ?? `race_${++ctx.counter}`);
      const racers = node.children.map((child, i) => [`race:${i}`, compileBranch([child], states, ctx)] as [string, Fragment]);
      return choice(ctx, states, id, { description: "Race: the first to finish wins", meta: location(node.location) }, racers);
    }
    case "conditional": {
      const id = stateId(ctx, node.derivedId ?? `decision_${++ctx.counter}`);
      const swap = node.helper === "unless" || node.helper === "unlessOr";
      const consequent = compileBranch(node.consequent, states, ctx);
      const alternate = compileBranch(node.alternate ?? [], states, ctx);
      return choice(ctx, states, id, { description: node.condition, meta: location(node.location) }, [
        [swap ? "false" : "true", consequent],
        [swap ? "true" : "false", alternate],
      ]);
    }
    case "decision": {
      const raw = node.decisionId && node.decisionId !== "<dynamic>" ? node.decisionId : `decision_${++ctx.counter}`;
      const id = stateId(ctx, raw);
      const label = node.conditionLabel && node.conditionLabel !== "<dynamic>" ? node.conditionLabel : undefined;
      const consequent = compileBranch(node.consequent, states, ctx);
      const alternate = compileBranch(node.alternate ?? [], states, ctx);
      return choice(ctx, states, id, { description: label ?? node.condition, meta: location(node.location) }, [
        [label ?? "true", consequent],
        [label ? `Not ${label}` : "false", alternate],
      ]);
    }
    case "switch": {
      const id = stateId(ctx, `switch_${++ctx.counter}`);
      const branches = node.cases.map(
        (c) => [c.isDefault ? "default" : (c.value ?? "case"), compileBranch(c.body, states, ctx)] as [string, Fragment]
      );
      // No default clause: an unmatched value falls through to whatever follows.
      if (!node.cases.some((c) => c.isDefault)) branches.push(["default", { entry: null, outs: [] }]);
      return choice(ctx, states, id, { description: `switch: ${node.expression}`, meta: location(node.location) }, branches);
    }
    case "loop": {
      const semanticId = node.loopId ?? node.derivedId;
      const id = stateId(ctx, semanticId ? `loop_${semanticId}` : `loop_${++ctx.counter}`);
      // The iteration count is only known at runtime, so completed iterations are undone from a hub.
      const hub = compensates(node.body)
        ? openHub(ctx, `${id}_undo`, "Undo the loop iterations that completed: pick each, then done")
        : undefined;
      // Iterations run in order, so the body chains normally even inside a parallel region.
      const outerHub = ctx.parallelHub;
      ctx.parallelHub = undefined;
      const body = compileSequence(node.body, states, ctx);
      ctx.parallelHub = outerHub;
      if (hub) {
        closeHub(ctx, hub, body.outs.map((o) => o.top));
        ctx.compensationTop = hub;
      }
      for (const o of body.outs) o.to(id);
      const on = dict<MachineJSONTransition>();
      if (body.entry) on.iterate = ref(body.entry);
      const state: MachineJSONState = {
        id,
        description: node.iterSource ? `${node.loopType}: ${node.iterSource}` : node.loopType,
        on,
        meta: location(node.location),
      };
      states[id] = state;
      return { entry: id, outs: [out(ctx, (t) => (on.done = ref(t)))] };
    }
    case "stream": {
      const id = stateId(ctx, `stream_${node.namespace ?? ++ctx.counter}`);
      const on = dict<MachineJSONTransition>();
      states[id] = { id, description: `stream: ${node.namespace ?? node.streamType}`, on, meta: location(node.location) };
      return { entry: id, outs: [out(ctx, (t) => (on.done = ref(t)))] };
    }
    case "unknown": {
      const id = stateId(ctx, `unknown_${++ctx.counter}`);
      const on = dict<MachineJSONTransition>();
      states[id] = { id, description: `Not statically analyzable: ${node.reason}`, on, meta: location(node.location) };
      return { entry: id, outs: [out(ctx, (t) => (on.continue = ref(t)))] };
    }
    default:
      return { entry: null, outs: [] };
  }
}

/** A compensation runs only when something after it fails; remove the ones no transition reaches. */
function dropUnusedCompensations(ctx: Ctx, initial: string): void {
  const byId = new Map<string, MachineJSONState>();
  const index = (states: Record<string, MachineJSONState>) => {
    for (const st of Object.values(states)) {
      byId.set(st.id, st);
      if (st.states) index(st.states);
    }
  };
  index(ctx.root);
  const seen = new Set<string>();
  const visit = (id: string) => {
    const st = byId.get(id);
    if (!st || seen.has(id)) return;
    seen.add(id);
    const transitions = [...Object.values(st.on ?? {}).flat(), ...(st.invoke ? [st.invoke.onDone, st.invoke.onError] : [])];
    for (const t of transitions) visit(t.target.slice(1));
    for (const child of Object.values(st.states ?? {})) visit(child.id);
  };
  visit(initial);
  const removable = [...ctx.compensations.keys(), ...ctx.afterFailure.values(), ctx.compensationFailed ?? ""];
  for (const id of removable) if (!seen.has(id)) delete ctx.root[id];
}

/**
 * Convert static workflow IR to an XState v6 MachineJSON definition.
 * The result is plain JSON: pass it to `machineFromJSON` or to a statechart tool.
 */
export function renderMachineJSON(ir: StaticWorkflowIR): MachineJSON {
  const machineId = ir.root.workflowName.replace(/[.#]/g, "_") || "workflow";
  // The machine id is addressable as `#id` too, so no state may reuse it.
  const ctx: Ctx = {
    used: new Set([machineId]),
    errors: new Set(),
    counter: 0,
    done: "",
    failed: "",
    compensationFailed: null,
    compensationTop: undefined,
    compensations: new Map(),
    afterFailure: new Map(),
    parallelHub: undefined,
    deferUndo: false,
    root: dict(),
  };
  ctx.done = stateId(ctx, "done");
  ctx.failed = stateId(ctx, "failed");
  const states = ctx.root;
  const body = compileSequence(ir.root.children, states, ctx);
  for (const o of body.outs) o.to(ctx.done);

  for (const error of [...ir.root.errorTypes, ...(ir.root.declaredErrors ?? [])]) ctx.errors.add(error);
  const errors = [...ctx.errors];

  states[ctx.done] = { id: ctx.done, type: "final" };
  states[ctx.failed] = {
    id: ctx.failed,
    type: "final",
    ...(errors.length ? { description: `Fails with: ${errors.join(" | ")}`, meta: { errors } } : {}),
  };
  if (ctx.compensationFailed) {
    states[ctx.compensationFailed] = {
      id: ctx.compensationFailed,
      type: "final",
      description: "Fails with: SagaCompensationError",
      meta: { errors: ["SagaCompensationError"] },
    };
  }
  dropUnusedCompensations(ctx, body.entry ?? ctx.done);

  return {
    id: machineId,
    initial: body.entry ?? ctx.done,
    ...(ir.root.description ? { description: ir.root.description } : {}),
    states,
  };
}
