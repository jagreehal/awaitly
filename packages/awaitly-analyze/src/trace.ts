/**
 * Runtime trace → static diagram overlay
 *
 * The static diagram is the deterministic skeleton. A runtime trace is the set
 * of steps a single run actually executed, keyed by the same literal step id
 * the static analyzer uses. Overlaying one on the other is the XState-inspect
 * experience: "here is the whole shape, here is the path this run took."
 *
 * The join is exact precisely when the workflow is diagrammable — literal step
 * ids give every runtime event a stable, matchable identity. This is why the
 * diagrammability gate and the overlay reinforce each other.
 */

import type { WorkflowEvent } from "awaitly/workflow";

/** Any workflow event, regardless of the error/context type parameters. */
type AnyWorkflowEvent = WorkflowEvent<unknown, unknown>;

// =============================================================================
// Types
// =============================================================================

export type StepStatus =
  | "success"
  | "error"
  | "aborted"
  | "skipped"
  | "cache-hit"
  | "running";

export interface TraceStep {
  /** Literal step id — matches the static IR stepId */
  stepId: string;
  /** Terminal (or in-flight) status of this step in the run */
  status: StepStatus;
  /** Wall-clock duration in ms, when the event carried one */
  durationMs?: number;
}

export interface WorkflowTrace {
  /** Steps in first-seen order, each with its final status */
  steps: TraceStep[];
}

// =============================================================================
// Event reduction
// =============================================================================

/**
 * Extract the literal source step id from an event. ID-first events use
 * `name` for that literal id, while `stepId` and `stepKey` may contain a
 * caller-supplied cache identity. Older events without a name fall back to
 * their runtime identity.
 */
function stepKeyOf(event: {
  stepId?: string;
  stepKey?: string;
  name?: string;
}): string | undefined {
  return event.name ?? event.stepId ?? event.stepKey;
}

const TERMINAL: Partial<Record<string, StepStatus>> = {
  step_success: "success",
  step_error: "error",
  step_aborted: "aborted",
  step_skipped: "skipped",
  step_cache_hit: "cache-hit",
};

/**
 * Reduce a workflow event stream into a trace: one entry per step, carrying the
 * step's final status (a `step_start` with no terminal event stays `running`).
 * Preserves first-seen order so the trace reads top-to-bottom like the diagram.
 */
export function traceFromEvents(events: readonly AnyWorkflowEvent[]): WorkflowTrace {
  const order: string[] = [];
  const byId = new Map<string, TraceStep>();

  const upsert = (stepId: string, patch: Partial<TraceStep>): void => {
    let entry = byId.get(stepId);
    if (!entry) {
      entry = { stepId, status: "running" };
      byId.set(stepId, entry);
      order.push(stepId);
    }
    Object.assign(entry, patch);
  };

  for (const event of events) {
    const e = event as AnyWorkflowEvent & {
      stepId?: string;
      stepKey?: string;
      name?: string;
      durationMs?: number;
    };
    const key = stepKeyOf(e);
    if (!key) continue;

    if (e.type === "step_start") {
      upsert(key, { status: "running" });
      continue;
    }
    const terminal = TERMINAL[e.type];
    if (terminal) {
      upsert(key, {
        status: terminal,
        ...(typeof e.durationMs === "number" ? { durationMs: e.durationMs } : {}),
      });
    }
  }

  return { steps: order.map((id) => byId.get(id)!) };
}
