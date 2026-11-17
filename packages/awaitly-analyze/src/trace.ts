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
  /** Where the step was called, from OpenTelemetry `code.*` span attributes */
  location?: { filePath: string; line: number };
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
  /** Saga compensations that ran, in order (read from spans only) */
  compensations?: Array<{ stepId: string; status: "success" | "error" }>;
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

// =============================================================================
// OpenTelemetry spans
// =============================================================================

type AttributeMap = Record<string, unknown>;

/** A span reduced to the fields a trace needs, whichever shape it arrived in. */
interface NormalizedSpan {
  name: string;
  attributes: AttributeMap;
  events: Array<{ name: string; attributes: AttributeMap }>;
  startNs: number;
  endNs: number;
}

/** One awaitly run read back from its spans. */
export interface SpanRunTrace {
  workflowId: string;
  /** From `awaitly.workflow.name`; absent for an unnamed run */
  workflowName?: string;
  trace: WorkflowTrace;
}

/** OTLP JSON values: `{ stringValue }`, `{ intValue: "3" }` (int64 as a string), … */
function otlpValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const v = value as Record<string, unknown>;
  if ("stringValue" in v) return v.stringValue;
  if ("intValue" in v) return Number(v.intValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("boolValue" in v) return v.boolValue;
  if ("arrayValue" in v) {
    const values = (v.arrayValue as { values?: unknown[] } | undefined)?.values ?? [];
    return values.map(otlpValue);
  }
  return undefined;
}

function attributesOf(raw: unknown): AttributeMap {
  if (Array.isArray(raw)) {
    const out: AttributeMap = {};
    for (const kv of raw as Array<{ key: string; value: unknown }>) out[kv.key] = otlpValue(kv.value);
    return out;
  }
  return raw && typeof raw === "object" ? (raw as AttributeMap) : {};
}

/** HrTime `[s, ns]` (SDK) or a nanosecond count, possibly as a string (OTLP). */
function nanos(raw: unknown): number {
  if (Array.isArray(raw)) return Number(raw[0]) * 1e9 + Number(raw[1]);
  return Number(raw ?? 0);
}

function normalize(span: Record<string, unknown>): NormalizedSpan {
  const events = (span.events as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    name: String(span.name ?? ""),
    attributes: attributesOf(span.attributes),
    events: events.map((e) => ({ name: String(e.name ?? ""), attributes: attributesOf(e.attributes) })),
    startNs: nanos(span.startTime ?? span.startTimeUnixNano),
    endNs: nanos(span.endTime ?? span.endTimeUnixNano),
  };
}

/** Every span in an OTLP export (`resourceSpans`), a Tempo trace (`batches`), or a plain list. */
function collectSpans(input: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(input)) return input.flatMap(collectSpans);
  if (!input || typeof input !== "object") return [];
  const o = input as Record<string, unknown>;
  const groups = o.resourceSpans ?? o.batches;
  if (Array.isArray(groups)) {
    return groups.flatMap((g: Record<string, unknown>) =>
      ((g.scopeSpans ?? g.instrumentationLibrarySpans ?? []) as Array<{ spans?: unknown[] }>).flatMap(
        (scope) => (scope.spans ?? []) as Array<Record<string, unknown>>
      )
    );
  }
  if (o.trace && typeof o.trace === "object") return collectSpans(o.trace);
  return "name" in o ? [o] : [];
}

/** True when `input` looks like spans rather than a workflow event stream. */
export function isSpanExport(input: unknown): boolean {
  if (Array.isArray(input)) return input.length > 0 && isSpanExport(input[0]);
  if (!input || typeof input !== "object") return false;
  if ("resourceSpans" in input || "batches" in input || "trace" in input) return true;
  // A span has a name; a workflow event has a type and a timestamp.
  return "name" in input && !("type" in input && "ts" in input);
}

const OUTCOME_STATUS: Record<string, StepStatus> = {
  success: "success",
  error: "error",
  cancelled: "aborted",
};

/**
 * Read awaitly runs back out of OpenTelemetry spans: an SDK exporter's
 * `ReadableSpan`s, an OTLP JSON export, or a trace fetched from Tempo. Each
 * run becomes the same {@link WorkflowTrace} `traceFromEvents` produces, so
 * every overlay works from production traces as well as recorded events.
 */
export function tracesFromSpans(input: unknown): SpanRunTrace[] {
  // Some backends store start times to the millisecond, so steps in one run
  // tie; sequential steps also end in order, which breaks the tie.
  const spans = collectSpans(input)
    .map(normalize)
    .sort((a, b) => a.startNs - b.startNs || a.endNs - b.endNs);
  type Run = {
    workflowId: string;
    workflowName?: string;
    steps: TraceStep[];
    decisions: TraceDecision[];
    compensations: NonNullable<WorkflowTrace["compensations"]>;
  };
  const runs = new Map<string, Run>();

  const runFor = (attrs: AttributeMap) => {
    const id = attrs["awaitly.workflow.id"];
    if (typeof id !== "string") return undefined;
    let r = runs.get(id);
    if (!r) {
      r = { workflowId: id, steps: [], decisions: [], compensations: [] };
      runs.set(id, r);
    }
    return r;
  };

  for (const span of spans) {
    const r = runFor(span.attributes);
    if (!r) continue;
    const name = span.attributes["awaitly.workflow.name"];
    if (typeof name === "string" && (span.name === "run" || span.name.startsWith("run "))) r.workflowName = name;

    const stepName = span.attributes["awaitly.step.name"];
    if (span.name.startsWith("step ") && typeof stepName === "string") {
      const key = span.attributes["awaitly.step.key"];
      const filePath = span.attributes["code.file.path"];
      const line = span.attributes["code.line.number"];
      const retries = span.events.filter((e) => e.name === "awaitly.step.retry").length;
      r.steps.push({
        stepId: stepName,
        ...(typeof key === "string" && key !== stepName ? { instanceId: key } : {}),
        status: OUTCOME_STATUS[String(span.attributes["awaitly.outcome"])] ?? "running",
        ...(span.endNs > span.startNs ? { durationMs: (span.endNs - span.startNs) / 1e6 } : {}),
        ...(retries ? { retries } : {}),
        ...(typeof filePath === "string" && typeof line === "number" ? { location: { filePath, line } } : {}),
      });
    }

    if (span.name.startsWith("compensate ") && typeof stepName === "string") {
      r.compensations.push({
        stepId: stepName,
        status: span.attributes["awaitly.outcome"] === "success" ? "success" : "error",
      });
    }

    for (const event of span.events) {
      const a = event.attributes;
      if (event.name === "awaitly.step.cache_hit" && typeof a["awaitly.step.name"] === "string") {
        r.steps.push({ stepId: a["awaitly.step.name"], status: "cache-hit" });
      } else if (event.name === "awaitly.decision" && typeof a["awaitly.decision.id"] === "string") {
        r.decisions.push({
          decisionId: a["awaitly.decision.id"],
          branch: String(a["awaitly.decision.branch"]),
          ...(typeof a["awaitly.decision.label"] === "string" ? { label: a["awaitly.decision.label"] } : {}),
        });
      }
    }
  }

  return [...runs.values()].map(({ workflowId, workflowName, steps, decisions, compensations }) => ({
    workflowId,
    ...(workflowName !== undefined ? { workflowName } : {}),
    trace: { steps, decisions, ...(compensations.length ? { compensations } : {}) },
  }));
}

/**
 * Read a parsed trace file: OpenTelemetry spans (any shape
 * {@link tracesFromSpans} takes), or a workflow event array, which is one run.
 * Returns undefined for anything else.
 */
export function tracesFromJSON(parsed: unknown): SpanRunTrace[] | undefined {
  if (isSpanExport(parsed)) return tracesFromSpans(parsed);
  if (!Array.isArray(parsed)) return undefined;
  return [{ workflowId: "", trace: traceFromEvents(parsed as Parameters<typeof traceFromEvents>[0]) }];
}

/** The runs that belong to `workflowName`; all of them when none carry that name. */
export function runsFor(runs: readonly SpanRunTrace[], workflowName: string): WorkflowTrace[] {
  const named = runs.filter((r) => r.workflowName === workflowName);
  return (named.length ? named : runs).map((r) => r.trace);
}
