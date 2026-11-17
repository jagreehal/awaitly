/**
 * Run counts for autovisualizer's `counts` attribute.
 *
 * `<auto-visualizer definition=… counts=…>` draws a MachineJSON and labels
 * each transition with how often it was taken; a transition taken 0 times is
 * drawn dashed. Counts are keyed by state id, then event type. For the
 * machines {@link renderMachineJSON} builds that means:
 *
 * - a step state's invoke: `xstate.done.actor` (succeeded or served from
 *   cache) and `xstate.error.actor` (failed);
 * - a saga compensation: the same two events, for the rollback it ran;
 * - a `step.if` / `step.branch` decision: its first event for `then`, its
 *   second for `else`.
 *
 * Every countable transition gets an entry, so a path no run took shows as 0.
 */

import type { WorkflowTrace } from "../trace";
import type { MachineJSON, MachineJSONState } from "./machine-json";

export type AutovisualizerCounts = Record<string, Record<string, number>>;

export interface CountsResult {
  counts: AutovisualizerCounts;
  /** Trace steps or decisions with no state in the machine (dynamic ids, or another workflow) */
  unmatched: string[];
}

const DONE = "xstate.done.actor";
const ERROR = "xstate.error.actor";

function* allStates(states: Record<string, MachineJSONState> | undefined): Generator<MachineJSONState> {
  for (const state of Object.values(states ?? {})) {
    yield state;
    yield* allStates(state.states);
  }
}

type Located = { state: MachineJSONState; line?: number };

function lineOf(state: MachineJSONState): number | undefined {
  const location = state.meta?.location as { line?: number } | undefined;
  return location?.line;
}

/** Same raw id used twice: the call-site line from the span picks the state. */
function pickByLine(candidates: Located[] | undefined, line: number | undefined): MachineJSONState | undefined {
  if (!candidates?.length) return undefined;
  if (candidates.length === 1) return candidates[0]!.state;
  return candidates.find((c) => c.line !== undefined && c.line === line)?.state;
}

export function countsFromTraces(machine: MachineJSON, traces: readonly WorkflowTrace[]): CountsResult {
  const counts: AutovisualizerCounts = {};
  const steps = new Map<string, Located[]>();
  const decisions = new Map<string, Located[]>();
  const compensations = new Map<string, Located[]>();
  const add = (map: Map<string, Located[]>, raw: string, state: MachineJSONState) => {
    const line = lineOf(state);
    map.set(raw, [...(map.get(raw) ?? []), { state, ...(line !== undefined ? { line } : {}) }]);
  };

  for (const state of allStates(machine.states)) {
    const meta = state.meta ?? {};
    if (state.invoke && typeof meta.compensationFor === "string") {
      // The `_after_failure` copies only run once another compensation failed.
      if (!state.id.endsWith("_after_failure")) add(compensations, meta.compensationFor, state);
      counts[state.id] = { [DONE]: 0, [ERROR]: 0 };
    } else if (state.invoke) {
      add(steps, typeof meta.stepId === "string" ? meta.stepId : state.id, state);
      counts[state.id] = { [DONE]: 0, [ERROR]: 0 };
    } else if (state.on && typeof meta.location === "object") {
      const events = Object.keys(state.on);
      if (events.length !== 2) continue;
      add(decisions, typeof meta.decisionId === "string" ? meta.decisionId : state.id, state);
      counts[state.id] = { [events[0]!]: 0, [events[1]!]: 0 };
    }
  }

  const unmatched = new Set<string>();
  for (const trace of traces) {
    for (const step of trace.steps) {
      const state = pickByLine(steps.get(step.stepId), step.location?.line);
      if (!state) {
        unmatched.add(step.stepId);
        continue;
      }
      const event = step.status === "success" || step.status === "cache-hit" ? DONE : step.status === "error" ? ERROR : undefined;
      if (event) counts[state.id]![event]! += 1;
    }
    for (const compensation of trace.compensations ?? []) {
      const state = compensations.get(compensation.stepId)?.[0]?.state;
      if (!state) {
        unmatched.add(`compensate ${compensation.stepId}`);
        continue;
      }
      counts[state.id]![compensation.status === "success" ? DONE : ERROR]! += 1;
    }
    for (const decision of trace.decisions ?? []) {
      const state = pickByLine(decisions.get(decision.decisionId), undefined);
      if (!state?.on) {
        unmatched.add(decision.decisionId);
        continue;
      }
      const [thenEvent, elseEvent] = Object.keys(state.on);
      const event = decision.branch === "then" ? thenEvent : decision.branch === "else" ? elseEvent : undefined;
      if (event) counts[state.id]![event]! += 1;
    }
  }

  return { counts, unmatched: [...unmatched] };
}
