/**
 * XState MachineJSON renderer.
 *
 * Converts StaticWorkflowIR to an XState v6 MachineJSON definition. `machineFromJSON`
 * revives it, and statechart tools draw and step it without running workflow code.
 *
 * Mapping:
 * - step / saga step / workflow ref → a state invoking the dep as an actor;
 *   `onDone` goes on, `onError` goes to the `failed` final state.
 * - parallel → `type: "parallel"`, one region per branch, then an
 *   `xstate.done.state` transition once every region reaches its final state.
 *   `all` fails fast: a branch error goes straight to `failed`. `allSettled`
 *   waits: a branch error ends only its region (in `<region>_failed`), and
 *   once all regions finish, a built-in `@xstate.stateIn` guard sends the
 *   machine to `failed` if any region failed, else on.
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
}

/** Prototype-free record: authored keys such as `__proto__` stay ordinary keys. */
const dict = <V>(): Record<string, V> => Object.create(null) as Record<string, V>;

/** A compiled node: its entry state (null when it compiles to nothing) and setters for where it goes next. */
interface Fragment {
  entry: string | null;
  outs: Array<(target: string) => void>;
}

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

function invoking(
  ctx: Ctx,
  states: Record<string, MachineJSONState>,
  id: string,
  src: string,
  extra: Partial<MachineJSONState>
): Fragment {
  const state: MachineJSONState = {
    id,
    ...extra,
    // Explicit actor id, so its events read `xstate.done.actor.<state id>`.
    invoke: { id, src, onDone: ref(ctx.done), onError: ref(ctx.failed) },
  };
  states[id] = state;
  return { entry: id, outs: [(t) => (state.invoke!.onDone = ref(t))] };
}

/** A state that leaves through named events; `branches` maps event → compiled branch. */
function choice(
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
      outs.push((t) => (on[event] = ref(t)));
    }
  }
  return { entry: id, outs };
}

function compileSequence(nodes: StaticFlowNode[], states: Record<string, MachineJSONState>, ctx: Ctx): Fragment {
  let entry: string | null = null;
  let pending: Fragment["outs"] = [];
  for (const node of nodes) {
    const fragment = compileNode(node, states, ctx);
    if (!fragment.entry) continue;
    entry ??= fragment.entry;
    for (const out of pending) out(fragment.entry);
    pending = fragment.outs;
  }
  return { entry, outs: pending };
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
      return invoking(ctx, states, id, src || raw, {
        ...(node.description ? { description: node.description } : {}),
        meta: {
          ...(id !== raw ? { stepId: raw } : {}),
          ...(node.compensationCallee ? { compensation: node.compensationCallee } : {}),
          ...location(node.location),
        },
      });
    }
    case "workflow-ref": {
      const id = stateId(ctx, node.workflowName);
      return invoking(ctx, states, id, node.workflowName, { meta: { workflow: node.workflowName, ...location(node.location) } });
    }
    case "sequence":
      return compileSequence(node.children, states, ctx);
    case "parallel": {
      const id = stateId(ctx, node.name ?? `parallel_${++ctx.counter}`);
      if (node.children.length === 0) return choice(states, id, { description: "Parallel", meta: location(node.location) }, []);
      const settled = node.mode === "allSettled";
      const regions = dict<MachineJSONState>();
      const regionFailures: string[] = [];
      const outerFailed = ctx.failed;
      node.children.forEach((child, i) => {
        const regionId = stateId(ctx, `${id}_branch_${i}`);
        const finalId = stateId(ctx, `${regionId}_done`);
        const inner = dict<MachineJSONState>();
        // allSettled: a branch error ends only this region; the outcome is decided once all have finished.
        const failedId = settled ? stateId(ctx, `${regionId}_failed`) : outerFailed;
        ctx.failed = failedId;
        const branch = compileNode(child, inner, ctx);
        ctx.failed = outerFailed;
        inner[finalId] = { id: finalId, type: "final" };
        if (settled) {
          inner[failedId] = { id: failedId, type: "final" };
          regionFailures.push(failedId);
        }
        for (const out of branch.outs) out(finalId);
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
      return {
        entry: id,
        outs: [
          (t) =>
            (on["xstate.done.state"] = settled
              ? [
                  ...regionFailures.map((failedId) => ({
                    ...ref(outerFailed),
                    matches,
                    guard: { type: "@xstate.stateIn" as const, params: { stateId: `#${failedId}` } },
                  })),
                  { ...ref(t), matches },
                ]
              : { ...ref(t), matches }),
        ],
      };
    }
    case "race": {
      const id = stateId(ctx, node.name ?? `race_${++ctx.counter}`);
      const racers = node.children.map((child, i) => [`race:${i}`, compileNode(child, states, ctx)] as [string, Fragment]);
      return choice(states, id, { description: "Race: the first to finish wins", meta: location(node.location) }, racers);
    }
    case "conditional": {
      const id = stateId(ctx, node.derivedId ?? `decision_${++ctx.counter}`);
      const swap = node.helper === "unless" || node.helper === "unlessOr";
      const consequent = compileSequence(node.consequent, states, ctx);
      const alternate = compileSequence(node.alternate ?? [], states, ctx);
      return choice(states, id, { description: node.condition, meta: location(node.location) }, [
        [swap ? "false" : "true", consequent],
        [swap ? "true" : "false", alternate],
      ]);
    }
    case "decision": {
      const raw = node.decisionId && node.decisionId !== "<dynamic>" ? node.decisionId : `decision_${++ctx.counter}`;
      const id = stateId(ctx, raw);
      const label = node.conditionLabel && node.conditionLabel !== "<dynamic>" ? node.conditionLabel : undefined;
      const consequent = compileSequence(node.consequent, states, ctx);
      const alternate = compileSequence(node.alternate ?? [], states, ctx);
      return choice(states, id, { description: label ?? node.condition, meta: location(node.location) }, [
        [label ?? "true", consequent],
        [label ? `Not ${label}` : "false", alternate],
      ]);
    }
    case "switch": {
      const id = stateId(ctx, `switch_${++ctx.counter}`);
      const branches = node.cases.map(
        (c) => [c.isDefault ? "default" : (c.value ?? "case"), compileSequence(c.body, states, ctx)] as [string, Fragment]
      );
      // No default clause: an unmatched value falls through to whatever follows.
      if (!node.cases.some((c) => c.isDefault)) branches.push(["default", { entry: null, outs: [] }]);
      return choice(states, id, { description: `switch: ${node.expression}`, meta: location(node.location) }, branches);
    }
    case "loop": {
      const semanticId = node.loopId ?? node.derivedId;
      const id = stateId(ctx, semanticId ? `loop_${semanticId}` : `loop_${++ctx.counter}`);
      const body = compileSequence(node.body, states, ctx);
      for (const out of body.outs) out(id);
      const on = dict<MachineJSONTransition>();
      if (body.entry) on.iterate = ref(body.entry);
      const state: MachineJSONState = {
        id,
        description: node.iterSource ? `${node.loopType}: ${node.iterSource}` : node.loopType,
        on,
        meta: location(node.location),
      };
      states[id] = state;
      return { entry: id, outs: [(t) => (on.done = ref(t))] };
    }
    case "stream": {
      const id = stateId(ctx, `stream_${node.namespace ?? ++ctx.counter}`);
      const on = dict<MachineJSONTransition>();
      states[id] = { id, description: `stream: ${node.namespace ?? node.streamType}`, on, meta: location(node.location) };
      return { entry: id, outs: [(t) => (on.done = ref(t))] };
    }
    case "unknown": {
      const id = stateId(ctx, `unknown_${++ctx.counter}`);
      const on = dict<MachineJSONTransition>();
      states[id] = { id, description: `Not statically analyzable: ${node.reason}`, on, meta: location(node.location) };
      return { entry: id, outs: [(t) => (on.continue = ref(t))] };
    }
    default:
      return { entry: null, outs: [] };
  }
}

/**
 * Convert static workflow IR to an XState v6 MachineJSON definition.
 * The result is plain JSON: pass it to `machineFromJSON` or to a statechart tool.
 */
export function renderMachineJSON(ir: StaticWorkflowIR): MachineJSON {
  const machineId = ir.root.workflowName.replace(/[.#]/g, "_") || "workflow";
  // The machine id is addressable as `#id` too, so no state may reuse it.
  const ctx: Ctx = { used: new Set([machineId]), errors: new Set(), counter: 0, done: "", failed: "" };
  ctx.done = stateId(ctx, "done");
  ctx.failed = stateId(ctx, "failed");
  const states = dict<MachineJSONState>();
  const body = compileSequence(ir.root.children, states, ctx);
  for (const out of body.outs) out(ctx.done);

  for (const error of [...ir.root.errorTypes, ...(ir.root.declaredErrors ?? [])]) ctx.errors.add(error);
  const errors = [...ctx.errors];

  states[ctx.done] = { id: ctx.done, type: "final" };
  states[ctx.failed] = {
    id: ctx.failed,
    type: "final",
    ...(errors.length ? { description: `Fails with: ${errors.join(" | ")}`, meta: { errors } } : {}),
  };

  return {
    id: machineId,
    initial: body.entry ?? ctx.done,
    ...(ir.root.description ? { description: ir.root.description } : {}),
    states,
  };
}
