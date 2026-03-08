import type {
  WorkflowEvent,
  StepMetadata,
  StepErrorDiagnostics,
  ErrorClassification,
} from "./core";
import { extractErrorTag } from "./core";

// =============================================================================
// Public types
// =============================================================================

export interface WorkflowWideEvent {
  workflowId: string;
  workflowName?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: "success" | "error" | "cancelled";
  error?: {
    tag: string;
    classification?: ErrorClassification;
    origin?: string;
    stack?: string[];
  };
  steps: Array<{
    stepId: string;
    name: string;
    key?: string;
    status: "success" | "error" | "cached" | "skipped" | "aborted";
    durationMs?: number;
    domain?: string;
    owner?: string;
    intent?: string;
    tags?: readonly string[];
    calls?: readonly string[];
    error?: {
      tag: string;
      classification?: ErrorClassification;
      origin?: string;
      stack?: string[];
    };
    retryCount?: number;
    timedOut?: boolean;
  }>;
  integrityWarnings?: string[];
  summary: {
    totalSteps: number;
    errors: number;
    retries: number;
    cacheHits: number;
    timeouts: number;
    byDomain?: Record<
      string,
      { total: number; errors: number; avgDurationMs: number }
    >;
    bySeverity?: Record<string, number>;
    topFailingTags?: Array<{ tag: string; count: number }>;
  };
}

export interface DiagnosticsCollectorOptions {
  includeStacks?: boolean;
  redact?: (event: WorkflowWideEvent) => WorkflowWideEvent;
}

// =============================================================================
// Internal state types
// =============================================================================

interface StepAccumulator {
  events: WorkflowEvent<unknown>[];
  metadata?: StepMetadata;
  terminalSeen: boolean;
  startTs?: number;
  name?: string;
  key?: string;
}

interface CollectorState {
  workflowId?: string;
  workflowName?: string;
  startedAt?: number;
  endedAt?: number;
  terminalSeen: boolean;
  status?: "success" | "error" | "cancelled";
  workflowError?: unknown;
  steps: Map<string, StepAccumulator>;
  /** Maps stepKey → stepId so events with only stepKey route to the correct accumulator. */
  stepKeyToId: Map<string, string>;
  counters: {
    errors: number;
    retries: number;
    cacheHits: number;
    timeouts: number;
  };
  integrityWarnings: string[];
}

// =============================================================================
// Helpers
// =============================================================================

function freshState(): CollectorState {
  return {
    terminalSeen: false,
    steps: new Map(),
    stepKeyToId: new Map(),
    counters: { errors: 0, retries: 0, cacheHits: 0, timeouts: 0 },
    integrityWarnings: [],
  };
}

function getOrCreateStep(
  state: CollectorState,
  stepId: string,
): StepAccumulator {
  let acc = state.steps.get(stepId);
  if (!acc) {
    acc = { events: [], terminalSeen: false };
    state.steps.set(stepId, acc);
  }
  return acc;
}

/** Resolve stepId from an event – some event types only carry stepKey.
 *  Uses stepKeyToId mapping so events with only stepKey route to the correct accumulator.
 *  If the mapped accumulator already reached terminal status, the mapping is stale
 *  (a new logical step is reusing the same key) so we fall back to stepKey. */
function resolveStepId(
  event: WorkflowEvent<unknown>,
  state: CollectorState,
): string | undefined {
  if ("stepId" in event && typeof event.stepId === "string")
    return event.stepId;
  if ("stepKey" in event && typeof event.stepKey === "string") {
    const mappedId = state.stepKeyToId.get(event.stepKey);
    if (mappedId) {
      const acc = state.steps.get(mappedId);
      // If the mapped step already terminated, this is a new invocation reusing the key
      if (acc?.terminalSeen) {
        state.stepKeyToId.delete(event.stepKey);
        return event.stepKey;
      }
      return mappedId;
    }
    return event.stepKey;
  }
  return undefined;
}

const STEP_TERMINAL_TYPES = new Set([
  "step_success",
  "step_error",
  "step_cache_hit",
  "step_skipped",
  "step_aborted",
]);

function buildErrorInfo(
  error: unknown,
  includeStacks: boolean,
  diagnostics?: StepErrorDiagnostics,
): WorkflowWideEvent["error"] {
  const tag = diagnostics?.tag ?? extractErrorTag(error);
  const info: WorkflowWideEvent["error"] = { tag };
  if (diagnostics?.classification) info.classification = diagnostics.classification;
  if (diagnostics?.origin) info.origin = diagnostics.origin;
  if (includeStacks && error instanceof Error && error.stack) {
    info.stack = error.stack.split("\n").map((l) => l.trim());
  }
  return info;
}

// =============================================================================
// Factory
// =============================================================================

export function createDiagnosticsCollector(
  options?: DiagnosticsCollectorOptions,
): {
  handleEvent(event: WorkflowEvent<unknown>): void;
  wideEvent(): WorkflowWideEvent;
  reset(): void;
} {
  const includeStacks = options?.includeStacks ?? false;
  const redact = options?.redact;

  let state: CollectorState = freshState();

  // -----------------------------------------------------------------------
  // handleEvent
  // -----------------------------------------------------------------------
  function handleEvent(event: WorkflowEvent<unknown>): void {
    switch (event.type) {
      // -- workflow-level --------------------------------------------------
      case "workflow_start":
        state.workflowId = event.workflowId;
        state.workflowName = event.workflowName;
        state.startedAt = event.ts;
        break;

      case "workflow_success":
        if (state.terminalSeen) {
          state.integrityWarnings.push(
            "Duplicate workflow terminal event: workflow_success",
          );
        }
        state.status = "success";
        state.endedAt = event.ts;
        state.terminalSeen = true;
        break;

      case "workflow_error":
        if (state.terminalSeen) {
          state.integrityWarnings.push(
            "Duplicate workflow terminal event: workflow_error",
          );
        }
        state.status = "error";
        state.endedAt = event.ts;
        state.workflowError = event.error;
        state.terminalSeen = true;
        break;

      case "workflow_cancelled":
        if (state.terminalSeen) {
          state.integrityWarnings.push(
            "Duplicate workflow terminal event: workflow_cancelled",
          );
        }
        state.status = "cancelled";
        state.endedAt = event.ts;
        state.terminalSeen = true;
        break;

      // -- step-level ------------------------------------------------------
      default: {
        const stepId = resolveStepId(event, state);
        if (!stepId) break; // not a step event

        const acc = getOrCreateStep(state, stepId);
        acc.events.push(event);

        switch (event.type) {
          case "step_start":
            acc.metadata = event.metadata;
            acc.startTs = event.ts;
            acc.name = event.name;
            acc.key = event.stepKey;
            // Register stepKey → stepId mapping so later events with only stepKey
            // (e.g. step_cache_hit) route to this accumulator
            if (event.stepKey && event.stepId !== event.stepKey) {
              state.stepKeyToId.set(event.stepKey, stepId);
              // Merge orphan accumulator created by earlier events keyed by stepKey
              // (e.g. step_cache_miss emitted before step_start).
              // Only merge true orphans (no step_start seen) — not real steps whose
              // stepId happens to equal this stepKey.
              const orphan = state.steps.get(event.stepKey);
              if (orphan && orphan !== acc && orphan.startTs === undefined) {
                acc.events.unshift(...orphan.events);
                if (orphan.terminalSeen) acc.terminalSeen = true;
                state.steps.delete(event.stepKey);
              }
            }
            break;

          case "step_success":
          case "step_error":
          case "step_cache_hit":
          case "step_skipped":
          case "step_aborted":
            if (acc.terminalSeen) {
              state.integrityWarnings.push(
                `Duplicate step terminal event for step "${stepId}": ${event.type}`,
              );
            }
            acc.terminalSeen = true;
            if (event.type === "step_error") state.counters.errors++;
            if (event.type === "step_cache_hit") state.counters.cacheHits++;
            // Capture name/key/metadata from terminal events when not already set
            if (!acc.name && "name" in event && event.name) acc.name = event.name;
            if (!acc.key && "stepKey" in event && event.stepKey) acc.key = event.stepKey;
            if (!acc.metadata && "metadata" in event && event.metadata) acc.metadata = event.metadata;
            break;

          case "step_retry":
            state.counters.retries++;
            break;

          case "step_timeout":
            state.counters.timeouts++;
            break;
        }
        break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // wideEvent
  // -----------------------------------------------------------------------
  function wideEvent(): WorkflowWideEvent {
    const warnings: string[] = [...state.integrityWarnings];

    if (!state.terminalSeen) {
      warnings.push("wideEvent() called before workflow terminal event");
    }

    const startedAt = state.startedAt ?? 0;
    const endedAt = state.endedAt ?? 0;

    // -- Build steps array -------------------------------------------------
    const stepsArr: WorkflowWideEvent["steps"] = [];
    const domainStats = new Map<
      string,
      { total: number; errors: number; totalDuration: number; counted: number }
    >();
    const severityCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();

    for (const [stepId, acc] of state.steps) {
      if (!acc.events.some((e) => e.type === "step_start")) {
        warnings.push(`No step_start seen for step "${stepId}"`);
      }

      // Determine status
      let stepStatus: WorkflowWideEvent["steps"][number]["status"] = "error";
      let stepDurationMs: number | undefined;
      let stepError: WorkflowWideEvent["steps"][number]["error"] | undefined;
      let timedOut: boolean | undefined;

      const terminalEvent = [...acc.events].reverse().find((e: WorkflowEvent<unknown>) =>
        STEP_TERMINAL_TYPES.has(e.type),
      );

      if (terminalEvent) {
        switch (terminalEvent.type) {
          case "step_success":
            stepStatus = "success";
            break;
          case "step_error":
            stepStatus = "error";
            break;
          case "step_cache_hit":
            stepStatus = "cached";
            break;
          case "step_skipped":
            stepStatus = "skipped";
            break;
          case "step_aborted":
            stepStatus = "aborted";
            break;
        }
        if ("durationMs" in terminalEvent && typeof terminalEvent.durationMs === "number") {
          stepDurationMs = terminalEvent.durationMs;
        }
      } else {
        // No terminal event – check for step_timeout as last event
        const hasTimeout = acc.events.some((e) => e.type === "step_timeout");
        if (hasTimeout) {
          stepStatus = "error";
          timedOut = true;
        }
      }

      // Error info from step_error or step_retries_exhausted diagnostics
      const errorEvent = [...acc.events].reverse().find(
        (e: WorkflowEvent<unknown>) => e.type === "step_error" || e.type === "step_retries_exhausted",
      );
      if (errorEvent) {
        const err =
          "error" in errorEvent
            ? errorEvent.error
            : "lastError" in errorEvent
              ? errorEvent.lastError
              : undefined;
        const diag =
          "diagnostics" in errorEvent ? errorEvent.diagnostics : undefined;
        stepError = buildErrorInfo(
          err,
          includeStacks,
          diag as StepErrorDiagnostics | undefined,
        );

        // Aggregate tag counts
        if (stepError?.tag) {
          tagCounts.set(
            stepError.tag,
            (tagCounts.get(stepError.tag) ?? 0) + 1,
          );
        }
        // Aggregate severity
        if (stepError?.classification?.severity) {
          const sev = stepError.classification.severity;
          severityCounts.set(sev, (severityCounts.get(sev) ?? 0) + 1);
        }
      }

      // Timeout flag from timeout events even if a terminal was seen
      if (timedOut === undefined) {
        const hasTimeout = acc.events.some((e) => e.type === "step_timeout");
        if (hasTimeout) timedOut = true;
      }

      // Retry count
      const retryCount = acc.events.filter(
        (e) => e.type === "step_retry",
      ).length;

      // Domain stats — only terminal outcomes (success/error) count
      if (acc.metadata?.domain && (stepStatus === "success" || stepStatus === "error")) {
        const domain = acc.metadata.domain;
        let ds = domainStats.get(domain);
        if (!ds) {
          ds = { total: 0, errors: 0, totalDuration: 0, counted: 0 };
          domainStats.set(domain, ds);
        }
        ds.total++;
        if (stepStatus === "error") ds.errors++;
        if (stepDurationMs !== undefined) {
          ds.totalDuration += stepDurationMs;
          ds.counted++;
        }
      }

      const step: WorkflowWideEvent["steps"][number] = {
        stepId,
        name: acc.name ?? stepId,
        status: stepStatus,
      };
      if (acc.key) step.key = acc.key;
      if (stepDurationMs !== undefined) step.durationMs = stepDurationMs;
      if (acc.metadata?.domain) step.domain = acc.metadata.domain;
      if (acc.metadata?.owner) step.owner = acc.metadata.owner;
      if (acc.metadata?.intent) step.intent = acc.metadata.intent;
      if (acc.metadata?.tags?.length) step.tags = acc.metadata.tags;
      if (acc.metadata?.calls?.length) step.calls = acc.metadata.calls;
      if (stepError) step.error = stepError;
      if (retryCount > 0) step.retryCount = retryCount;
      if (timedOut) step.timedOut = timedOut;

      stepsArr.push(step);
    }

    // -- Build summary -----------------------------------------------------
    const summary: WorkflowWideEvent["summary"] = {
      totalSteps: stepsArr.length,
      errors: state.counters.errors,
      retries: state.counters.retries,
      cacheHits: state.counters.cacheHits,
      timeouts: state.counters.timeouts,
    };

    if (domainStats.size > 0) {
      const byDomain: Record<
        string,
        { total: number; errors: number; avgDurationMs: number }
      > = {};
      for (const [domain, ds] of domainStats) {
        byDomain[domain] = {
          total: ds.total,
          errors: ds.errors,
          avgDurationMs: ds.counted > 0 ? ds.totalDuration / ds.counted : 0,
        };
      }
      summary.byDomain = byDomain;
    }

    if (severityCounts.size > 0) {
      const bySeverity: Record<string, number> = {};
      for (const [sev, count] of severityCounts) {
        bySeverity[sev] = count;
      }
      summary.bySeverity = bySeverity;
    }

    if (tagCounts.size > 0) {
      summary.topFailingTags = [...tagCounts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);
    }

    // -- Build workflow-level error ----------------------------------------
    let wfError: WorkflowWideEvent["error"] | undefined;
    if (state.status === "error" && state.workflowError !== undefined) {
      wfError = buildErrorInfo(state.workflowError, includeStacks);
    }

    // -- Assemble fresh object ---------------------------------------------
    let wide: WorkflowWideEvent = {
      workflowId: state.workflowId ?? "unknown",
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - startedAt,
      status: state.status ?? "error",
      steps: stepsArr,
      summary,
    };

    if (state.workflowName) wide.workflowName = state.workflowName;
    if (wfError) wide.error = wfError;
    if (warnings.length > 0) wide.integrityWarnings = warnings;

    if (redact) {
      wide = redact(wide);
    }

    return wide;
  }

  // -----------------------------------------------------------------------
  // reset
  // -----------------------------------------------------------------------
  function reset(): void {
    state = freshState();
  }

  return { handleEvent, wideEvent, reset };
}
