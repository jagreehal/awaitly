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

import type { WorkflowEvent } from "awaitly";

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
  /**
   * Runtime identity when it differs from {@link stepId} (forEach scoped key,
   * caller-supplied cache key). Absent when the event's identity is the step id.
   */
  instanceId?: string;
  /** Terminal (or in-flight) status of this step in the run */
  status: StepStatus;
  /** Wall-clock duration in ms, when the event carried one */
  durationMs?: number;
  /** Number of retry attempts observed (absent when the step never retried) */
  retries?: number;
}

export interface TraceDecision {
  /** Literal decision id — matches the static IR decisionId */
  decisionId: string;
  /** Branch the run took ("then" / "else") */
  branch: string;
  /** Condition label, when the event carried one */
  label?: string;
}

export interface WorkflowTrace {
  /** Steps in first-seen order, each with its final status */
  steps: TraceStep[];
  /** Decisions in first-seen order, each with the branch the run took */
  decisions?: TraceDecision[];
}

// =============================================================================
// Event reduction
// =============================================================================

/**
 * Runtime cache/instance identity. Distinct forEach iterations share a `name`
 * but differ on `stepKey` (`submitPayment@submit-0`).
 */
function instanceKeyOf(event: {
  stepId?: string;
  stepKey?: string;
  name?: string;
}): string | undefined {
  return event.stepKey ?? event.name ?? event.stepId;
}

/**
 * Extract the literal source step id from an event. ID-first events use
 * `name` for that literal id, while `stepId` and `stepKey` may contain a
 * caller-supplied cache identity. Older events without a name fall back to
 * their runtime identity.
 */
function staticStepIdOf(event: {
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
 * Reduce a workflow event stream into a trace: one entry per runtime instance,
 * carrying the step's final status (a `step_start` with no terminal event stays
 * `running`). Preserves first-seen order so the trace reads top-to-bottom like
 * the diagram.
 */
export function traceFromEvents(events: readonly AnyWorkflowEvent[]): WorkflowTrace {
  const order: string[] = [];
  const byId = new Map<string, TraceStep>();

  const upsert = (
    instanceKey: string,
    stepId: string,
    patch: Partial<TraceStep>
  ): void => {
    let entry = byId.get(instanceKey);
    if (!entry) {
      const instanceId = instanceKey !== stepId ? instanceKey : undefined;
      entry = {
        stepId,
        status: "running",
        ...(instanceId ? { instanceId } : {}),
      };
      byId.set(instanceKey, entry);
      order.push(instanceKey);
    }
    Object.assign(entry, patch);
  };

  const decisionOrder: string[] = [];
  const decisionsById = new Map<string, TraceDecision>();

  for (const event of events) {
    const e = event as AnyWorkflowEvent & {
      stepId?: string;
      stepKey?: string;
      name?: string;
      durationMs?: number;
      decisionId?: string;
      branch?: string;
      label?: string;
    };

    if (e.type === "decision" && e.decisionId && e.branch) {
      if (!decisionsById.has(e.decisionId)) decisionOrder.push(e.decisionId);
      decisionsById.set(e.decisionId, {
        decisionId: e.decisionId,
        branch: e.branch,
        ...(e.label ? { label: e.label } : {}),
      });
      continue;
    }

    const instanceKey = instanceKeyOf(e);
    const stepId = staticStepIdOf(e);
    if (!instanceKey || !stepId) continue;

    if (e.type === "step_start") {
      upsert(instanceKey, stepId, { status: "running" });
      continue;
    }
    if (e.type === "step_retry") {
      const entry = byId.get(instanceKey);
      upsert(instanceKey, stepId, { retries: (entry?.retries ?? 0) + 1 });
      continue;
    }
    const terminal = TERMINAL[e.type];
    if (terminal) {
      upsert(instanceKey, stepId, {
        status: terminal,
        ...(typeof e.durationMs === "number" ? { durationMs: e.durationMs } : {}),
      });
    }
  }

  return {
    steps: order.map((id) => byId.get(id)!),
    decisions: decisionOrder.map((id) => decisionsById.get(id)!),
  };
}
